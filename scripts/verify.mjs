// One-example verification: scoped types, standalone build, endpoints, real
// playback, seek equality, and labelled review sheets. Run from the repo root:
// npm run verify <name>  OR  node scripts/verify.mjs <name> --width 720,420
import { execFileSync } from "node:child_process";
import { sourceDir } from "./sources.mjs";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chrome, endpoints, motion, sheet, viewportHeight } from "./verify-browser.mjs";
import { rejectSwallowedFlags } from "./verify-cli.mjs";

function argumentsFor(args) {
  let name, widths = [720, 420], seenWidth = false, quick = false, a11y = true, realtime = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--quick" && !quick) quick = true;
    else if (args[i] === "--realtime" && !realtime) realtime = true;
    else if (args[i] === "--no-a11y" && a11y) a11y = false;
    else if (args[i] === "--width" && !seenWidth) {
      seenWidth = true;
      const value = args[++i];
      if (!value || !/^\d+(,\d+)*$/.test(value)) throw new Error("--width requires comma-separated integer widths");
      widths = [...new Set(value.split(",").map(Number))];
      if (widths.some((w) => w < 200 || w > 4000)) throw new Error("widths must be between 200 and 4000");
    } else if (!name && /^[a-zA-Z][\w-]*$/.test(args[i])) name = args[i];
    else throw new Error(`unknown argument ${JSON.stringify(args[i])}; use npm run verify -- <name> [--quick] [--width 720,420] [--no-a11y] [--realtime] (npm may swallow flags without --)`);
  }
  if (!name || !sourceDir(name)) throw new Error("usage: npm run verify -- <example> [--quick] [--width 720,420] [--no-a11y] [--realtime]; example must exist in examples/ or recipes/");
  return { name, widths, quick, a11y, realtime };
}

