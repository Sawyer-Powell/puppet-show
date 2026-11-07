// Shared browser checks for verify and the legacy endpoint screenshot command.
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { inspectA11y, keyboardIssues } from "./verify-a11y.mjs";
import { inspectVisibility, observeFlights, stageSize } from "./verify-visibility.mjs";

export const viewportHeight = 900; // Fixed-height Notion embed, not screenshot height.
const pageErrors = new WeakMap();
export async function diagnostic(page, error) {
  if (error.puppetShowDiagnostic) return error;
  const state = await page.evaluate(() => ({ ...document.querySelector('.ps-deck')?.dataset })).catch(() => ({}));
  const context = `chapter ${Number(state.chapter ?? -1) + 1} step ${Number(state.step ?? -1) + 1} (global step ${Number(state.index ?? -1) + 1}), data-state=${JSON.stringify(state.state ?? 'missing')}`;
  const detail = new Error(`${context}: ${state.state === 'error' ? `scene error: ${state.error ?? 'unknown'}` : error.message}\n${(pageErrors.get(page) ?? []).map(e => `  page/console: ${e}`).join('\n')}`);
  detail.puppetShowDiagnostic = true;
  return detail;
}
export async function waitForDeck(page, predicate, arg, options) {
  try {
    await page.waitForFunction(({ source, arg }) => {
      if (document.querySelector('.ps-deck')?.dataset.state === 'error') return true;
      return (0, eval)(`(${source})`)(arg);
    }, { source: predicate.toString(), arg }, options);
    if (await page.locator('.ps-deck').getAttribute('data-state') === 'error') throw new Error('scene error');
  } catch (e) { throw await diagnostic(page, e); }
}

export const chrome = () => chromium.launch({
  executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
export const imageName = (i) => `${String(i + 1).padStart(2, "0")}.png`;

export async function openDeck(browser, file, width, reduced, errors, { clock = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: viewportHeight }, deviceScaleFactor: 1,
    reducedMotion: reduced ? "reduce" : "no-preference" });
  page.setDefaultTimeout(30_000);
  pageErrors.set(page, errors);
  if (!reduced) await page.addInitScript(observeFlights);
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || (m.type() === "warning" && m.text().includes("puppet-show:"))) errors.push(m.text());
  });
  try {
    // Fake time must be installed before navigation so the deck's first frame,
    // its autoplay and the flight observer all run on the virtual clock.
    if (clock) await page.clock.install({ time: 0 });
    await page.goto(pathToFileURL(resolve(file)).href);
    await waitForDeck(page, () => !!document.querySelector('.ps-deck[data-total]'));
    await page.evaluate(() => document.fonts.ready);
    // Reduced-motion autoplay may measure connectors before the webfont has
    // loaded, then never flush again. Rebuild the first endpoint with loaded
    // fonts, matching the live pass (which continues flushing during motion).
    if (reduced && await page.locator('.ps-nav').count()) await page.keyboard.press('r');
  } catch (e) { const detail = await diagnostic(page, e); await page.close(); throw detail; }
  return page;
}

const isPaused = (i) => {
  const d = document.querySelector(".ps-deck");
  return d?.dataset.state === "paused" && Number(d.dataset.index) === i;
};

/**
 * Advance the page's fake clock until `predicate` holds. Playwright's clock
 * drives rAF, so a full animation plays in milliseconds of real time while
 * keeping the player's own frame math. Bounded: a step that never settles
 * still fails with the usual diagnostic instead of hanging.
 */
export async function runUntil(page, predicate, arg, budget = 20_000, slice = 64) {
  for (let elapsed = 0; elapsed <= budget; elapsed += slice) {
    if (await page.evaluate(predicate, arg)) return;
    await page.clock.runFor(slice);
  }
  throw await diagnostic(page, new Error(`condition not reached within ${budget}ms of playback`));
}

export async function paused(page, index, clock = false) {
  if (clock) return runUntil(page, isPaused, index);
  await waitForDeck(page, isPaused, index);
}

/**
 * Press "next" the way a learner who doesn't answer would: an optional
 * question takes a second press (skip); a required one is answered with
 * option 1. Both passes do the same, so replay signatures stay comparable.
 */
