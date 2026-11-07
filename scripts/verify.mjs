// One-example verification: scoped types, standalone build, endpoints, real
// playback, seek equality, and labelled review sheets. Run from the repo root:
// npm run verify <name>  OR  node scripts/verify.mjs <name> --width 720,420
//
// Results are cached per step against the content hash of the step's sources
// (`scripts/verify-cache.mjs`), so an unchanged deck re-gates without a
// browser and a one-scene edit re-verifies only that scene's steps.
import { execFileSync } from "node:child_process";
import { sourceDir } from "./sources.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chrome, endpoints, imageName, motion, sheet, viewportHeight } from "./verify-browser.mjs";
import { rejectSwallowedFlags } from "./verify-cli.mjs";
import { CACHE_VERSION, cachePath, invalidation, loadCache, sourceHashes, reusable } from "./verify-cache.mjs";
import { distFile, ensureBuilt, loadInventory } from "./frames.mjs";
import { diffPngs } from "./pixels.mjs";

const defaultChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function argumentsFor(args) {
  let name, widths = [720, 420], seenWidth = false, quick = false, a11y = true, realtime = false, refresh = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--quick" && !quick) quick = true;
    else if (args[i] === "--realtime" && !realtime) realtime = true;
    else if (args[i] === "--refresh" && !refresh) refresh = true;
    else if (args[i] === "--no-a11y" && a11y) a11y = false;
    else if (args[i] === "--width" && !seenWidth) {
      seenWidth = true;
      const value = args[++i];
      if (!value || !/^\d+(,\d+)*$/.test(value)) throw new Error("--width requires comma-separated integer widths");
      widths = [...new Set(value.split(",").map(Number))];
      if (widths.some((w) => w < 200 || w > 4000)) throw new Error("widths must be between 200 and 4000");
    } else if (!name && /^[a-zA-Z][\w-]*$/.test(args[i])) name = args[i];
    else throw new Error(`unknown argument ${JSON.stringify(args[i])}; use npm run verify -- <name> [--quick] [--width 720,420] [--no-a11y] [--realtime] [--refresh] (npm may swallow flags without --)`);
  }
  if (!name || !sourceDir(name)) throw new Error("usage: npm run verify -- <example> [--quick] [--width 720,420] [--no-a11y] [--realtime] [--refresh]; example must exist in examples/ or recipes/");
  return { name, widths, quick, a11y, realtime, refresh };
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

