// Browser integration gate: node test/sequence.browser.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createServer } from "vite";
import { chrome } from "../scripts/verify-browser.mjs";

const server = await createServer({
  configFile: false, root: process.cwd(), server: { port: 0 },
  plugins: [{ name: "sequence-fixture", configureServer(server) {
    server.middlewares.use("/sequence-fixture", (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><html><body></body></html>");
    });
  } }],
});
await server.listen();
const browser = await chrome();
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 650 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(new URL("sequence-fixture", server.resolvedUrls.local[0]).href);
  await page.evaluate(async () => {
    await import("/src/ui/puppet-show.css");
    const { View, setView } = await import("/src/dom/view.ts");
    const { seqDiagram } = await import("/src/ui/sequence.ts");
    const { flush } = await import("/src/core/signal.ts");
    const { palette } = await import("/src/ui/palette.ts");
    document.body.innerHTML = '<div class="ps-deck" style="width:100%;box-sizing:border-box"><div id="stage"></div></div>';
    const view = new View(document.querySelector("#stage"));
    setView(view);
    const options = { hosts: [{ id: "a", label: "client" }, { id: "b", label: "server" }], rows: 4 };
    const diagram = seqDiagram(options);
    view.add(diagram);
    const normal = diagram.message("a", "b", "request", { at: 0, tone: palette.blue, draw: 0 });
    const lost = diagram.message("b", "a", "reply lost", { at: 1, tone: "green", lost: true });
    const retry = diagram.message("a", "b", "retry", { at: 2, tone: "yellow" });
    diagram.message("b", "a", "reply", { at: 3, tone: "green" });
    const rejects = (fn) => { try { fn(); return false; } catch { return true; } };
    window.validation = [
      rejects(() => seqDiagram({ ...options, rows: 0 })),
      rejects(() => seqDiagram({ ...options, hosts: [options.hosts[0], options.hosts[0]] })),
      rejects(() => diagram.message("missing", "b", "bad", { at: 0 })),
      rejects(() => diagram.message("a", "b", "bad", { at: 4 })),
      rejects(() => diagram.message("a", "b", "bad", { at: 0.5 })),
      rejects(() => diagram.message("a", "a", "bad", { at: 0 })),
    ];
    flush();
    window.initiallyHidden = normal.el.style.visibility === "hidden";
    normal.draw(1); flush();
    window.correctColors = normal.color() === palette.blue && lost.color() === palette.red
      && normal.el.style.getPropertyValue("--ps-seq-color") === "var(--ps-blue)"
      && lost.el.style.getPropertyValue("--ps-seq-color") === "var(--ps-red)";
    window.drawn = normal.el.style.visibility !== "hidden";
    window.fixture = { normal, lost, retry, flush };
  });
  assert.deepEqual(await page.evaluate(() => window.validation), Array(6).fill(true));
  assert.equal(await page.evaluate(() => window.initiallyHidden && window.drawn && window.correctColors), true);
  mkdirSync(".scratch/sequence", { recursive: true });
  let previous;
  for (const width of [720, 420]) {
    await page.setViewportSize({ width, height: 650 });
    await page.waitForTimeout(100);
    const geometry = await page.evaluate(() => {
      const { normal, lost, flush } = window.fixture;
      flush();
      const coords = (edge) => edge.el.querySelector("path").getAttribute("d").match(/-?\d+(?:\.\d+)?/g).map(Number);
      return { normal: coords(normal), lost: coords(lost), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(geometry.overflow, false);
    const [x1, y1, x2, y2] = geometry.normal;
    const [lx1, ly1, lx2, ly2] = geometry.lost;
    assert.ok(x2 > x1 && y2 > y1);
    assert.ok(lx1 > lx2 && ly2 > ly1);
    assert.ok(Math.abs(lx2 - (x1 + x2) / 2) < 1, "lost endpoint is halfway between lifelines");
    assert.ok(Math.abs((ly2 - ly1) - (y2 - y1) / 2) < 1, "lost time is half a row");
    if (previous) assert.notEqual(x2, previous.normal[2], "geometry follows resize");
    previous = geometry;
    await page.screenshot({ path: `.scratch/sequence/${width}.png` });
  }
  await page.evaluate(() => { window.fixture.retry.remove(); window.fixture.flush(); });
  assert.equal(await page.locator(".ps-seq-label").count(), 3);
  assert.deepEqual(errors, []);
  console.log("PASS sequence browser: validation, colors, draw, loss geometry, resize, removal (720/420)");
} finally {
  await browser.close();
  await server.close();
}
