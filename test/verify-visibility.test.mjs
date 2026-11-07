import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chrome, layoutIssues, paused, openDeck, waitForDeck, advance } from '../scripts/verify-browser.mjs';
import { inspectVisibility, observeFlights, stageSize } from '../scripts/verify-visibility.mjs';
import { createServer } from 'vite';

const fixture = `<style>body{margin:0}.ps-overlay{position:absolute;inset:0;pointer-events:none}.ps-fly{position:absolute;left:0;top:0}.target{position:absolute;left:200px;top:200px;width:40px;height:20px}</style>
<div class="ps-deck" data-total="1" data-state="paused" data-chapter="2" data-step="3" data-index="8"><div class="ps-stage"><div class="ps-view-content"><div class="target">destination</div></div><div class="ps-overlay"></div></div></div>`;

test('text spill and highlighted clipping: real defects fail, ordinary scrollers and wrapped text pass', async () => {
  const browser = await chrome();
  const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
  try {
    await page.setContent(`<div class="ps-deck"><div style="width:100px;overflow:auto"><div style="width:400px">plain scrolling table</div></div><div style="width:80px;overflow-wrap:anywhere">longbutwrappedtext</div><div class="ps-hot" style="width:80px">visible</div></div>`);
    assert.deepEqual(await page.evaluate(inspectVisibility), []);
    await page.setContent(`<div class="ps-deck"><div id="spill" style="width:40px;white-space:nowrap"><span>long nowrap text</span></div><div id="scroller" style="width:100px;overflow:auto"><div class="ps-hot" role="row" style="width:400px;display:flex"><div role="cell" style="margin-left:300px">important</div></div></div></div>`);
    const issues = await layoutIssues(page);
    assert.ok(issues.some(i => i.includes('text spills') && i.includes('#spill')), issues.join('\n'));
    assert.ok(issues.some(i => i.includes('highlighted content clipped') && i.includes('important')), issues.join('\n'));
    await page.setContent(`<div class="ps-deck"><div style="height:40px;overflow-y:scroll"><div style="height:100px"></div><div class="ps-ok">below scrollport</div></div></div>`);
    assert.ok((await page.evaluate(inspectVisibility)).some(i => i.includes('highlighted content clipped')));
    await page.setContent(`<div class="ps-deck"><div style="width:100px;overflow:auto"><div style="width:400px"><span style="display:none" class="ps-hot">hidden intentionally</span></div></div></div>`);
    assert.deepEqual(await page.evaluate(inspectVisibility), []);
  } finally { await browser.close(); }
});

