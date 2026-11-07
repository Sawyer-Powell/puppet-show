// Also run by npm run check through radio.test.ts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";

execFileSync(process.execPath, ["scripts/build.mjs", "gallery", "puppet-show-explained"], { stdio: "inherit", timeout: 60_000 });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
let server;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  const open = async (name, hash = "") => {
    await page.goto("about:blank"); // a hash-only change would not reload the page
    await page.goto(pathToFileURL(resolve(`dist/examples/${name}/index.html`)).href + hash);
    await page.waitForSelector('.ps-deck[data-state="paused"]');
  };
  const state = async group => group.locator('[role="radio"]').evaluateAll(nodes => nodes.map(n => ({
    checked: n.getAttribute("aria-checked"), tab: n.tabIndex, focused: n === document.activeElement,
  })));
  const focused = async (group, index) => assert.equal((await state(group))[index].focused, true);
  const checked = async (group, index) => {
    const values = await state(group);
    assert.deepEqual(values.map(v => v.checked), values.map((_, i) => String(i === index)));
    assert.deepEqual(values.map(v => v.tab), values.map((_, i) => i === index ? 0 : -1));
  };
  const tabContract = async group => {
    // Insert ordinary stops immediately before/after; send real Tab/Shift+Tab.
    await group.evaluate(node => {
      for (const id of ["before-radio", "after-radio"]) document.getElementById(id)?.remove();
      const before = document.createElement("button"), after = document.createElement("button");
      before.id = "before-radio"; after.id = "after-radio";
      node.before(before); node.after(after); before.focus();
    });
    await page.keyboard.press("Tab");
    const values = await state(group);
    assert.equal(values.filter(v => v.tab === 0).length, 1);
    assert.equal(values.find(v => v.tab === 0).focused, true, "Tab enters the group's single tab stop");
    await page.keyboard.press("Tab");
    assert.equal(await page.locator("#after-radio").evaluate(n => n === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal((await state(group)).find(v => v.tab === 0).focused, true);
  };
  await open("gallery");
  await page.locator(".ps-chapters button").nth(1).click();
  await page.waitForSelector('.ps-deck[data-state="paused"][data-chapter="1"]');
  await page.locator(".ps-nav button").last().click();
  await page.waitForSelector('.ps-deck[data-state="paused"][data-chapter="1"][data-step="1"]');
  const choice = page.locator(".ps-stage .ps-choice-options").first();
  await tabContract(choice);
  const length = await choice.locator('[role="radio"]').count();
  await page.keyboard.press("Home"); await checked(choice, 0); await focused(choice, 0);
  await page.keyboard.press("ArrowLeft"); await checked(choice, length - 1); await focused(choice, length - 1);
  await page.keyboard.press("ArrowRight"); await checked(choice, 0);
  await page.keyboard.press("ArrowDown"); await checked(choice, 1);
  await page.keyboard.press("ArrowUp"); await checked(choice, 0);
  await page.keyboard.press("End"); await checked(choice, length - 1);
  await choice.locator('[role="radio"]').first().focus();
  await page.keyboard.press("Space"); await checked(choice, 0);

  await open("puppet-show-explained", "#a-scene-is-a-script/4");
  await page.waitForSelector('.ps-deck[data-state="paused"][data-step="3"]');
  let ask = page.locator(".ps-ask-options").first();
  assert.equal(await ask.getAttribute("aria-label"), "In the scene above, the move takes 1s and the fade .5s. When does the fade start?");
  assert.equal(await page.locator(".ps-deck").getAttribute("data-asking"), "optional");
  await page.locator(".ps-nav button").last().click();
  assert.equal(await page.locator(".ps-deck").getAttribute("data-step"), "3"); // answer-down flow
  await tabContract(ask);
  await page.keyboard.press("ArrowDown"); await checked(ask, 1); await focused(ask, 1);
  assert.equal(await page.locator(".ps-deck").getAttribute("data-step"), "3"); // not deck navigation
  await page.keyboard.press("End"); await checked(ask, 2);
  await page.keyboard.press("ArrowRight"); await checked(ask, 0);
  await page.keyboard.press("ArrowUp"); await checked(ask, 2);
  await page.keyboard.press("Home"); await checked(ask, 0);
  await ask.locator('[role="radio"]').nth(1).focus();
  await page.keyboard.press("Space"); await checked(ask, 1);
  await page.locator(".ps-nav button").last().click();
  await page.waitForSelector('.ps-deck[data-state="paused"][data-step="4"]');
  ask = page.locator(".ps-ask-options").first();
  await checked(ask, 1);
  assert.equal(await ask.locator('[aria-disabled="true"]').count(), 3);
  await tabContract(ask);
  await page.keyboard.press("ArrowDown"); await focused(ask, 2); await checked(ask, 1);
  await page.keyboard.press("Space"); await checked(ask, 1);
  await ask.locator('[role="radio"]').first().click({ force: true }); await checked(ask, 1);

  // Fresh unanswered question still supports the deck's 1–9 shortcut.
  await open("puppet-show-explained", "#a-scene-is-a-script/4");
  await page.waitForSelector('.ps-deck[data-state="paused"][data-step="3"]');
  await page.keyboard.press("3"); await checked(page.locator(".ps-ask-options").first(), 2);

  // Dev fixture supplements the built pages with no-match and disabled inputs.
  server = await createServer({ configFile: false, root: process.cwd(), server: { port: 0 },
    plugins: [{ name: "radio-fixture", configureServer(server) {
      server.middlewares.use("/radio-fixture", (_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end("<!doctype html><html><body></body></html>");
      });
    } }],
  });
  await server.listen();
  await page.goto(new URL("radio-fixture", server.resolvedUrls.local[0]).href);
  await page.evaluate(async () => {
    const { choice, signal, ask, Runtime, flush } = await import("/src/index.ts");
    document.body.replaceChildren();
    const value = signal("none");
    const options = [{ value: "a", label: "A" }, { value: "b", label: "B", disabled: true }, { value: "c", label: "C" }];
    document.body.append(choice({ label: "Disabled choice", value, options }).el);
    const question = ask({ prompt: "Required", answer: signal(null), options, required: true, correct: "c", feedback: () => "Feedback" });
    document.body.append(question.el);
    window.radioTest = { question, value, Runtime, flush };
  });
  const fixture = page.locator('.ps-choice-options');
  assert.deepEqual((await state(fixture)).map(v => v.checked), ["false", "false", "false"]);
  assert.deepEqual((await state(fixture)).map(v => v.tab), [0, -1, -1]);
  await tabContract(fixture);
  await page.keyboard.press("ArrowDown"); await checked(fixture, 2);
  await fixture.locator('[role="radio"]').nth(1).click({ force: true }); await checked(fixture, 2);
  const question = page.locator('.ps-ask-options');
  await tabContract(question);
  await page.keyboard.press("ArrowDown"); await checked(question, 2);
  await page.evaluate(() => {
    const { question, Runtime, flush } = window.radioTest;
    new Runtime(question.reveal(0)).advance(0); question.pick(0); flush();
  });
  await checked(question, 2);
  assert.equal(await page.locator('.ps-feedback').innerText(), "Feedback");
  assert.equal(await page.locator('.ps-ask.ps-right').count(), 1);
  assert.deepEqual(errors, []);
  console.log("PASS shared radio keyboard browser integration");
} finally {
  await browser.close();
  await server?.close();
}
