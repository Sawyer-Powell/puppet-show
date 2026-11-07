import assert from "node:assert/strict";
import { createServer } from "vite";
import { chrome } from "../scripts/verify-browser.mjs";

const server = await createServer({ configFile: false, root: process.cwd(), server: { port: 0 },
  plugins: [{ name: "chrome-fixture", configureServer(s) {
    s.middlewares.use("/chrome-fixture", (_req, res) => {
      res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html><head><link rel="stylesheet" href="/src/ui/puppet-show.css"></head><body></body></html>');
    });
  } }],
});
await server.listen();
const browser = await chrome();
try {
  for (const width of [720, 420]) for (const reducedMotion of ["reduce", "no-preference"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(new URL("chrome-fixture", server.resolvedUrls.local[0]).href);
    await page.evaluate(async () => {
      const { deck, say, beat, ask, signal } = await import("/src/index.ts");
      window.make = (questions = false) => deck(document.body, { hash: false,
        chapters: Array.from({ length: 8 }, (_, i) => ({ title: `chapter ${i + 1} explanation`, scene: function* (view) {
          yield* say("Instant caption"); yield* beat();
          yield* say("Typed caption", { typed: true, duration: 0.5 }); yield* beat();
          yield say("Forked caption", { typed: true, duration: 2 }); yield* beat();
          if (questions && i === 7) view.add(ask({ prompt: "Pick", answer: signal(null), options: [{ value: "a", label: "A" }] }));
        } })),
      });
      window.d = make();
    });
    await page.waitForFunction(() => document.querySelector(".ps-deck").dataset.state === "paused");
    assert.equal(await page.locator(".ps-cursor").count(), 0);
    assert.ok(!(await page.locator(".ps-keys").innerText()).includes("answer"));
    assert.equal(await page.locator(".ps-depth").count(), 0);
    await page.evaluate(() => d.goto(7, 0));
    await page.waitForTimeout(50);
    const geometry = await page.evaluate(() => {
      const tabs = document.querySelector(".ps-chapters"), buttons = [...tabs.children];
      const a = tabs.getBoundingClientRect(), b = buttons[7].getBoundingClientRect();
      return { tops: buttons.map(x => x.getBoundingClientRect().top), left: b.left, right: b.right, min: a.left, max: a.right, y: scrollY };
    });
    assert.equal(new Set(geometry.tops).size, 1);
    assert.ok(geometry.left >= geometry.min - 1 && geometry.right <= geometry.max + 1, JSON.stringify(geometry));
    assert.equal(geometry.y, 0);
    await page.locator('[role=tab]').last().focus();
    await page.keyboard.press("Home");
    assert.equal(await page.locator('[role=tab][aria-selected=true]').innerText(), "01 chapter 1 explanation");
    assert.equal(await page.locator('[role=tab][tabindex="0"]').count(), 1);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    assert.equal(await page.locator(".ps-deck").getAttribute("data-step"), "0");
    await page.evaluate(() => d.goto(0, 1));
    if (reducedMotion === "no-preference") {
      await page.waitForSelector(".ps-cursor");
    }
    await page.waitForFunction(() => document.querySelector(".ps-deck").dataset.state === "paused");
    assert.equal(await page.locator(".ps-cursor").count(), 0);
    await page.evaluate(() => d.goto(0, 2));
    await page.waitForFunction(() => document.querySelector(".ps-deck").dataset.state === "paused");
    assert.equal(await page.locator(".ps-cursor").count(), 0, "paused partial typing has no cursor");
    await page.evaluate(() => { document.body.replaceChildren(); window.d = make(true); });
    assert.ok((await page.locator(".ps-keys").innerText()).includes("answer"), "ask in later chapter registered during analysis");
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("deck chrome browser tests passed");
} finally { await browser.close(); await server.close(); }
