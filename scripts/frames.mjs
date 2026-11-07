// Step addresses and single-step capture: the iteration loop's engine.
//
// A deck's hash (`#chapter/step-or-beat`) is a seek address. `shot` renders
// exactly that step from a cold load (hash deep link, one seek, one screenshot)
// instead of walking the deck, so iterating on one scene costs one step rather
// than the whole explainer. `verify` stays the deck-wide gate.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectA11y, keyboardIssues } from "./verify-a11y.mjs";
import { stageSize } from "./verify-visibility.mjs";
import { sourceStamp } from "./verify-cache.mjs";
import { advance, diagnostic, layoutIssues, openDeck, paused, signature, viewportHeight, waitForDeck } from "./verify-browser.mjs";

export const distFile = (name) => `dist/examples/${name}/index.html`;
export const addressCache = (name) => `shots/${name}/addresses.json`;

export const buildRecord = (name) => `dist/examples/${name}/build.json`;

/**
 * Rebuild unless the deck on disk was built from exactly the current sources.
 * Content, not mtimes: checkout order and coarse timestamps otherwise let a
 * stale artifact pass as "up to date".
 */
export function ensureBuilt(name) {
  const file = distFile(name);
  const stamp = sourceStamp(name);
  let current = false;
  try { current = existsSync(file) && JSON.parse(readFileSync(buildRecord(name), "utf8")).stamp === stamp; } catch { /* rebuild */ }
  if (current) return { file, stamp, built: false, seconds: 0 };
  const start = Date.now();
  execFileSync(process.execPath, ["scripts/build.mjs", name], { stdio: "inherit" });
  writeFileSync(buildRecord(name), JSON.stringify({ stamp, builtAt: new Date().toISOString() }, null, 2));
  return { file, stamp, built: true, seconds: (Date.now() - start) / 1000 };
}

/**
 * Walk a settled deck once, recording the hash that addresses each step.
 * The walk is the slow-but-honest way to learn addresses; the result is cached
 * against the build stamp, and every later action deep-links instead.
 */
export async function inventory(page) {
  const total = Number(await page.locator(".ps-deck").getAttribute("data-total"));
  if (!Number.isInteger(total) || total < 1) throw new Error("invalid deck data-total");
  const steps = [];
  for (let i = 0; i < total; i++) {
    // openDeck finished any reduced-motion autoplay before the first step.
    try {
      await paused(page, i);
      const raw = new URL(page.url()).hash.slice(1);
      const [chapter, name = "1"] = raw.split("/").map(decodeURIComponent);
      if (!chapter) throw new Error(`step ${i + 1} has no hash address`);
      steps.push({ index: i + 1, chapter, name, hash: raw, address: `${chapter}/${name}` });
    } catch (e) { throw await diagnostic(page, e); }
    if (i + 1 < total) await advance(page);
  }
  return { total, steps };
}

export function readCachedInventory(name, _file) {
  try {
    const cached = JSON.parse(readFileSync(addressCache(name), "utf8"));
    return cached.stamp === sourceStamp(name) ? cached.inventory : null;
  } catch { return null; }
}

/**
 * Addresses regardless of the build stamp: the edit loop cannot afford the
 * indexing walk after every rebuild. `shoot` verifies the deck really opened the
 * addressed step, so a structure change surfaces as a clear error instead of a
 * wrong picture.
 */
export function readAddresses(name) {
  try { return JSON.parse(readFileSync(addressCache(name), "utf8")).inventory ?? null; } catch { return null; }
}

export async function loadInventory(browser, { name, file, refresh = false }) {
  const cached = refresh ? null : readCachedInventory(name, file);
  if (cached) return { inventory: cached, cached: true };
  const errors = [];
  const page = await openDeck(browser, file, 720, true, errors);
  try {
    const found = await inventory(page);
    if (errors.length) throw new Error(`deck reported errors while indexing: ${errors.join("\n")}`);
    mkdirSync(dirname(addressCache(name)), { recursive: true });
    writeFileSync(addressCache(name), JSON.stringify({ name, stamp: sourceStamp(name), inventory: found }, null, 2));
    return { inventory: found, cached: false };
  } finally { await page.close(); }
}

const candidates = (inventory, limit = 12) =>
  inventory.steps.slice(0, limit).map((s) => `  ${s.index}\t${s.address}`).join("\n") +
  (inventory.total > limit ? `\n  … ${inventory.total - limit} more` : "");

/**
 * Resolve a step address to its hash. Accepted forms:
 * `12` (1-based deck step), `chapter/2` (1-based within chapter),
 * `chapter/beat-name`, `chapter` (its first step), or a globally unique beat name.
 */
