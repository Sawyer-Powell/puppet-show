// Browser/CSP/performance gate: npm run test:debugger (Node's strip-types loads fixture types).
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fixtureTrace, fixtureSession, fixtureNotes } from "../examples/debugger-fixture/stops.ts";
import { chrome } from "./verify-browser.mjs";

// Native strip-types produces executable JavaScript for this self-contained,
// deterministic fixture generator. It lives in an external module, not eval.
const bootstrap = `import {mountDebugger} from './debugger.js';
const generate = ${fixtureTrace.toString()};
const trace = generate(10000), session = ${JSON.stringify(fixtureSession)};
let receive, respond = true, liveSeq = 9999;
const wrap = stop => { if (stop) stop.data.clock = {ok:true,value:stop.data.clock}; return stop; };
const show = seq => receive({type:'stop',stop:wrap(trace.stop(seq)),prev:wrap(trace.prev(seq))});
const app = mountDebugger(document.body, {
  onMessage: callback => {receive=callback;return()=>{receive=null}},
  post: message => {
    if(message.type==='get' && respond) show(message.seq);
    if(message.type==='live' && respond) show(liveSeq);
  }
});
receive({type:'session',session});
receive({type:'notes',notes:${JSON.stringify(fixtureNotes)}});
receive({type:'index',from:0,items:trace.index});
trace.series.forEach((values,line)=>receive({type:'series',id:'time',line,from:0,values}));
receive({type:'status',state:'running',head:9999,total:10000});
const key = (key,shiftKey=false) => document.querySelector('.x-state-scrub').dispatchEvent(new KeyboardEvent('keydown',{key,shiftKey,bubbles:true}));
globalThis.pane = {app,receive,trace,session,key,setLive:value=>{liveSeq=value},setRespond:value=>{respond=value},measure:(n=1000)=>{
 key('Home'); for(let i=0;i<20;i++) key('ArrowRight');
 const samples=[];
 for(let i=0;i<n;i++){const start=performance.now();key('ArrowRight');samples.push(performance.now()-start)}
 samples.sort((a,b)=>a-b);
 return {moves:n,mean:samples.reduce((a,b)=>a+b,0)/n,p50:samples[Math.floor(n*.5)],p95:samples[Math.floor(n*.95)],max:samples.at(-1),dom:document.querySelectorAll('*').length};
}};`;
const server = http.createServer((request, response) => {
  const name = request.url.slice(1);
  if (!name) {
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data:");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/debugger.css"><script type="module" src="/bootstrap.js"></script>');
  } else if (name === "bootstrap.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8"); response.end(bootstrap);
  } else if (["debugger.js", "debugger.css"].includes(name)) {
    response.setHeader("Content-Type", name.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
    response.end(readFileSync(`dist/webview/${name}`));
  } else { response.statusCode = 204; response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chrome();
  const page = await browser.newPage({ viewport: { width: 400, height: 820 } });
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => {
    if (message.type() === "error" || (message.type() === "warning" && message.text().includes("puppet-show:"))) errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => globalThis.pane);
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => {
    const root = document.querySelector(".x-state-debugger");
    const body = document.querySelector('[data-view-id="threads"] .x-declared-body');
    const last = [...body.querySelectorAll(".ps-tl-label")].at(-1);
    return {
      width: document.documentElement.scrollWidth, bottom: root.getBoundingClientRect().bottom,
      viewsTop: document.querySelector(".x-state-grid").getBoundingClientRect().top,
      threadBottom: body.getBoundingClientRect().bottom, lastThread: last.getBoundingClientRect().bottom,
      dom: root.querySelectorAll("*").length, canvases: root.querySelectorAll("canvas").length,
    };
  });
  assert.equal(layout.width, 400);
  assert.ok(layout.bottom <= 820 && layout.viewsTop < 200);
  assert.ok(layout.lastThread <= layout.threadBottom + 1);
  assert.ok(layout.dom < 500);
  assert.equal(layout.canvases, 3);
  assert.equal(await page.locator(".ps-code").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Continue", exact: true }).count(), 0);

  const fullRender = await page.evaluate(() => pane.measure());
  await page.evaluate(() => pane.setRespond(false));
  const cursorOnly = await page.evaluate(() => pane.measure());
  await page.evaluate(() => { pane.setRespond(true); pane.key("Home"); pane.key("ArrowRight"); pane.key("ArrowRight", true); });
  assert.match(await page.locator(".x-state-count").innerText(), /^3 \/ 10000$/);
  await page.evaluate(() => pane.receive({ type: "stop", stop: pane.trace.stop(500), prev: pane.trace.prev(500) }));
  assert.match(await page.locator(".x-state-count").innerText(), /^3 \/ 10000$/);
  assert.ok(!(await page.locator('[data-view-id="values"]').innerText()).includes('"ok"'));
  await page.evaluate(() => { pane.key("Home"); for (let i = 0; i < 51; i++) pane.key("ArrowRight"); });
  assert.match(await page.locator(".x-state-changed").getAttribute("title"), /\+1 thread/);
  await page.locator(".x-state-scrub").focus();
  await page.keyboard.press("l");
  assert.match(await page.locator(".x-state-count").innerText(), /^10000 \/ 10000$/);
  const liveClock = await page.evaluate(() => pane.trace.stop(9999).data.clock);
  assert.equal(await page.locator('[data-view-id="values"] strong').first().innerText(), String(liveClock));

  const box = await page.locator(".x-state-cursor").boundingBox();
  await page.mouse.move(box.x + box.width * .25, box.y + 20); await page.mouse.down();
  const pointerRender = await page.evaluate(() => {
    const canvas = document.querySelector(".x-state-cursor"), bounds = canvas.getBoundingClientRect(), samples = [];
    for (let i = 0; i < 500; i++) {
      const start = performance.now();
      canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: bounds.left + bounds.width * (.1 + .8 * (i % 100) / 100), clientY: bounds.top + 20, pointerId: 1 }));
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { moves: 500, mean: samples.reduce((a, b) => a + b, 0) / samples.length, p95: samples[475], max: samples.at(-1) };
  });
  await page.mouse.move(box.x + box.width * .65, box.y + 20, { steps: 8 }); await page.mouse.up();
  const seq = Number((await page.locator(".x-state-count").innerText()).split("/")[0].trim());
  assert.ok(seq > 6000 && seq < 7000);
  assert.equal(await page.locator(".x-state-bp").innerText(), "join");
  const out = "node_modules/.cache/puppet-show/debugger"; mkdirSync(out, { recursive: true });
  await page.screenshot({ path: `${out}/state-400.png`, fullPage: true });
  assert.ok(await page.locator(".x-declared-event").count() <= 6);
  const beforeEventScroll = await page.locator(".x-state-count").innerText();
  await page.locator('[data-view-id="events"] .x-declared-body').evaluate(body => { body.scrollTop = 0; });
  const firstEvent = await page.evaluate(() => pane.trace.index.find(item => item.bp === "join").seq);
  await page.waitForFunction(seq => document.querySelector('[data-view-id="events"] .x-declared-event')?.textContent.includes(`#${seq} `), firstEvent);
  assert.equal(await page.locator(".x-state-count").innerText(), beforeEventScroll);
  const eventSeq = Number((await page.locator(".x-declared-event").first().innerText()).match(/\d+/)[0]);
  await page.locator(".x-declared-event").first().click();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator(".x-state-count").innerText(), `${eventSeq + 2} / 10000`);
  await page.evaluate(() => { pane.receive({ type: "status", state: "exited", head: null, total: 10000, first: 9000 }); pane.key("Home"); });
  assert.match(await page.locator(".x-state-count").innerText(), /^9001 \/ 10000$/);

  // Live follow animates structural changes, while historical scrubs snap.
  await page.evaluate(() => {
    pane.setLive(50);
    pane.receive({ type: "session", session: pane.session });
    pane.receive({ type: "index", from: 0, items: pane.trace.index.slice(0, 51) });
    pane.receive({ type: "status", state: "running", head: 50, total: 51 });
    globalThis.stableRow = document.querySelector('[data-view-id="nodes"] .ps-table-row');
    pane.setLive(51);
    pane.receive({ type: "index", from: 51, items: pane.trace.index.slice(51, 52) });
  });
  assert.equal(await page.locator('[data-view-id="nodes"] .ps-table-row').count(), 2);
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-view-id="nodes"] .ps-table-row:last-child').evaluate(row => getComputedStyle(row).opacity), "1");
  await page.evaluate(() => { pane.setLive(100); pane.receive({ type: "index", from: 52, items: pane.trace.index.slice(52, 101) }); });
  assert.ok(await page.locator(".x-declared-exit").count() > 0);
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".x-declared-exit").count(), 0);
  assert.equal(await page.evaluate(() => stableRow === document.querySelector('[data-view-id="nodes"] .ps-table-row')), true);
  // Recording replies can trail the compact index by a batch. They must still
  // advance the displayed state instead of starving until recording ends.
  await page.evaluate(() => {
    pane.setRespond(false);
    pane.receive({ type: "index", from: 101, items: pane.trace.index.slice(101, 111) });
    pane.receive({ type: "status", state: "running", head: null, total: 111 });
    pane.receive({ type: "stop", stop: pane.trace.stop(109), prev: pane.trace.prev(109) });
  });
  assert.match(await page.locator(".x-state-count").innerText(), /^110 \/ 111$/);
  await page.evaluate(() => {
    pane.receive({ type: "index", from: 111, items: pane.trace.index.slice(111, 121) });
    pane.receive({ type: "status", state: "running", head: null, total: 121 });
    pane.receive({ type: "stop", stop: pane.trace.stop(119), prev: pane.trace.prev(119) });
    pane.receive({ type: "stop", stop: pane.trace.stop(105), prev: pane.trace.prev(105) });
  });
  assert.match(await page.locator(".x-state-count").innerText(), /^120 \/ 121$/);
  await page.evaluate(() => { pane.setRespond(true); pane.setLive(120); pane.key("l"); });
  assert.equal(await page.locator(".x-state-debugger").getAttribute("data-pending"), "false");
  await page.evaluate(() => pane.receive({ type: "notes", notes: { "*": "*Session* note <img>" } }));
  assert.equal(await page.locator(".x-state-note b").innerText(), "Session");
  assert.equal(await page.locator(".x-state-note img").count(), 0);
  await page.evaluate(() => {
    const bp = pane.trace.stop(120).agent.breakpointId;
    pane.receive({ type: "notes", notes: { "*": "fallback", [bp]: "Breakpoint note", [`${bp}:120`]: "Specific `clock` state" } });
  });
  assert.equal(await page.locator(".x-state-note code").innerText(), "clock");
  assert.match(await page.locator(".x-state-note").innerText(), /^Specific/);
  assert.deepEqual(errors, []);
  const results = { environment: { node: process.version, chrome: browser.version(), platform: `${process.platform}/${process.arch}` }, stops: 10000, fullRenderMs: fullRender, pointerRenderMs: pointerRender, cursorOnlyMs: cursorOnly, layout };
  writeFileSync(`${out}/performance.json`, JSON.stringify(results, null, 2) + "\n");
  console.log("PASS strict CSP, 400px state pane, selectors, history/keys/drag, eviction, keyed live enter/exit");
  console.log(JSON.stringify(results, null, 2));
  console.log(`Artifacts: ${out}/`);
  await page.evaluate(() => pane.app.dispose());
  assert.equal(await page.locator(".x-state-debugger").count(), 0);
} finally {
  try { await browser?.close(); } finally { server.close(); }
}
