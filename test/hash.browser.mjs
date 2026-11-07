// Also run by hash.test.ts / npm run check.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chrome, signature, paused, advance } from "../scripts/verify-browser.mjs";

execFileSync(process.execPath, ["scripts/build.mjs", "puppet-show-explained"], { stdio: "inherit", timeout: 60_000 });
const browser = await chrome();
const server = await createServer({ configFile: false, root: process.cwd(), server: { port: 0 },
  plugins: [{ name: "hash-fixture", configureServer(s) {
    s.middlewares.use("/hash-fixture", (_req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><html><body></body></html>"); });
  } }],
});
await server.listen();
const errors = [];
const newPage = async (reducedMotion = "reduce") => {
  const page = await browser.newPage({ reducedMotion, viewport: { width: 720, height: 900 } });
  page.on("pageerror", e => errors.push(String(e)));
  return page;
};
const file = pathToFileURL(resolve("dist/examples/puppet-show-explained/index.html")).href;
try {
  const page = await newPage();
  await page.goto(file);
  await paused(page, 0);
  const total = Number(await page.locator(".ps-deck").getAttribute("data-total"));
  const states = [];
  for (let i = 0; i < total; i++) {
    await paused(page, i);
    states.push({ hash: new URL(page.url()).hash, dom: await signature(page) });
    if (i + 1 < total) await advance(page);
  }
  assert.ok(states.some(s => !/\/\d+$/.test(s.hash)), "example has named beats");
  for (let i = 0; i < total; i++) {
    await page.goto(file + states[i].hash);
    await paused(page, i);
    assert.equal(await signature(page), states[i].dom, `deep link step ${i + 1}`);
  }
  await page.goto(file + states[0].hash);
  await paused(page, 0);
  await advance(page); await paused(page, 1);
  assert.equal(new URL(page.url()).hash, states[1].hash);
  await page.locator('.ps-nav button').first().click(); await paused(page, 0);
  assert.equal(new URL(page.url()).hash, states[0].hash);
  await page.evaluate(hash => { location.hash = hash; }, states[2].hash);
  await paused(page, 2);
  assert.equal(await signature(page), states[2].dom);
  await page.goto(file + "#not-a-chapter"); await paused(page, 0);
  assert.equal(new URL(page.url()).hash, states[0].hash);
  // Without reduced motion, hash navigation plays, rather than seeking to the end.
  const live = await newPage("no-preference");
  await live.goto(file + states[1].hash); await paused(live, 1);
  assert.equal(await signature(live), states[1].dom);
  await live.close();
  await page.close();

  const fixture = async (hash, mode = true, denyHistory = false) => {
    const p = await newPage();
    await p.goto(new URL("hash-fixture", server.resolvedUrls.local[0]).href + hash);
    await p.evaluate(async ({ mode, denyHistory }) => {
      if (denyHistory) {
        history.replaceState = history.pushState = () => { throw new DOMException("Opaque origin", "SecurityError"); };
      }
      const { deck, beat, say, el, depth, ask, signal, useDeck } = await import("/src/index.ts");
      window.depth = depth;
      window.make = options => deck(document.body, { hash: mode, start: 1, chapters: [
        { title: "Intro", scene: function* (view) {
          view.add(el("a", { attrs: { href: useDeck().href("second", "finish") } }, "jump"));
          if (depth() === "deep") { yield* say("extra"); yield* beat("extra"); }
          yield* say("one"); yield* beat("one");
          const q = ask({ prompt: "Required", required: true, answer: signal(null), options: [{ value: "yes", label: "Yes" }] });
          view.add(q); yield* q.wait(); yield* beat("question");
          yield* say("after"); yield* beat("after");
        } },
        { title: "Second", scene: function* () { yield* say("start"); yield* beat("start"); yield* say("finish"); yield* beat("finish"); } },
      ], ...options });
      window.d = window.make({});
    }, { mode, denyHistory });
    return p;
  };
  const off = await fixture("#untouched", false);
  await off.evaluate(() => { d.next(); d.prev(); d.goto(0, 2); d.replay(); });
  assert.equal(new URL(off.url()).hash, "#untouched");
  await off.close();
  for (const mode of [true, "push"]) {
    const denied = await fixture("#keep", mode, true);
    await denied.evaluate(() => { d.goto(0, 2); d.replay(); });
    await paused(denied, 2);
    assert.equal(new URL(denied.url()).hash, "#keep", "denied sandbox history calls are harmless");
    await denied.close();
  }
  const p = await fixture("#intro/after", "push");
  await paused(p, 2); // bypasses required question, exactly like a meter click
  assert.equal(await p.evaluate(() => d.href(0, 2)), "#intro/after");
  const before = await p.evaluate(() => history.length);
  await p.evaluate(() => d.goto(0, 0)); await paused(p, 0);
  assert.equal(await p.evaluate(() => history.length), before + 1);
  await p.goBack(); await paused(p, 2);
  await p.goForward(); await paused(p, 0);
  await p.locator('.ps-stage a').click(); await paused(p, 5);
  assert.equal(new URL(p.url()).hash, "#second/finish");
  await p.evaluate(() => d.goto(0, 2)); await paused(p, 2);
  await p.evaluate(() => depth("deep")); await paused(p, 3);
  assert.equal(new URL(p.url()).hash, "#intro/after");
  await p.evaluate(() => { location.hash = "#bad"; }); await paused(p, 5);
  assert.equal(new URL(p.url()).hash, "#second/start");
  const warnings = [];
  p.on("console", m => { if (m.type() === "warning") warnings.push(m.text()); });
  await p.evaluate(() => { window.second = make({ start: 0 }); second.goto(0, 0); });
  assert.ok(warnings.some(s => s.includes("puppet-show:") && s.includes("hash:false")));
  assert.equal(new URL(p.url()).hash, "#second/start");
  await p.close();
  assert.deepEqual(errors, []);
  console.log("hash browser checks passed");
} finally { await browser.close(); await server.close(); }
