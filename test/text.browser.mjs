// node test/text.browser.mjs — logical frames sample real browser geometry.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chrome } from "../scripts/verify-browser.mjs";
const server = await createServer({ configFile: false, root: process.cwd(), server: { port: 0 } });
await server.listen();
const browser = await chrome();
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto(new URL("recipes/gallery/index.html", server.resolvedUrls.local[0]).href);
  await page.evaluate(async () => {
    const { el, textMotion, countText, Runtime, Player, flush, signal } = await import("/src/index.ts");
    document.body.innerHTML = '<div class="ps-deck" id="fixture"></div>';
    const host = document.querySelector("#fixture");
    const check = (v, m) => { if (!v) throw new Error(m); };
    const sample = n => { const r = n.el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].join(); };
    const run = (task, node) => {
      const runtime = new Runtime(task), frames = [];
      for (let i = 0; i < 600; i++) {
        runtime.advance(1 / 60); flush(); frames.push(sample(node));
        if (runtime.root.done) break;
      }
      check(new Set(frames).size === 1, "container rect shifted");
    };
    for (const split of ["words", "characters", "lines"]) {
      const node = el("p", "unused"); host.append(node.el);
      const motion = textMotion(node, { text: "One `two words` *three*\nfour", markup: true, split }); flush();
      const layer = node.el.querySelector(".ps-text-layer");
      check(layer.textContent === "One two words three\nfour", "split text changed");
      check(layer.querySelector("code") && layer.querySelector("b"), "markup lost");
      check(node.el.getAttribute("aria-label") === layer.textContent && layer.getAttribute("aria-hidden") === "true", "accessible text");
      run(motion.in(), node); run(motion.out(), node); run(motion.in(), node);
    }
    const source = signal("short");
    const node = el("p"); host.append(node.el);
    const motion = textMotion(node, { text: source, reserve: ["a longer phrase"], mode: "type" });
    run(motion.in(), node);
    check(!node.el.querySelector(".ps-text-caret"), "caret remained after typing");
    const before = sample(node); run(motion.swap("a longer phrase"), node);
    check(before === sample(node) && node.el.getAttribute("aria-label") === "a longer phrase", "swap reservation");
    source("a longer phrase"); flush(); check(node.el.getAttribute("aria-label") === source(), "reactive source");
    const bound = el("p", "first"); host.append(bound.el);
    textMotion(bound, { reserve: ["second"] });
    bound.text("second"); flush();
    check(bound.el.querySelectorAll(".ps-text-layer").length === 2 && bound.el.getAttribute("aria-label") === "second", "node.text retains split layers");
    const value = el("span"); host.append(value.el);
    const counter = countText(value, { width: 6 });
    run(counter.to(1024), value); run(counter.to(-20), value);
    check(value.el.textContent === "-20" && value.el.getAttribute("aria-label") === "-20", "count final");
    let result;
    const player = new Player(function* () {
      const n = el("p", "seek lands here");
      const m = textMotion(n, { mode: "type" });
      yield* m.in(); flush(); result = n.el.innerHTML;
    }, { requestFrame: () => {} });
    player.seek(0); flush(); const first = result;
    player.seek(0); flush(); check(result === first && !result.includes("ps-text-caret"), "seek/replay differs");
    player.dispose();
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(async () => {
    const { el, textMotion, Runtime, flush } = await import("/src/index.ts");
    const n = el("p", "instant"); const m = textMotion(n); const r = new Runtime(m.in()); r.advance(0); flush();
    if (!r.root.done || n.el.querySelector('[style*="visibility: hidden"]')) throw new Error("reduced motion not instant");
  });
  console.log("PASS text geometry, markup, a11y, reactive, seek/replay and reduced motion");
} finally { await browser.close(); await server.close(); }
