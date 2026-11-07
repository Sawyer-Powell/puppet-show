#!/usr/bin/env node
// Step addresses for a deck: chapters, step indices and beat names, so `shot`
// can address one step. Walking the deck is cached against the build stamp.
//
//   node scripts/scenes.mjs <name> [--json] [--refresh] [--no-build]
import { chrome } from "./verify-browser.mjs";
import { ensureBuilt, loadInventory } from "./frames.mjs";
import { sourceDir } from "./sources.mjs";

try {
  const usage = "usage: npm run scenes -- <name> [--json] [--refresh] [--no-build]";
  let name, json = false, refresh = false, build = true;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--json") json = true;
    else if (arg === "--refresh") refresh = true;
    else if (arg === "--no-build") build = false;
    else if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}; ${usage}`);
    else if (!name) name = arg;
    else throw new Error(`unexpected argument ${JSON.stringify(arg)}; ${usage}`);
  }
  if (!name || !sourceDir(name)) throw new Error(usage);

  const start = Date.now();
  const { file, built, seconds: buildSeconds } = build ? ensureBuilt(name) : { file: `dist/examples/${name}/index.html`, built: false, seconds: 0 };
  const browser = await chrome();
  try {
    const { inventory, cached } = await loadInventory(browser, { name, file, refresh });
    const seconds = (Date.now() - start) / 1000;
    if (json) {
      console.log(JSON.stringify({ name, file, total: inventory.total, cached, seconds, build: buildSeconds, built, steps: inventory.steps }, null, 2));
    } else {
      const chapters = [...new Set(inventory.steps.map((step) => step.chapter))];
      console.log(`${name} (${inventory.total} steps, addresses ${cached ? "cached" : "indexed"} in ${seconds.toFixed(2)}s${built ? ` incl. build ${buildSeconds.toFixed(2)}s` : ""})`);
      for (const chapter of chapters) {
        const steps = inventory.steps.filter((step) => step.chapter === chapter);
        console.log(`\n${chapter}  (${steps.length} step${steps.length === 1 ? "" : "s"}, first at ${steps[0].index})`);
        for (const step of steps) console.log(`  ${String(step.index).padStart(2)}\t${step.address}`);
      }
      console.log(`\nShoot one: npm run shot -- ${name} <address>`);
    }
  } finally { await browser.close(); }
} catch (error) {
  console.error(`FAIL scenes: ${error.message}`);
  process.exitCode = 1;
}
