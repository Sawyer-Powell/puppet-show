#!/usr/bin/env node
// One step, one width: render an addressed step to a PNG plus the same settled
// checks `verify` runs, without walking the deck. Iteration loop:
//
//   node scripts/shot.mjs <name> <address> [--width 720] [--out path] [--json] [--no-build]
//
// Address forms: 12 (deck step), keyed-data/3 (chapter step), keyed-data/insert
// (chapter beat), keyed-data (its first step), or a globally unique beat name.
import { chrome } from "./verify-browser.mjs";
import { ensureBuilt, loadInventory, shoot } from "./frames.mjs";
import { sourceDir } from "./sources.mjs";

try {
  const usage = "usage: npm run shot -- <name> <address> [--width 720] [--out path] [--json] [--no-build]";
  let name, address, width = 720, out, json = false, build = true;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--width") width = Number(args[++i]);
    else if (arg === "--out") out = args[++i];
    else if (arg === "--json") json = true;
    else if (arg === "--no-build") build = false;
    else if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}; ${usage}`);
    else if (!name) name = arg;
    else if (address === undefined) address = arg;
    else throw new Error(`unexpected argument ${JSON.stringify(arg)}; ${usage}`);
  }
  if (!name || !sourceDir(name) || address === undefined) throw new Error(usage);
  if (!Number.isInteger(width) || width < 200 || width > 4000) throw new Error("--width must be an integer 200-4000");

  const start = Date.now();
  const { file, built, seconds: buildSeconds } = build ? ensureBuilt(name) : { file: `dist/examples/${name}/index.html`, built: false, seconds: 0 };
  const browser = await chrome();
  let result;
  try {
    const { inventory, cached } = await loadInventory(browser, { name, file });
    result = await shoot(browser, { name, file, inventory, address, width, out });
    result.indexed = cached ? "cached" : "walked";
  } finally { await browser.close(); }

  const seconds = (Date.now() - start) / 1000;
  if (json) {
    console.log(JSON.stringify({ name, file, width, ...result, errors: result.issues, seconds, build: buildSeconds, built }, null, 2));
  } else {
    const { target } = result;
    console.log(`shot ${name} ${target.address} → step ${target.index} (${width}px) in ${seconds.toFixed(2)}s${built ? ` incl. build ${buildSeconds.toFixed(2)}s` : ""}`);
    console.log(`png ${result.png}`);
    if (result.issues.length) {
      console.error(`FAIL ${result.issues.length} issue(s)`);
      for (const issue of [...new Set(result.issues)].slice(0, 12)) console.error(`  ${issue}`);
    } else {
      console.log("PASS no settled issues");
      console.log("Look at the PNG. Checks cannot judge meaning: captions, blank lanes, arrows.");
    }
  }
  process.exitCode = result.issues.length ? 1 : 0;
} catch (error) {
  console.error(`FAIL shot: ${error.message}`);
  process.exitCode = 1;
}