export async function advance(page) {
  const next = page.locator(".ps-nav .ps-primary");
  const deck = page.locator(".ps-deck");
  const before = await deck.getAttribute("data-index");
  // Resolve as soon as the deck does anything visible: a new step, playback,
  // or an in-place question. Waiting only for a new index would burn the whole
  // timeout on every revealed question.
  const reacted = () =>
    page
      .waitForFunction((b) => {
        const d = document.querySelector(".ps-deck");
        return d.dataset.state === 'error' || d.dataset.index !== b || d.dataset.state === "playing" || !!d.dataset.asking;
      }, before, { timeout: 1500 })
      .then(() => true, () => false);
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await deck.getAttribute("data-asking")) === "required") await page.keyboard.press("1");
    await next.click();
    if (!(await reacted())) continue;
    if (await deck.getAttribute('data-state') === 'error') throw await diagnostic(page, new Error('scene error'));
    // A revealed question keeps the index; the next press skips/submits it.
    if (await deck.getAttribute("data-index") !== before) return;
  }
  throw await diagnostic(page, new Error(`"next" did not advance from step ${Number(before) + 1} (a question may be blocking)`));
}

export async function signature(page) {
  return page.locator(".ps-stage").evaluate((stage) => {
    const copy = stage.cloneNode(true);
    copy.querySelectorAll(".ps-overlay").forEach((e) => e.replaceChildren());
    // Explicit author opt-out for intentionally live telemetry, not animation.
    copy.querySelectorAll("[data-verify-ignore]").forEach((e) => e.remove());
    // Screenshot tooling and motion helpers can leave empty style attributes.
    // Canonicalize attribute/property order without dropping actual state.
    for (const e of copy.querySelectorAll("*")) {
      if (e.hasAttribute("style")) {
        const style = [...e.style].sort().map((p) => `${p}: ${e.style.getPropertyValue(p)}${e.style.getPropertyPriority(p) ? " !important" : ""};`).join(" ");
        if (style) e.setAttribute("style", style);
        else e.removeAttribute("style");
      }
      const attrs = [...e.attributes].map((a) => [a.name, a.value]).sort(([a], [b]) => a.localeCompare(b));
      for (const a of [...e.attributes]) e.removeAttribute(a.name);
      for (const [name, value] of attrs) e.setAttribute(name, value);
    }
    // Round only decimal numbers, preserving integer labels and synthetic hashes.
    return copy.innerHTML.replace(/-?\d+\.\d+(?:e[+-]?\d+)?/gi, (n) => String(Math.round(Number(n) * 100) / 100));
  });
}

export async function layoutIssues(page) {
  const visibility = await page.evaluate(inspectVisibility);
  const layout = await page.evaluate(() => {
    const selector = (e) => {
      const parts = [];
      for (let n = e; n && n !== document.body; n = n.parentElement) {
        if (n.id) { parts.unshift(`#${CSS.escape(n.id)}`); break; }
        let s = n.localName + [...n.classList].map((c) => `.${CSS.escape(c)}`).join("");
        if (n.parentElement) s += `:nth-child(${[...n.parentElement.children].indexOf(n) + 1})`;
        parts.unshift(s);
      }
      return parts.join(" > ");
    };
    const issues = [];
    if (document.documentElement.scrollWidth > innerWidth + 1)
      issues.push(`document horizontal overflow: ${document.documentElement.scrollWidth}px > ${innerWidth}px`);
    for (const e of document.querySelectorAll(".ps-deck *")) {
      if (!e.clientWidth || !e.getClientRects().length) continue;
      const style = getComputedStyle(e);
      if (style.overflowX === "hidden" && e.scrollWidth > e.clientWidth + 1 && e.textContent.trim())
        issues.push(`${selector(e)}: ${e.scrollWidth}px > ${e.clientWidth}px; ${JSON.stringify(e.textContent.trim().replace(/\s+/g, " ").slice(0, 100))}`);
    }
    // Grouped controls (segmented choices, button rows) must line up: a member
    // whose box is taller/shorter or offset from its siblings is a visual bug.
    for (const group of document.querySelectorAll(".ps-deck [role=radiogroup], .ps-deck [role=group]")) {
      const items = [...group.children].filter((c) => c.matches("button, [role=radio]") && c.getClientRects().length);
      if (items.length < 2) continue;
      const rects = items.map((c) => c.getBoundingClientRect());
      const rows = new Map();
      for (const r of rects) {
        const key = Math.round(r.top / 4);
        rows.set(key, [...(rows.get(key) ?? []), r]);
      }
      for (const row of rows.values()) {
        const h = row.map((r) => r.height), t = row.map((r) => r.top);
        if (Math.max(...h) - Math.min(...h) > 1 || Math.max(...t) - Math.min(...t) > 1)
          issues.push(`${selector(group)}: grouped controls misaligned (heights ${h.map(Math.round).join("/")}px)`);
      }
    }
    // State classes are for content; controls show state through aria attributes.
    for (const e of document.querySelectorAll(".ps-deck :is(button, input, select, [role=radio]):is(.ps-hot, .ps-live, .ps-dim, .ps-bad, .ps-ok)"))
      issues.push(`${selector(e)}: state class on a form control; use choice()/aria-checked instead`);
    return issues;
  });
  return [...layout, ...visibility];
}