let failed = false;
const report = (label, problems = []) => {
  console.log(`${problems.length ? "FAIL" : "PASS"} ${label}${problems.length ? ` (${problems.length} issue(s))` : ""}`);
  for (const p of [...new Set(problems)].slice(0, 12)) console.error(`  ${p}`);
  if (problems.length) failed = true;
};
function gate(label, command, args) {
  try {
    execFileSync(command, args, { stdio: "pipe", encoding: "utf8", timeout: 60_000 });
    report(label);
    return true;
  } catch (e) {
    const output = [e.stdout, e.stderr].filter(Boolean).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
    const diagnostic = lines.find((line) => /error TS\d+:/.test(line))
      ?? lines.find((line) => /^Error: (?!Command failed)/i.test(line))
      ?? lines.find((line) => !/^(error during build:|Build failed with)/i.test(line) && /could not resolve|\[.*vite:|error:|not found/i.test(line) && !line.startsWith("at "))
      ?? lines.find((line) => !line.startsWith("at ") && !line.startsWith("node:"))
      ?? e.message.split("\n")[0];
    report(label, [diagnostic]);
    return false;
  }
}
function difference(a, b) {
  if (a === undefined || b === undefined) return "step count differs";
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at character ${i}\n    seek: ${JSON.stringify(a.slice(Math.max(0, i - 60), i + 140))}\n    live: ${JSON.stringify(b.slice(Math.max(0, i - 60), i + 140))}`;
}

async function main() {
  rejectSwallowedFlags();
  const { name, widths, quick, a11y, realtime } = argumentsFor(process.argv.slice(2));
  if (!a11y) console.warn("DEBUG ONLY: --no-a11y skips accessibility/keyboard gates; not valid for handoff.");
  const start = Date.now();
  console.log(`verify ${name}: ${quick ? "quick (scoped typecheck + build only)" : `endpoint widths ${widths.join(", ")}px; motion ${[...new Set([720, ...widths])].join(", ")}px; viewport height ${viewportHeight}px`}`);
  mkdirSync("node_modules/.cache/puppet-show", { recursive: true });
  const temp = mkdtempSync(resolve("node_modules/.cache/puppet-show/verify-"));
  const config = resolve(temp, "tsconfig.json");
  writeFileSync(config, JSON.stringify({ extends: resolve("tsconfig.json"), include: [resolve("src"), resolve(sourceDir(name))], exclude: [] }, null, 2));
  try {
    if (!gate("scoped typecheck", "npx", ["tsc", "--noEmit", "-p", config])) return;
  } finally { rmSync(temp, { recursive: true, force: true }); }
  if (!gate("build", process.execPath, ["scripts/build.mjs", name])) return;
  if (quick) {
    console.log(`PASS verify ${name} --quick (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    return;
  }

  const file = `dist/examples/${name}/index.html`, root = resolve(`shots/${name}`);
  mkdirSync(root, { recursive: true });
  const browser = await chrome();
  const results = {}, artifacts = [];
  // Each pass is an independent page, so all of them run at once; awaiting
  // them only orders the report. The 720 pass is always included as the seek
  // reference, even when custom widths omit it.
  const settledWidths = [...new Set([720, ...widths])];
  const referenceRequested = widths.includes(720);
  try {
    const settle = settledWidths.map((width) => ({
      width,
      // Contrast/names/keyboard are width-independent style facts: audit them
      // on the primary width only. Layout/clipping still run at every width.
      job: endpoints(browser, { file, out: resolve(root, String(width)), width, a11y: a11y && width === 720 })
        .then((result) => ({ result }), (error) => ({ error })),
    }));
    const playback = settledWidths.map((width) => ({
      width,
      job: motion(browser, { file, out: resolve(root, width === 720 ? "motion" : `motion-${width}`), width, clock: !realtime })
        .then((result) => ({ result }), (error) => ({ error })),
    }));
    for (const { width, job } of settle) {
      const { result, error } = await job;
      const label = width === 720 && !referenceRequested ? "replay reference 720px" : `endpoints ${width}px (${result?.total} steps)`;
      if (error) { report(label, [error.message]); continue; }
      results[width] = result;
      if (result.tallStages.length) console.log(`NOTE tall stages ${width}×${viewportHeight}px (non-failing): ${result.tallStages.join('; ')}`);
      report(label, [...result.errors, ...result.issues]);
      if (width !== 720 || referenceRequested) {
        const destination = resolve(root, `sheet-${width}.png`);
        try {
          await sheet(browser, resolve(root, String(width)), result.total, destination, `${name} · ${width}px endpoints`);
          artifacts.push(destination);
          report(`contact sheet ${width}px`);
        } catch (e) { report(`contact sheet ${width}px`, [e.message]); }
      }
    }
    for (const { width, job } of playback) {
      const { result: live, error } = await job;
      const label = `live motion ${width}px (${live?.total} steps)`;
      if (error) { report(label, [error.message]); continue; }
      if (width === 720) results.motion = live; else results[`motion-${width}`] = live;
      report(label, [...live.errors, ...live.issues]);
      const reference = results[width];
      const mismatch = reference
        ? Array.from({ length: Math.max(reference.total, live.total) }, (_, i) => i).find((i) => reference.signatures[i] !== live.signatures[i])
        : undefined;
      const equality = width === 720 ? "replay equality" : `replay equality ${width}px`;
      if (!reference) report(equality, ["no settled reference for this width"]);
      else report(equality, mismatch === undefined ? [] : [`step ${mismatch + 1}: ${difference(reference.signatures[mismatch], live.signatures[mismatch])}\n    If intentionally live telemetry, mark its element data-verify-ignore.`]);
      const destination = resolve(root, width === 720 ? "sheet-motion.png" : `sheet-motion-${width}.png`);
      try {
        await sheet(browser, resolve(root, width === 720 ? "motion" : `motion-${width}`), live.total, destination, `${name} · ${width}px live mid-step`);
        artifacts.push(destination);
        report(width === 720 ? "contact sheet motion" : `contact sheet motion ${width}px`);
      } catch (e) { report(`contact sheet motion ${width}px`, [e.message]); }
    }
  } finally { await browser.close(); }
  writeFileSync(resolve(root, "results.json"), JSON.stringify({ name, widths, a11y, failed, seconds: (Date.now() - start) / 1000, results }, null, 2));
  console.log(`${failed ? "FAIL" : "PASS"} verify ${name} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  console.log(`Artifacts: ${root}/ (step PNGs and results.json)`);
  console.log(`Contact sheets:\n${artifacts.map((p) => `  ${p}`).join("\n")}`);
  console.log("Open the contact sheets and LOOK at them before handing off.");
}
main().catch((e) => { console.error(`FAIL verify: ${e.message}`); failed = true; }).finally(() => { process.exitCode = failed ? 1 : 0; });
