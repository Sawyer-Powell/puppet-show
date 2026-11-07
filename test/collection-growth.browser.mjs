// Deterministic layout/runtime unit tests in a real browser:
// node test/collection-growth.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chrome } from "../scripts/verify-browser.mjs";

const server = await createServer({ configFile: false, root: process.cwd(), server: { port: 0 },
  plugins: [{ name: "growth-fixture", configureServer(server) {
    server.middlewares.use("/growth-fixture", (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><html><body></body></html>");
    });
  } }],
});
await server.listen();
const browser = await chrome();
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(new URL("growth-fixture", server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { collection, table, flush, Root, Runtime, el, Player, chip, fly, beat, Node: KNode } = await import("/src/index.ts");
    const { View, setView } = await import("/src/dom/view.ts");
    document.body.innerHTML = '<div class="ps-deck"><div id="stage"></div></div>';
    const view = new View(document.querySelector("#stage"));
    setView(view);
    const root = new Root();
    const check = (value, message) => { if (!value) throw new Error(message); };
    const run = (task, sample = () => {}, dt = 1 / 120) => {
      const runtime = new Runtime(task);
      for (let i = 0; i < 600; i++) {
        const state = runtime.advance(dt); flush(); sample();
        if (state.status !== "running") return;
      }
      throw new Error("task did not finish");
    };
    const clean = node => {
      for (const prop of ["height", "width", "min-height", "min-width", "overflow", "margin-bottom", "margin-right", "box-sizing", "flex-shrink", "padding-top", "border-bottom-width"])
        check(!node.el.style.getPropertyValue(prop), `leftover inline ${prop}`);
    };

    const record = root.run(() => chip("id 7"));
    const landing = root.run(() => table({ rows: [{ id: "1", value: "Ash" }], key: r => r.id,
      columns: [{ key: "id", label: "key" }, { key: "value", label: "value" }],
    }));
    view.add(record, landing); flush();
    const initialHeight = landing.el.getBoundingClientRect().height;
    const heights = [initialHeight], tokenPositions = [];
    let hookCalls = 0, finalFlightError = Infinity;
    const remove = KNode.prototype.remove;
    KNode.prototype.remove = function () {
      if (this.el.classList.contains("ps-fly")) {
        flush();
        const a = this.el.firstElementChild.getBoundingClientRect();
        const b = landing.row("7").el.getBoundingClientRect();
        finalFlightError = Math.hypot(a.left + a.width / 2 - b.left - b.width / 2,
          a.top + a.height / 2 - b.top - b.height / 2);
      }
      return remove.call(this);
    };
    run(landing.set([{ id: "1", value: "Ash" }, { id: "7", value: "Elm" }], {
      duration: 1,
      enter: function* (node, key) {
        hookCalls++; check(key === "7" && node === landing.row(key), "mounted target hook");
        yield* fly(record, node, "id 7", { duration: 0.8, arc: 0, land: true });
      },
    }), () => {
      heights.push(landing.el.getBoundingClientRect().height);
      const token = view.overlay.el.querySelector(".ps-fly > span");
      if (token) {
        const a = token.getBoundingClientRect(), b = landing.row("7").el.getBoundingClientRect();
        tokenPositions.push(Math.hypot(a.left + a.width / 2 - b.left - b.width / 2,
          a.top + a.height / 2 - b.top - b.height / 2));
      }
    });
    KNode.prototype.remove = remove;
    check(finalFlightError < 2, `exact final token centre: ${finalFlightError}`);
    check(hookCalls === 1, "enter runs once");
    check(heights.at(-1) > initialHeight + 10, "row actually grows");
    for (let i = 1; i < heights.length; i++) {
      check(heights[i] >= heights[i - 1] - 0.1, `monotone container growth: ${heights[i - 1]} -> ${heights[i]}`);
      check(heights[i] - heights[i - 1] < 3, `no single-frame snap: ${heights[i] - heights[i - 1]}`);
    }
    check(tokenPositions.at(-1) < 2, `flight lands on moving row: ${tokenPositions.at(-1)}`);
    check(landing.row("7").opacity() === 1 && !view.overlay.el.children.length, "landing cleanup");
    clean(landing.row("7"));
    let previous = heights.at(-1);
    run(landing.set([{ id: "1", value: "Ash" }], 1), () => {
      const h = landing.el.getBoundingClientRect().height;
      check(h <= previous + 0.1 && previous - h < 3, "smooth symmetric collapse");
      previous = h;
    }, 1 / 240);
    check(Math.abs(previous - initialHeight) < 0.1, "collapse final height");
    view.clear();

    // Row layout grows width, preserves authored sizing, and cancels cleanly.
    const list = root.run(() => collection({ key: r => r, layout: "row", gap: 8,
      render: item => el("div", { style: { padding: "5px", border: "1px solid", width: "80px", margin: "2px" } }, () => item()),
    }));
    view.add(list);
    const widths = [];
    run(list.set(["A", "B"], 1), () => widths.push(list.node("B")?.el.offsetWidth ?? 0));
    check(widths.some(w => w > 0 && w < 80), "row width interpolates");
    check(list.node("B").el.style.width === "80px" && list.node("B").el.style.margin === "2px" &&
      !list.node("B").el.style.overflow, "author styles restored");
    const cancelled = new Runtime(list.set(["A", "B", "C"], 1));
    cancelled.advance(0.4); flush(); cancelled.root.cancel(); flush();
    check(list.node("C").el.style.width === "80px" && !list.node("C").el.style.overflow, "cancel clears sizes");
    view.clear();

    // Seek/instant unit paths must not read layout. Compare exact final DOM
    // against independently played frames, not just two seeks.
    let seekTable, enters = 0;
    const scene = function* () {
      seekTable = table({ rows: [], key: r => r.id, columns: [{ key: "id", label: "key" }] });
      view.add(seekTable);
      yield* seekTable.set([{ id: "7" }], { duration: 1, enter: function* (row) {
        enters++; yield* fly(record, row, "7", { land: true, duration: 0.8 });
      } });
      yield* beat("inserted");
    };
    const seeking = new Player(scene);
    const measure = view.measure;
    const getStyle = window.getComputedStyle;
    const getRect = HTMLElement.prototype.getBoundingClientRect;
    const forbidden = () => { throw new Error("layout read during seek/instant"); };
    view.measure = forbidden;
    window.getComputedStyle = forbidden;
    HTMLElement.prototype.getBoundingClientRect = forbidden;
    seeking.seek(0); flush();
    const snapshot = () => seekTable.el.outerHTML.replaceAll(' style=""', '');
    const seekHTML = snapshot();
    seeking.seek(0); flush();
    check(snapshot() === seekHTML && enters >= 2, "seek/replay equality and hooks");
    clean(seekTable.row("7"));
    let instantHooks = 0;
    run(seekTable.set([{ id: "8" }], { duration: 0, enter: function* () { instantHooks++; } }));
    check(instantHooks === 0, "instant skips hooks"); clean(seekTable.row("8"));
    view.measure = measure;
    window.getComputedStyle = getStyle;
    HTMLElement.prototype.getBoundingClientRect = getRect;
    seeking.dispose(); view.clear();
    run(scene()); flush();
    check(snapshot() === seekHTML, "play/seek equality, no sizing residue");
    root.dispose();
    return { growth: true, landing: true, replay: true, row: true, instant: true, cancel: true };
  });
  assert.deepEqual(errors, []);
  assert.ok(Object.values(result).every(Boolean));
  console.log("PASS collection growth/landing/replay", result);
} finally {
  await browser.close();
  await server.close();
}