export async function endpoints(browser, { file, out, width, a11y = true }) {
  mkdirSync(out, { recursive: true });
  const errors = [], issues = [], signatures = [], tallStages = [];
  const page = await openDeck(browser, file, width, true, errors);
  try {
    // The first step autoplays even with reduced motion; next finishes it.
    if (await page.locator(".ps-deck").getAttribute("data-state") === "playing")
      await page.locator(".ps-nav .ps-primary").click();
    const total = Number(await page.locator(".ps-deck").getAttribute("data-total"));
    if (!Number.isInteger(total) || total < 1) throw new Error("invalid deck data-total");
    for (let i = 0; i < total; i++) {
      await paused(page, i);
      if (i === 0 && a11y) {
        issues.push(...(await keyboardIssues(page)).map(s => `step 1: ${s}`));
        // Tab reachability may scroll to footer controls. Restore the initial
        // viewport for visibility checks, without ever scrolling a flight.
        await page.evaluate(() => scrollTo(0, 0));
      }
      const size = await page.evaluate(stageSize);
      if (size) tallStages.push(`step ${i + 1}: ${size}`);
      signatures.push(await signature(page));
      issues.push(...(await layoutIssues(page)).map((s) => `step ${i + 1}: ${s}`));
      if (a11y) issues.push(...(await page.evaluate(inspectA11y)).map(s => `step ${i + 1}: ${s}`));
      await page.screenshot({ path: resolve(out, imageName(i)), fullPage: true });
      if (i + 1 < total) await advance(page);
    }
    return { errors, issues, signatures, total, tallStages };
  } catch (e) { throw await diagnostic(page, e); }
  finally { await page.close(); }
}

const midStep = (index) => {
  const d = document.querySelector(".ps-deck");
  const p = parseFloat(document.querySelector(".ps-cell.on")?.style.getPropertyValue("--p") ?? "0");
  return Number(d?.dataset.index) === index && (p >= 0.5 || d.dataset.state === "paused");
};

/**
 * Playback pass: every step plays, is captured mid-motion, then settles.
 * `clock` (default) runs playback on Playwright's fake clock, so a 1.5s step
 * costs ~20ms of wall time instead of 1.5s. `clock: false` replays in real
 * time for timing-sensitive debugging; the checks are identical.
 * Accessibility is not audited here: the settled states are the same ones the
 * endpoint pass audits at this width, so auditing twice only doubled the cost.
 */
export async function motion(browser, { file, out, width = 720, clock = true }) {
  mkdirSync(out, { recursive: true });
  const errors = [], signatures = [], issues = [], samples = [];
  const page = await openDeck(browser, file, width, false, errors, { clock });
  try {
    const total = Number(await page.locator(".ps-deck").getAttribute("data-total"));
    for (let i = 0; i < total; i++) {
      // Wait on frame-driven progress, never a guessed sleep. Very short or
      // instant steps can finish before a capture; samples record that fact.
      if (clock) await runUntil(page, midStep, i);
      else await waitForDeck(page, midStep, i, { polling: "raf" });
      samples.push(await page.locator(".ps-cell.on").evaluate((e) => Number(e.style.getPropertyValue("--p"))));
      await page.screenshot({ path: resolve(out, imageName(i)), fullPage: true });
      await paused(page, i, clock);
      signatures.push(await signature(page));
      issues.push(...(await layoutIssues(page)).map((s) => `step ${i + 1}: ${s}`));
      if (i + 1 < total) await advance(page);
    }
    issues.push(...await page.evaluate(() => window.__puppetShowFlights ?? []));
    return { errors, issues, signatures, total, samples };
  } catch (e) { throw await diagnostic(page, e); }
  finally { await page.close(); }
}

// Chrome renders the labelled grid too: no image-processing dependencies.
export async function sheet(browser, out, total, destination, title) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  try {
    const images = Array.from({ length: total }, (_, i) => `<figure><figcaption>step ${i + 1}</figcaption><img src="data:image/png;base64,${readFileSync(resolve(out, imageName(i))).toString("base64")}"></figure>`).join("");
    await page.setContent(`<style>body{margin:16px;background:#181818;color:#eee;font:16px monospace}main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}figure{margin:0}img{width:100%;display:block}figcaption{padding:6px}</style><h1></h1><main>${images}</main>`);
    await page.locator("h1").evaluate((e, text) => { e.textContent = text; }, title);
    await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode())));
    await page.screenshot({ path: destination, fullPage: true });
  } finally { await page.close(); }
}