test('table width is a minimum and subgrid headers/cells retain a gap', async () => {
  const server = await createServer({ configFile: false, root: process.cwd(), server: { port: 0 }, plugins: [{ name: 'visibility-fixture', configureServer(s) {
    s.middlewares.use('/visibility-fixture', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body></body>'); });
  } }] });
  await server.listen();
  const browser = await chrome(), page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  try {
    await page.goto(new URL('visibility-fixture', server.resolvedUrls.local[0]).href);
    const result = await page.evaluate(async () => {
      const { table, Root, flush } = await import('/src/index.ts');
      const t = new Root().run(() => table({ columns: [{ key: 'a', label: 'identifier_type', width: '1ch' }, { key: 'b', label: 'identifier_value', width: 'minmax(0, 1fr)' }, { key: 'c', label: 'order_id', width: '2ch' }], rows: [{ a: 'long_synthetic_identifier', b: 'value', c: '101' }], key: () => 'one' }));
      document.body.className = 'ps-deck'; document.body.append(t.el); flush();
      await document.fonts.ready;
      const head = [...t.el.querySelectorAll('[role=columnheader]')];
      const cells = [...t.el.querySelectorAll('[role=cell]')];
      return { spill: [...head, ...cells].some(e => e.scrollWidth > e.clientWidth + 1), gap: Math.min(...[head, cells].flatMap(row => row.slice(1).map((e, i) => e.getBoundingClientRect().left - row[i].getBoundingClientRect().right))),
        aligned: Math.abs(head[1].getBoundingClientRect().left - cells[1].getBoundingClientRect().left) < 1 };
    });
    assert.equal(result.spill, false); assert.ok(result.gap >= 1, JSON.stringify(result)); assert.equal(result.aligned, true);
  } finally { await browser.close(); await server.close(); }
});

test('stage height is informational and uses viewport, not full-page screenshot height', async () => {
  const browser = await chrome(), page = await browser.newPage({ viewport: { width: 720, height: 900 } });
  try {
    await page.setContent('<style>body{margin:0}</style><div class="ps-stage" style="height:899px"></div>');
    assert.equal(await page.evaluate(stageSize), null);
    await page.setContent('<div class="ps-stage" style="height:1061px"></div>');
    assert.match(await page.evaluate(stageSize), /1061px.*900px/);
    await page.setContent('<div style="height:300px"></div><div class="ps-stage" style="height:700px"></div>');
    assert.match(await page.evaluate(stageSize), /700px.*extends past viewport/);
  } finally { await browser.close(); }
});

test('live overlay observer checks both endpoints and document/target shifts without flagging stable flights', async () => {
  const browser = await chrome();
  try {
    for (const scenario of ['stable', 'start', 'land', 'partial', 'height', 'target', 'jitter', 'after-landing']) {
      const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
      await page.setContent(fixture);
      await page.evaluate(observeFlights);
      await page.evaluate(async scenario => {
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const token = document.createElement('div'); token.className = 'ps-fly'; token.innerHTML = '<span style="display:block;transform:translate(-50%,-50%)">payload</span>';
        token.style.transform = `translate(${scenario === 'start' ? -40 : scenario === 'partial' ? 2 : 30}px, 30px)`;
        document.querySelector('.ps-overlay').append(token);
        await frame(); await frame();
        token.style.transform = `translate(220px, ${scenario === 'land' ? 1000 : 210}px)`;
        if (scenario === 'height') document.body.style.minHeight = '1100px';
        if (scenario === 'target' || scenario === 'jitter') document.querySelector('.target').style.top = scenario === 'target' ? '220px' : '202px';
        await frame(); await frame();
        token.remove();
        if (scenario === 'after-landing') {
          document.body.style.minHeight = '1100px';
          document.querySelector('.target').style.top = '250px';
        }
        await frame();
      }, scenario);
      const issues = await page.evaluate(() => window.__puppetShowFlights);
      if (scenario === 'stable' || scenario === 'jitter' || scenario === 'partial' || scenario === 'after-landing') assert.deepEqual(issues, [], scenario);
      else {
        assert.ok(issues.some(i => i.includes(scenario === 'start' ? 'starts outside' : scenario === 'land' ? 'lands outside' : 'layout shifted')), `${scenario}: ${issues.join('\n')}`);
        assert.ok(issues.every(i => i.includes('chapter 3 step 4') && i.includes('payload') && i.includes('target')));
      }
      await page.close();
    }
  } finally { await browser.close(); }
});

test('state waits stop on deck error, preserve console/page errors on timeout, and accept a real pause', async () => {
  const browser = await chrome(), dir = mkdtempSync(join(tmpdir(), 'puppet-show-visibility-'));
  try {
    const file = join(dir, 'fixture.html'); writeFileSync(file, fixture);
    const errors = [], page = await openDeck(browser, file, 720, true, errors);
    await paused(page, 8);
    await page.evaluate(() => { console.error('fixture console error'); setTimeout(() => { throw new Error('fixture page error'); }, 0); });
    await page.waitForFunction(() => true);
    await assert.rejects(waitForDeck(page, () => false, undefined, { timeout: 100 }), /chapter 3 step 4[\s\S]*data-state="paused"[\s\S]*fixture console error[\s\S]*fixture page error/);
    await page.evaluate(() => { const d = document.querySelector('.ps-deck'); d.dataset.state = 'error'; d.dataset.error = 'broken scene'; });
    await assert.rejects(paused(page, 9), /chapter 3 step 4[\s\S]*data-state="error"[\s\S]*scene error: broken scene/);
    await page.evaluate(() => {
      const d = document.querySelector('.ps-deck'); d.dataset.state = 'paused';
      const nav = document.createElement('div'); nav.className = 'ps-nav';
      nav.innerHTML = '<button class="ps-primary">next</button>'; d.append(nav);
      nav.firstChild.onclick = () => { d.dataset.state = 'error'; d.dataset.error = 'advance broke'; };
    });
    await assert.rejects(advance(page), /chapter 3 step 4[\s\S]*scene error: advance broke/);
    await page.close();
    writeFileSync(file, fixture.replace('data-state="paused"', 'data-state="error" data-error="startup broke"'));
    await assert.rejects(openDeck(browser, file, 720, true, []), /chapter 3 step 4[\s\S]*scene error: startup broke/);
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});
