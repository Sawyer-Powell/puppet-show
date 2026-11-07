// Also run by frames.test.ts / npm run check.
// A step address must reproduce exactly the state the deck-wide walk reaches,
// otherwise single-step iteration would be looking at a different explainer.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chrome, endpoints } from "../scripts/verify-browser.mjs";
import { ensureBuilt, loadInventory, readCachedInventory, resolveAddress, shoot } from "../scripts/frames.mjs";

const name = "puppet-show-explained";
execFileSync(process.execPath, ["scripts/build.mjs", name], { stdio: "inherit", timeout: 60_000 });
const { file } = ensureBuilt(name);
const browser = await chrome();
try {
  const { inventory, cached } = await loadInventory(browser, { name, file, refresh: true });
  assert.equal(inventory.total, 19);
  assert.equal(cached, false);
  assert.ok(inventory.steps.every((step) => step.address === `${step.chapter}/${step.name}`));
  assert.ok(inventory.steps.some((step) => !/^\d+$/.test(step.name)), "the example addresses steps by beat name");

  // Address forms resolve to the same step the deck calls by that name.
  assert.equal(resolveAddress(inventory, "8").index, 8);
  assert.equal(resolveAddress(inventory, "a-scene-is-a-script/2").index, 5);
  assert.equal(resolveAddress(inventory, "a-scene-is-a-script/yield* waits").index, 5);
  assert.equal(resolveAddress(inventory, "who-runs-it").index, 11, "a bare chapter means its first step");
  assert.throws(() => resolveAddress(inventory, "99"), /out of range/);
  assert.throws(() => resolveAddress(inventory, "nope"), /not a chapter/);
  assert.throws(() => resolveAddress(inventory, "a-scene-is-a-script/nope"), /is not a step of chapter/);
  assert.throws(() => resolveAddress(inventory, ""), /an address is required/);

  const reference = readCachedInventory(name, file);
  assert.ok(reference, "the walk is cached against the build stamp");
  assert.deepEqual(reference, inventory);

  // First step of every chapter plus the last one: hash.test.ts already proves
  // every deep link, so this only exercises addressing and the shot path.
  const chapters = [...new Set(inventory.steps.map((step) => step.chapter))];
  const sample = [...new Set([...chapters.map((id) => inventory.steps.find((step) => step.chapter === id).index), inventory.total])];
  const settled = await endpoints(browser, { file, out: "shots/frames-check/720", width: 720, a11y: false });
  for (const index of sample) {
    const step = inventory.steps[index - 1];
    const result = await shoot(browser, { name, file, inventory, address: step.address, width: 720, out: `shots/frames-check/${step.index}.png` });
    assert.equal(result.target.index, step.index);
    assert.equal(result.signature, settled.signatures[step.index - 1], `deep link to ${step.address} matches the walked step ${step.index}`);
    assert.deepEqual(result.issues, [], `step ${step.index} has no settled issues`);
    assert.ok(existsSync(result.png), `shot wrote ${result.png}`);
  }
} finally { await browser.close(); }
