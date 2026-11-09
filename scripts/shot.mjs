#!/usr/bin/env node
// The iteration loop: render addressed steps to full-size PNGs in one browser.
//
//   node scripts/shot.mjs <name> <address...> [--width 720] [--checks] [--json] [--no-build]
//
// Address forms: 12 (deck step), keyed-data/3 (chapter step), keyed-data/insert
// (chapter beat), or a bare chapter (keyed-data) which renders every step of
// that scene. Several addresses render in one session. Default checks are the
// cheap visual ones (layout, spill, clipping, console errors); `--checks` adds
// the accessibility and keyboard audit.
import { chrome } from "./verify-browser.mjs";
import { distFile, ensureBuilt, loadInventory, resolveTargets, shoot } from "./frames.mjs";
import { sourceDir } from "./sources.mjs";

const usage = "usage: npm run shot -- <name> <address...> [--width 720] [--checks] [--json] [--no-build]";
let name, width = 720, json = false, build = true, checks = false;
const addresses = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--width") width = Number(args[++i]);
  else if (arg === "--json") json = true;
  else if (arg === "--checks") checks = true;
  else if (arg === "--no-build") build = false;
  else if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}; ${usage}`);
  else if (!name) name = arg;
  else addresses.push(arg);
}
if (!name || !sourceDir(name) || !addresses.length) throw new Error(usage);
if (!Number.isInteger(width) || width < 200 || width > 4000) throw new Error("--width must be an integer 200-4000");

try {
  const start = Date.now();
  const { file, built, seconds: buildSeconds } = build
    ? ensureBuilt(name)
    : { file: distFile(name), built: false, seconds: 0 };
  const browser = await chrome();
  const shots = [];
  let targets = [];
  let indexed = "cached";
  try {
    const { inventory, cached } = await loadInventory(browser, { name, file });
    indexed = cached ? "cached" : "walked";
    // Resolve every address before rendering, so a typo costs a message, not a
    // browser session.
    targets = addresses.flatMap((address) => resolveTargets(inventory, address));
    for (const target of targets) {
      shots.push(await shoot(browser, { name, file, inventory, address: target.address, width, checks }));
    }
  } finally { await browser.close(); }

  const seconds = (Date.now() - start) / 1000;
  const issues = shots.flatMap((shot) => [...shot.errors, ...shot.issues].map((issue) => `step ${shot.target.index}: ${issue}`));
  const outline = { name, file, width, checks, seconds, built, build: buildSeconds, indexed, pngs: shots.map((shot) => shot.png), issues };
  if (json) {
    console.log(JSON.stringify({ ...outline, shots: shots.map(({ target, png }) => ({ index: target.index, address: target.address, png })) }, null, 2));
  } else {
    console.log(`shot ${name} ${shots.map((shot) => shot.target.index).join(",")} (${width}px) in ${seconds.toFixed(2)}s${built ? ` incl. build ${buildSeconds.toFixed(2)}s` : ""}${targets.length > 1 ? ` · ${targets.length} steps` : ""}`);
    console.log(`png ${shots.map((shot) => shot.png).join("\n    ")}`);
    if (issues.length) {
      console.error(`FAIL ${issues.length} issue(s)`);
      for (const issue of [...new Set(issues)].slice(0, 12)) console.error(`  ${issue}`);
    } else {
      console.log(`PASS ${checks ? "layout + a11y" : "layout"}; ${targets.length} image${targets.length === 1 ? "" : "s"} to look at`);
    }
  }
  process.exitCode = issues.length ? 1 : 0;
} catch (error) {
  console.error(`FAIL shot: ${error.message}`);
  process.exitCode = 1;
}
