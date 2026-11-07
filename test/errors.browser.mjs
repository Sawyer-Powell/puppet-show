import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { chrome } from "../scripts/verify-browser.mjs";

await build({ configFile: false, root: resolve("test/fixtures/errors"), logLevel: "warn",
  plugins: [viteSingleFile()], build: { outDir: resolve("dist/test-errors"), emptyOutDir: true } });
const browser = await chrome();
try {
  const page = await browser.newPage({ reducedMotion: "no-preference" });
  const logs = [], uncaught = [];
  page.on("console", m => { if (m.type() === "error") logs.push(m.text()); });
  page.on("pageerror", e => uncaught.push(String(e)));
  await page.goto(pathToFileURL(resolve("dist/test-errors/index.html")).href);
  await page.waitForFunction(() => document.querySelector(".ps-deck")?.dataset.state === "error");
  const message = await page.locator(".ps-deck").getAttribute("data-error");
  assert.match(message, /puppet-show: fly\(from, to\): `to` is undefined.*pass a thunk/);
  assert.match(await page.locator('[role="alert"]').innerText(), /chapter 1 · step 1/);
  assert.equal(await page.locator(".ps-primary").isDisabled(), true);
  assert.ok(logs.includes(`puppet-show: scene error in chapter 1 "Broken analysis" step 1: ${message}`));
  await page.evaluate(() => d.goto(1));
  await page.waitForFunction(() => document.querySelector(".ps-deck")?.dataset.state === "paused");
  assert.equal(await page.locator(".ps-deck").getAttribute("data-error"), null);
  assert.equal(await page.locator('[role="alert"]').count(), 0);
  await page.evaluate(() => d.goto(2));
  await page.waitForFunction(() => document.querySelector(".ps-deck")?.dataset.state === "error");
  assert.equal(await page.locator(".ps-deck").getAttribute("data-error"), "live failure");
  assert.equal(logs.filter(s => s === 'puppet-show: scene error in chapter 3 "Broken live" step 1: live failure').length, 1);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator(".ps-deck").getAttribute("data-chapter"), "2", "keyboard next is disabled on error");
  await page.locator(".ps-nav button").first().click();
  await page.waitForFunction(() => document.querySelector(".ps-deck")?.dataset.state === "paused");
  assert.equal(await page.locator(".ps-deck").getAttribute("data-chapter"), "1", "previous chapter remains available");
  await page.evaluate(() => d.goto(0));
  await page.waitForFunction(() => document.querySelector(".ps-deck")?.dataset.state === "error");
  assert.equal(logs.filter(s => s.includes('chapter 1 "Broken analysis"')).length, 3, "analysis and two runs report once each");
  await page.evaluate(() => d.goto(3));
  await page.waitForFunction(() => document.querySelector(".ps-deck")?.dataset.state === "paused");
  assert.equal(await page.locator(".ps-deck").getAttribute("data-error"), null);
  assert.match(await page.locator(".ps-stage").innerText(), /101/);
  assert.deepEqual(uncaught, []);
  console.log("scene error browser checks passed");
} finally { await browser.close(); }