export function resolveAddress(inventory, address) {
  const text = String(address ?? "").trim();
  if (!text) throw new Error(`an address is required: a step number (12), chapter/step (keyed-data/3) or chapter/beat (keyed-data/insert).\nAvailable:\n${candidates(inventory)}`);
  if (/^\d+$/.test(text)) {
    const step = inventory.steps[Number(text) - 1];
    if (!step) throw new Error(`step ${text} is out of range 1-${inventory.total}.\nAvailable:\n${candidates(inventory)}`);
    return { ...step };
  }
  const chapters = [...new Set(inventory.steps.map((s) => s.chapter))];
  const inChapter = (chapter, token) => {
    const steps = inventory.steps.filter((s) => s.chapter === chapter);
    if (token === undefined || token === "") return { ...steps[0] };
    let step;
    if (/^\d+$/.test(token)) step = steps[Number(token) - 1];
    else step = steps.find((s) => s.name === token) ?? steps.find((s) => s.name.toLowerCase() === token.toLowerCase());
    if (step) return { ...step };
    throw new Error(`${JSON.stringify(token)} is not a step of chapter ${JSON.stringify(chapter)}.\nAvailable:\n${steps.map((s) => `  ${s.index}\t${s.address}`).join("\n")}`);
  };
  const [head, tail] = text.split("/");
  const chapter = chapters.find((id) => id === head);
  if (chapter) return inChapter(chapter, tail);
  if (tail === undefined) {
    const named = inventory.steps.filter((s) => s.name.toLowerCase() === head.toLowerCase());
    if (named.length === 1) return { ...named[0] };
    if (named.length > 1) throw new Error(`${JSON.stringify(head)} is ambiguous; use an index or a chapter/step address:\n${named.map((s) => `  ${s.index}\t${s.address}`).join("\n")}`);
  }
  throw new Error(`${JSON.stringify(head)} is not a chapter of this deck.\nChapters:\n${chapters.map((id) => `  ${id}`).join("\n")}\nSteps:\n${candidates(inventory)}`);
}

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "step";

/** Stable per-address path, so re-shooting overwrites what the reviewer reads. */
export function shotPath(name, step, width) {
  return `shots/${name}/shot/${String(step.index).padStart(2, "0")}-${slug(step.name)}-${width}.png`;
}

/**
 * Every step an address covers: a step address renders one step, a bare chapter
 * renders the whole scene, which is the unit an author edits.
 */
export function resolveTargets(inventory, address) {
  const text = String(address ?? "").trim();
  const isChapter = !/^\d+$/.test(text) && !text.includes("/") && inventory.steps.some((step) => step.chapter === text);
  if (!isChapter) return [resolveAddress(inventory, address)];
  return inventory.steps.filter((step) => step.chapter === text);
}

/**
 * Render one step at one width. Deep-linking seeks straight to the step, so
 * nothing before it is played. This is a cold seek, not a walk: durable
 * module-scope input state (sliders, answers) is at its initial value here,
 * while `verify` walks the deck. Use it for layout/visual iteration; the gate
 * remains authoritative.
 *
 * `checks: true` adds the a11y + keyboard audit. Default is the cheap visual
 * check (layout, spill, clipping, console errors): iteration wants pixels, and
 * the gate audits accessibility anyway.
 */
export async function shoot(browser, { name, file, inventory, address, width = 720, out, checks = false }) {
  const target = resolveAddress(inventory, address);
  const errors = [];
  const page = await browser.newPage({ viewport: { width, height: viewportHeight }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || (m.type() === "warning" && m.text().includes("puppet-show:"))) errors.push(m.text());
  });
  const destination = out ?? shotPath(name, target, width);
  try {
    await page.goto(`${pathToFileURL(resolve(file)).href}#${target.hash}`);
    await waitForDeck(page, () => !!document.querySelector(".ps-deck[data-total]"));
    await page.evaluate(() => document.fonts.ready);
    const index = Number(await page.locator(".ps-deck").getAttribute("data-index"));
    if (index + 1 !== target.index) throw new Error(`address ${target.address} says step ${target.index}, but the deck opened step ${index + 1}: the deck's step structure moved. Run the full gate (or \`npm run scenes -- <name> --refresh\`) to re-index addresses.`);
    await paused(page, index);
    const issues = await layoutIssues(page);
    if (checks) issues.push(...await page.evaluate(inspectA11y));
    if (checks && target.index === 1) {
      issues.push(...await keyboardIssues(page));
      // Tab reachability can scroll to the footer; capture the top of the step.
      await page.evaluate(() => scrollTo(0, 0));
    }
    const tallStage = await page.evaluate(stageSize);
    const digest = await signature(page);
    mkdirSync(dirname(destination), { recursive: true });
    await page.screenshot({ path: destination, fullPage: true });
    return { target, width, png: destination, signature: digest, tallStage, issues, errors };
  } catch (e) { throw await diagnostic(page, e); }
  finally { await page.close(); }
}

