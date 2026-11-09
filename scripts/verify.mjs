// One-example verification: scoped types, standalone build, endpoints, real
// playback, seek equality, and labelled review sheets. Run from the repo root:
// npm run verify <name>  OR  node scripts/verify.mjs <name> --width 720,420
//
// Results are cached per step against the content hash of the step's sources
// (`scripts/verify-cache.mjs`), so an unchanged deck re-gates without a
// browser and a one-scene edit re-verifies only that scene's steps.
import { execFileSync } from "node:child_process";
import { sourceDir } from "./sources.mjs";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chrome, endpoints, imageName, motion, sheet, viewportHeight } from "./verify-browser.mjs";
import { rejectSwallowedFlags } from "./verify-cli.mjs";
import { CACHE_VERSION, cachePath, invalidation, loadCache, sourceHashes, reusable } from "./verify-cache.mjs";
import { readAddresses, ensureBuilt, loadInventory, shoot } from "./frames.mjs";
import { diffPngs } from "./pixels.mjs";

import { findChrome } from "./chrome.mjs";
import { projectContext, typecheckConfig, typescriptBin } from "./project.mjs";

function argumentsFor(args) {
  let name, widths = [720, 420], seenWidth = false, quick = false, a11y = true, realtime = false, refresh = false, edit = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--quick" && !quick) quick = true;
    else if (args[i] === "--realtime" && !realtime) realtime = true;
    else if (args[i] === "--refresh" && !refresh) refresh = true;
    else if (args[i] === "--edit" && !edit) edit = true;
    else if (args[i] === "--no-a11y" && a11y) a11y = false;
    else if (args[i] === "--width" && !seenWidth) {
      seenWidth = true;
      const value = args[++i];
      if (!value || !/^\d+(,\d+)*$/.test(value)) throw new Error("--width requires comma-separated integer widths");
      widths = [...new Set(value.split(",").map(Number))];
      if (widths.some((w) => w < 200 || w > 4000)) throw new Error("widths must be between 200 and 4000");
    } else if (!name && /^[a-zA-Z][\w-]*$/.test(args[i])) name = args[i];
    else throw new Error(`unknown argument ${JSON.stringify(args[i])}; use npm run verify -- <name> [--edit] [--quick] [--width 720,420] [--no-a11y] [--realtime] [--refresh] (npm may swallow flags without --)`);
  }
  if (!name || !sourceDir(name)) throw new Error("usage: npm run verify -- <example> [--edit] [--quick] [--width 720,420] [--no-a11y] [--realtime] [--refresh]; example must exist in examples/ or recipes/");
  if (edit) widths = [720];
  return { name, widths, quick, a11y, realtime, refresh, edit };
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
  const path = findChrome();
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

/**
 * Edit loop: re-render only the steps whose scene changed, straight from the
 * deck's step addresses (a cold seek), with the same settled checks as the
 * gate. No deck walk, no sheets, one width. The gate (walk, playback, flights,
 * 420px) stays authoritative before handoff; this exists so an edit costs
 * seconds, not a deck.
 */
async function runEdit({ name, file, root, plan, cache, hashes, identity, a11y }) {
  const start = Date.now();
  const addresses = readAddresses(name);
  const indexes = [...plan.dirty].sort((a, b) => a - b);
  // Baselines are per capture mode, but the deck's step counts are not part of
  // them: a baseline from a different structure would report chrome like "1/8"
  // against "1/7" as a scene change. Re-key the baseline directory structurally.
  // The marker describes the addresses this run renders with; baselines are
  // only written after a complete pass, so an aborted run leaves both alone.
  const editDir = resolve(root, "edit");
  const structure = JSON.stringify({ total: addresses.total, chapters: addresses.steps.map((step) => step.chapter) });
  let previousStructure = null;
  try { previousStructure = readFileSync(resolve(editDir, "structure.json"), "utf8").trim(); } catch { /* first edit run */ }
  if (previousStructure !== structure) {
    rmSync(editDir, { recursive: true, force: true });
    mkdirSync(editDir, { recursive: true });
    writeFileSync(resolve(editDir, "structure.json"), structure);
  }
  const browser = await chrome();
  const entries = {}, notes = [], artifacts = [], pending = new Map();
  try {
    for (const index of indexes) {
      const step = addresses.steps[index];
      if (!step) throw new Error(`step ${index + 1} is not in the cached address list; the deck's structure changed — run the full gate`);
      const out = resolve(root, "720", imageName(index));
      // Gate captures walk the deck, the edit loop deep-links; the two are each
      // deterministic but differ slightly, so compare within the same mode.
      const baseline = resolve(editDir, imageName(index));
      const before = existsSync(baseline) ? readFileSync(baseline).toString("base64") : null;
      const shot = await shoot(browser, { name, file, inventory: addresses, address: step.address, width: 720, out, checks: a11y });
      const issues = shot.issues.map((issue) => `step ${index + 1}: ${issue}`);
      report(`step ${index + 1} (${step.address})`, [...shot.errors, ...issues]);
      // A step with page/console errors stays uncached so the next run retries it.
      if (!shot.errors.length) entries[index] = { signature: shot.signature, issues, tallStage: shot.tallStage ?? null };
      artifacts.push(out);
      pending.set(baseline, readFileSync(out));
      if (before) {
        try {
          const diff = await diffPngs(browser, { before, after: readFileSync(out).toString("base64") });
          if (diff.bbox && !diff.resized && diff.pct >= 0.0005) {
            const destination = resolve(root, "diff", `720-${imageName(index)}`);
            mkdirSync(resolve(root, "diff"), { recursive: true });
            writeFileSync(destination, Buffer.from(diff.png.split(",")[1], "base64"));
            notes.push(`step ${index + 1} changed ${(diff.pct * 100).toFixed(1)}% at ${diff.bbox.x},${diff.bbox.y} ${diff.bbox.width}×${diff.bbox.height} · ${destination}`);
          }
        } catch (e) { notes.push(`step ${index + 1} diff unavailable: ${e.message}`); }
      }
    }
  } finally { await browser.close(); }

  // A pass that reached here rendered every addressed step, so its baselines
  // describe the same deck the next edit run will compare against.
  for (const [baseline, bytes] of pending) writeFileSync(baseline, bytes);

  // Fold the fresh endpoint results in; every other pass must re-verify the
  // steps the gate walks (playback, 420px) rather than inherit them.
  const steps = { ...cache.steps };
  for (const [key, pass] of Object.entries(steps)) {
    if (key === "720") continue;
    steps[key] = Object.fromEntries(Object.entries(pass).filter(([index]) => !entries[index]));
  }
  steps["720"] = { ...steps["720"], ...entries };
  mkdirSync(root, { recursive: true });
  writeFileSync(cachePath(name), JSON.stringify({
    version: CACHE_VERSION, identity, files: hashes, total: cache.total, chapters: cache.chapters, steps,
  }, null, 2));
  return { entries, notes, artifacts, seconds: (Date.now() - start) / 1000 };
}