/** Everything cached results depend on besides the sources themselves. */
function environment(a11y) {
  const path = process.env.CHROME ?? defaultChrome;
  let stamp = "missing";
  try { const stat = statSync(path); stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`; } catch { /* reported by the launch error */ }
  // `a11y` belongs here: a --no-a11y run must never seed results a full gate reuses.
  return { cache: CACHE_VERSION, node: process.version, chrome: stamp, chromePath: path, viewportHeight, a11y };
}

const passKeys = (widths, realtime) => ({
  // `--realtime` plays wall-clock, so it keeps its own cache entries.
  motion: (width) => `motion${width === 720 ? "" : `-${width}`}${realtime ? "-realtime" : ""}`,
  settledWidths: [...new Set([720, ...widths])],
  referenceRequested: widths.includes(720),
});

const cacheKey = (key, index) => `${key}:${index}`;

/** A pass result rebuilt from cached entries, so the report path is identical. */
function fromCache(cache, key, total) {
  const entries = Array.from({ length: total }, (_, index) => cache.steps?.[key]?.[index]);
  return {
    signatures: entries.map((entry) => entry.signature),
    issues: entries.flatMap((entry) => entry.issues),
    samples: entries.map((entry) => entry.sample),
    tallStages: entries.flatMap((entry) => (entry.tallStage ? [entry.tallStage] : [])),
    total,
    captured: {},
    reused: entries.map((_, index) => index),
  };
}

const cacheComplete = (cache, keys, total) => keys.every((key) =>
  Array.from({ length: total }, (_, index) => cache.steps?.[key]?.[index]).every(Boolean));

/** One label shape for fresh and cached passes; says what actually ran. */
function describe(pass, result) {
  const captured = Object.keys(result.captured ?? {}).length;
  const reused = result.reused?.length ?? 0;
  const parts = [`${result.total} steps`];
  if (captured) parts.push(`${captured} re-rendered`);
  if (reused) parts.push(`${reused} reused`);
  if (!captured && !reused) parts.push("cached");
  return `${pass.label} (${parts.join(", ")})`;
}

function replayProblems(reference, live) {
  if (!reference) return ["no settled reference for this width"];
  const mismatch = Array.from({ length: Math.max(reference.total, live.total) }, (_, i) => i)
    .find((i) => reference.signatures[i] !== live.signatures[i]);
  return mismatch === undefined ? [] : [`step ${mismatch + 1}: ${difference(reference.signatures[mismatch], live.signatures[mismatch])}\n    If intentionally live telemetry, mark its element data-verify-ignore.`];
}

const equalityLabel = (pass) => (pass.width === 720 ? "replay equality" : `replay equality ${pass.width}px`);

const sheetSlug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chapter";

/** Chapters with at least one re-captured step: only their sheets changed. */
function dirtyChapters(inventory, captured) {
  const changed = new Set(Object.keys(captured ?? {}).map(Number));
  const chapters = new Map();
  inventory.steps.forEach((step, index) => {
    const entry = chapters.get(step.chapter) ?? { chapter: step.chapter, steps: [], dirty: false };
    entry.steps.push(index);
    if (changed.has(index)) entry.dirty = true;
    chapters.set(step.chapter, entry);
  });
  return [...chapters.values()].filter((entry) => entry.dirty);
}

async function main() {
  rejectSwallowedFlags();
  const { name, widths, quick, a11y, realtime, refresh } = argumentsFor(process.argv.slice(2));
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

  // Build only when the deck is stale: a rebuild renumbers nothing but does
  // invalidate the address cache, which would force a fresh indexing walk.
  const built = ensureBuilt(name);
  report(`build${built.built ? "" : " (cached)"}`);
  if (quick) {
    console.log(`PASS verify ${name} --quick (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    return;
  }

  const file = built.file, root = resolve(`shots/${name}`);
  mkdirSync(root, { recursive: true });
  const identity = environment(a11y);
  const hashes = sourceHashes(name);
  const cache = refresh ? null : loadCache(name);
  const keys = passKeys(widths, realtime);
  const motionWidths = keys.settledWidths;
  const allKeys = [...motionWidths.map(String), ...motionWidths.map((width) => keys.motion(width))];
  // Without a browser: sources and environment unchanged, results complete.
  const fastPlan = cache?.chapters
    ? invalidation({ name, chapters: cache.chapters, previous: cache, hashes, identity })
    : { all: true, reason: "no cached results" };
  const cacheable = !fastPlan.all && fastPlan.dirty.size === 0 && cacheComplete(cache, allKeys, cache.total)
    && motionWidths.every((width) =>
      Array.from({ length: cache.total }, (_, index) => existsSync(resolve(root, String(width), imageName(index)))).every(Boolean));

  const results = {}, artifacts = [], notes = [], previousPngs = new Map();
  // Sheets: the primary 720px endpoint review is per chapter at two columns,
  // so steps stay readable (~590px) and a one-scene edit regenerates one sheet.
  // Motion and 420px are deck-wide four-up grids: gross layout, not detail.
  const passes = [
    ...motionWidths.map((width) => ({
      kind: "endpoints", width, key: String(width),
      label: width === 720 && !keys.referenceRequested ? "replay reference 720px" : `endpoints ${width}px`,
      out: resolve(root, String(width)), sheet: `sheet-${width}.png`, title: `${name} · ${width}px endpoints`,
    })),
    ...motionWidths.map((width) => ({
      kind: "motion", width, key: keys.motion(width),
      label: width === 720 ? "live motion 720px" : `live motion ${width}px`,
      out: resolve(root, width === 720 ? "motion" : `motion-${width}`),
      sheet: width === 720 ? "sheet-motion.png" : `sheet-motion-${width}.png`,
      title: `${name} · ${width}px live mid-step`,
    })),
  ];

  const saveCache = (inventory, dirty) => {
    const steps = {};
    for (const pass of passes) {
      const key = pass.key;
      const fromCacheEntries = cache?.steps?.[key] ?? {};
      const fresh = results[`${pass.kind}:${pass.width}`]?.captured ?? {};
      const entries = {};
      for (let index = 0; index < inventory.total; index++) {
        // Reuse an old entry only for a step that was not dirty; a dirty step
        // whose pass failed must stay uncached so the next run retries it.
        const entry = fresh[index] ?? (!dirty.all && !dirty.dirty.has(index) ? fromCacheEntries[index] : undefined);
        if (entry) entries[index] = entry;
      }
      steps[key] = entries;
    }
    mkdirSync(resolve(root), { recursive: true });
    writeFileSync(cachePath(name), JSON.stringify({
      version: CACHE_VERSION, identity, files: hashes, total: inventory.total,
      chapters: inventory.steps.map((step) => step.chapter), steps,
    }, null, 2));
  };

  if (cacheable) {
    console.log(`cached: ${fastPlan.reason} (${cachePath(name)})`);
    for (const pass of passes) {
      const result = fromCache(cache, pass.key, cache.total);
      results[`${pass.kind}:${pass.width}`] = result;
      if (pass.kind === "endpoints") {
        if (result.tallStages.length) console.log(`NOTE tall stages ${pass.width}×${viewportHeight}px (non-failing): ${result.tallStages.join('; ')}`);
        report(describe(pass, result), result.issues);
      } else {
        report(describe(pass, result), result.issues);
        report(equalityLabel(pass), replayProblems(results[`endpoints:${pass.width}`], result));
      }
      const sheets = pass.kind === "endpoints" && pass.width === 720
        ? readdirSync(root).filter((entry) => /^sheet-720-.*\.png$/.test(entry)).sort().map((entry) => resolve(root, entry))
        : [resolve(root, pass.sheet)].filter((entry) => existsSync(entry));
      artifacts.push(...sheets);
    }
  } else {
    const browser = await chrome();
    try {
      const { inventory } = await loadInventory(browser, { name, file });
      const plan = cache
        ? invalidation({ name, chapters: inventory.steps.map((step) => step.chapter), previous: cache, hashes, identity })
        : { all: true, reason: "no cached results" };
      const dirty = plan.all ? { all: true, dirty: new Set() } : plan;
      console.log(dirty.all
        ? `verification plan: all ${inventory.total} steps (${plan.reason})`
        : `verification plan: ${dirty.dirty.size}/${inventory.total} steps re-verified (${plan.reason})`);
      const reuseMap = (key) => {
        if (dirty.all) return undefined;
        const pngDir = passes.find((pass) => pass.key === key).out;
        return reusable({
          cache, key, dirty, total: inventory.total,
          hasPng: (index) => existsSync(resolve(pngDir, imageName(index))),
        });
      };
      const jobs = passes.map((pass) => {
        const reuse = reuseMap(pass.key);
        // Keep the pre-edit PNG of every step about to be re-captured, so the
        // report can say what moved and where.
        if (cache) for (let index = 0; index < inventory.total; index++) {
          if (reuse?.has(index)) continue;
          const png = resolve(pass.out, imageName(index));
          if (existsSync(png)) previousPngs.set(cacheKey(pass.key, index), readFileSync(png).toString("base64"));
        }
        const options = { file, out: pass.out, width: pass.width, reuse };
        const job = pass.kind === "endpoints"
          ? endpoints(browser, { ...options, a11y: a11y && pass.width === 720 })
          : motion(browser, { ...options, clock: !realtime });
        return { pass, job: job.then((result) => ({ result }), (error) => ({ error })) };
      });

      for (const { pass, job } of jobs.filter((entry) => entry.pass.kind === "endpoints")) {
        const { result, error } = await job;
        if (error) { report(pass.label, [error.message]); continue; }
        results[`${pass.kind}:${pass.width}`] = result;
        if (result.tallStages.length) console.log(`NOTE tall stages ${pass.width}×${viewportHeight}px (non-failing): ${result.tallStages.join('; ')}`);
        report(describe(pass, result), [...result.errors, ...result.issues]);
        if (pass.width !== 720 || keys.referenceRequested) {
          try {
            const groups = pass.width === 720 ? dirtyChapters(inventory, result.captured) : [null];
            for (const group of groups) {
              const destination = resolve(root, group ? `sheet-720-${sheetSlug(group.chapter)}.png` : pass.sheet);
              if (pass.width === 720) rmSync(resolve(root, pass.sheet), { force: true });
              await sheet(browser, pass.out, result.total, destination, group ? `${name} · ${group.chapter} · 720px` : pass.title,
                group ? { steps: group.steps, columns: 2 } : {});
              artifacts.push(destination);
              report(`contact sheet ${pass.width}px${group ? ` ${group.chapter}` : ""}`);
            }
          } catch (e) { report(`contact sheet ${pass.width}px`, [e.message]); }
        }
      }
      for (const { pass, job } of jobs.filter((entry) => entry.pass.kind === "motion")) {
        const { result: live, error } = await job;
        if (error) { report(pass.label, [error.message]); continue; }
        results[`${pass.kind}:${pass.width}`] = live;
        report(describe(pass, live), [...live.errors, ...live.issues]);
        report(equalityLabel(pass), replayProblems(results[`endpoints:${pass.width}`], live));
        try {
          const destination = resolve(root, pass.sheet);
          await sheet(browser, pass.out, live.total, destination, pass.title);
          artifacts.push(destination);
          report(pass.width === 720 ? "contact sheet motion" : `contact sheet motion ${pass.width}px`);
        } catch (e) { report(`contact sheet motion ${pass.width}px`, [e.message]); }
      }

      // What moved, and where: only steps that were re-captured against a
      // previous image can answer that.
      for (const pass of passes.filter((entry) => entry.kind === "endpoints")) {
        const fresh = results[`${pass.kind}:${pass.width}`]?.captured ?? {};
        for (const index of Object.keys(fresh).map(Number).sort((a, b) => a - b)) {
          const before = previousPngs.get(cacheKey(pass.key, index));
          const after = resolve(pass.out, imageName(index));
          if (!before || !existsSync(after)) continue;
          try {
            const diff = await diffPngs(browser, { before, after: readFileSync(after).toString("base64") });
            // Sub-threshold deltas are rasterisation noise, not edits.
            if (diff.resized || !diff.bbox || diff.pct < 0.0005) continue;
            const destination = resolve(root, "diff", `${pass.key}-${imageName(index)}`);
            mkdirSync(resolve(root, "diff"), { recursive: true });
            writeFileSync(destination, Buffer.from(diff.png.split(",")[1], "base64"));
            notes.push(`step ${index + 1} (${pass.width}px) changed ${(diff.pct * 100).toFixed(1)}% at ${diff.bbox.x},${diff.bbox.y} ${diff.bbox.width}×${diff.bbox.height} · ${destination}`);
          } catch (e) { notes.push(`step ${index + 1} (${pass.width}px) diff unavailable: ${e.message}`); }
        }
      }
      saveCache(inventory, dirty);
    } finally { await browser.close(); }
  }

  if (notes.length) console.log(`Changed since the last verified run:\n${notes.map((note) => `  ${note}`).join("\n")}`);
  writeFileSync(resolve(root, "results.json"), JSON.stringify({
    name, widths, a11y, failed, seconds: (Date.now() - start) / 1000,
    cache: { path: cachePath(name), complete: cacheable, notes },
    results,
  }, null, 2));
  console.log(`${failed ? "FAIL" : "PASS"} verify ${name} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  console.log(`Artifacts: ${root}/ (step PNGs and results.json)`);
  const sheetLine = artifacts.length ? `Contact sheets:\n${artifacts.map((p) => `  ${p}`).join("\n")}` : "Contact sheets: reused from the previous verified run";
  console.log(sheetLine);
  console.log("Open the images and LOOK at them before handing off.");
}
main().catch((e) => { console.error(`FAIL verify: ${e.message}`); failed = true; }).finally(() => { process.exitCode = failed ? 1 : 0; });
