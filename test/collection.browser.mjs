// Browser integration gate: node test/collection.browser.mjs
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chrome } from "../scripts/verify-browser.mjs";

const server = await createServer({
  configFile: false, root: process.cwd(), server: { port: 0 },
  plugins: [{ name: "collection-fixture", configureServer(server) {
    server.middlewares.use("/collection-fixture", (_req, res) => {
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
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(new URL("collection-fixture", server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { collection, table, signal, flush, Root, Runtime, el, slots, palette, Player, panel, box, chip } = await import("/src/index.ts");
    const { View, setView } = await import("/src/dom/view.ts");
    document.body.innerHTML = '<div class="ps-deck"><div id="stage" style="width:100%"></div></div>';
    const stage = document.querySelector("#stage");
    const view = new View(stage);
    setView(view);
    const root = new Root();
    const check = (value, message) => { if (!value) throw new Error(message); };
    const run = (task) => {
      const runtime = new Runtime(task);
      for (let i = 0; i < 600; i++) {
        const result = runtime.advance(1 / 60); flush();
        if (result.status === "done") return runtime.now;
      }
      throw new Error("task did not finish");
    };
    let renders = 0;
    const list = root.run(() => collection({ key: (r) => r.id, render: (item) => {
      renders++; return el("div", { x: 3, y: 4 }, () => item().label);
    } }));
    view.add(list);
    run(list.set([{ id: "A", label: "a" }, { id: "B", label: "b" }, { id: "C", label: "c" }]));
    const a = list.node("A"), b = list.node("B");
    const next = [{ id: "B", label: "patched" }, { id: "D", label: "new" }, { id: "A", label: "a" }];
    run(list.set(next));
    check(list.node("B") === b && list.node("A") === a, "survivor identity");
    check(b.el.textContent === "patched" && !list.node("C"), "patch and exit");
    check(b.x() === 3 && b.y() === 4 && renders === 4, "transforms and single render");
    next[0].label = "same reference"; run(list.set(next, 0));
    check(b.el.textContent === "same reference", "per-set signal refresh");
    list.remove();

    const source = signal([{ id: "A", value: "one" }, { id: "B", value: "two" }]);
    const live = signal(false);
    const t = root.run(() => table({ rows: source, key: (r) => r.id,
      columns: [{ key: "id", label: "key" }, { key: "value", label: "value", width: "450px" }],
      rowClass: () => live() ? "ps-live" : "ps-dim",
    }));
    view.add(t);
    const row = t.row("B"); row.flag("ps-hot")(true); flush();
    source([{ id: "B", value: "changed" }, { id: "a-longer-key", value: "new" }]);
    flush(); live(true); flush();
    check(t.row("B") === row && row.el.textContent.includes("changed"), "reactive row ownership");
    check(row.el.classList.contains("ps-hot") && row.el.classList.contains("ps-live"), "row flags coexist");
    check(getComputedStyle(row.el).color === "rgb(250, 189, 47)", "focus overrides live row");
    row.flag("ps-hot")(false); flush();
    check(getComputedStyle(row.el).color === "rgb(142, 192, 124)", "clearing focus restores live row");
    const header = t.el.querySelectorAll("[role=columnheader]")[1].getBoundingClientRect();
    const cell = row.el.querySelectorAll("[role=cell]")[1].getBoundingClientRect();
    check(Math.abs(header.left - cell.left) < 1, "shared column sizing");
    check(t.el.scrollWidth > t.el.clientWidth && stage.scrollWidth <= stage.clientWidth, "internal scroll only");
    t.remove();

    for (const [state, tone] of [["ps-hot", "yellow"], ["ps-live", "aqua"], ["ps-dim", "gray"], ["ps-bad", "red"], ["ps-ok", "green"]]) {
      const probe = document.createElement("span"); probe.style.color = palette[tone];
      for (const node of [panel("state"), box("state"), chip("state"), el("strong", "state"), slots(1).cell(0)]) {
        view.add(node); node.flag(state)(true); flush();
        check(getComputedStyle(node.el).color === probe.style.color, `${state} styles ${node.el.className}`);
        node.remove();
      }
    }

    const start = signal(1);
    const bytes = root.run(() => slots(8, { width: "3ch" }));
    root.run(() => bytes.mark("ps-live", (i) => i >= start() && i < start() + 3));
    view.add(bytes); flush();
    check(bytes.el.querySelectorAll(".ps-live").length === 3, "initial byte window");
    start(4); flush();
    check(bytes.cell(4).el.classList.contains("ps-live") && !bytes.cell(1).el.classList.contains("ps-live"), "reactive byte window");

    let patched;
    const player = new Player(function* () {
      const keyed = collection({ key: (r) => r.id, render: (item) => el("div", () => item().label),
        update: function* (node) { yield* node.css("color", palette.gray)(palette.green, 0.8); },
      });
      view.add(keyed);
      yield* keyed.set([{ id: "A", label: "a" }], 0);
      patched = keyed.node("A");
      yield* keyed.set([{ id: "A", label: "new" }], 1);
    });
    player.seek(0); flush();
    check(patched.el.textContent === "new" && patched.el.style.color === "rgb(184, 187, 38)", "seeking update hook");
    root.dispose();
    return { identity: true, reactiveRows: true, columns: true, internalScroll: true, slotsMark: true, seekHooks: true };
  });
  assert.deepEqual(errors, []);
  assert.ok(Object.values(result).every(Boolean));
  console.log("PASS collection/table/slots browser integration", result);
} finally {
  await browser.close();
  await server.close();
}