async function main() {
  rejectSwallowedFlags();
  const { name, widths, quick, a11y, realtime, refresh, edit } = argumentsFor(process.argv.slice(2));
  if (!a11y) console.warn("DEBUG ONLY: --no-a11y skips accessibility/keyboard gates; not valid for handoff.");
  // The edit loop always audits a11y: it writes the entries the gate reuses, and
  // the flag is part of the cache identity. Use `shot` for a layout-only check.
  const auditsA11y = edit ? true : a11y;
  const start = Date.now();
  console.log(`verify ${name}: ${quick ? "quick (scoped typecheck + build only)" : edit ? "edit requested (changed steps at 720px when a cache plan applies; otherwise the full gate)" : `endpoint widths ${widths.join(", ")}px; motion ${[...new Set([720, ...widths])].join(", ")}px; viewport height ${viewportHeight}px`}`);
  // Stable config + build info: tsc then only rechecks changed files (~0.3s).
  const context = projectContext(name);
  const config = typecheckConfig(context.sourceDir, context.cacheDir);
  if (!gate("scoped typecheck", process.execPath, [typescriptBin, "--noEmit", "-p", config])) return;

  // Build only when the deck is stale: a rebuild renumbers nothing but does
  // invalidate the address cache, which would force a fresh indexing walk.
  const built = ensureBuilt(name);
  report(`build${built.built ? "" : " (cached)"}`);
  if (quick) {
    console.log(`PASS verify ${name} --quick (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    return;
  }

  const file = built.file, root = context.artifactDir;
  mkdirSync(root, { recursive: true });
  const identity = environment(auditsA11y);
  const hashes = sourceHashes(name);
  const cache = refresh ? null : loadCache(name);
  // Without a browser: sources and environment unchanged, results complete.
  const fastPlan = cache?.chapters
    ? invalidation({ name, chapters: cache.chapters, previous: cache, hashes, identity })
    : { all: true, reason: "no cached results" };
  // An edit run needs cached addresses and an incremental plan; otherwise fall
  // back to the whole gate (both widths) rather than half of it.
  const editUsable = edit && !fastPlan.all && fastPlan.dirty.size > 0 && Boolean(readAddresses(name));
  const nothingToDo = !fastPlan.all && fastPlan.dirty.size === 0;
  if (edit && !editUsable && !nothingToDo) console.log(`edit loop: no incremental plan (${fastPlan.reason}); running the full gate instead`);
  const gateWidths = edit && !editUsable ? [720, 420] : widths;
  const keys = passKeys(gateWidths, realtime);
  const motionWidths = keys.settledWidths;
  const allKeys = [...motionWidths.map(String), ...motionWidths.map((width) => keys.motion(width))];
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

  // The edit loop only needs the 720px endpoint entries; missing playback/420px
  // entries belong to the gate and must not force work here.
  if (edit && !fastPlan.all && fastPlan.dirty.size === 0) {
    console.log(`PASS edit: no changes (${cache.total} steps cached)`);
    console.log(`Run the gate before handoff: npm run verify -- ${name}`);
    return;
  }
  if (editUsable) {
    try {
      const outcome = await runEdit({ name, file, root, plan: fastPlan, cache, hashes, identity, a11y: auditsA11y });
      if (outcome.notes.length) console.log(`Changed since the last verified run:\n${outcome.notes.map((note) => `  ${note}`).join("\n")}`);
      writeFileSync(resolve(root, "results.json"), JSON.stringify({
        name, widths: [720], a11y, failed, seconds: (Date.now() - start) / 1000,
        edit: { reason: fastPlan.reason, rendered: [...fastPlan.dirty], notes: outcome.notes },
      }, null, 2));
      const rendered = Object.keys(outcome.entries).length;
      const seconds = (Date.now() - start) / 1000;
      console.log(`${failed ? "FAIL" : "PASS"} edit ${name} (${seconds.toFixed(2)}s): ${rendered}/${cache.total} steps re-verified, ${fastPlan.reason}`);
      console.log(`png ${outcome.artifacts.join("\n    ")}`);
      console.log("Look at those images. Playback, flights, replay equality and 420px are gate-only: run the gate before handoff.");
      return;
    } catch (e) {
      failed = true;
      console.error(`FAIL edit: ${e.message}`);
      console.error(`The cache no longer matches the deck; run the full gate: npm run verify -- ${name}`);
      return;
    }
  }
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
          ? endpoints(browser, { ...options, a11y: auditsA11y && pass.width === 720 })
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
