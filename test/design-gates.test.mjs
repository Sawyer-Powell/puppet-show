import test from 'node:test';
import assert from 'node:assert/strict';
import { cssIssues, tsIssues, tokenMismatches } from '../scripts/lint-design.mjs';
import { apiDocIssues } from '../scripts/check-api-docs.mjs';
import { chrome } from '../scripts/verify-browser.mjs';
import { inspectA11y, keyboardIssues } from '../scripts/verify-a11y.mjs';

test('CSS lint recognizes token scopes, layers, all requested violations and local exceptions', () => {
  const css = `@layer tokens { :root { --ps-red: #f00; --ps-duration-fast: 100ms; --ps-shadow: 0 0 2px #000; } }
.x { color: var(--ps-red); transition: color var(--ps-duration-fast); box-shadow: var(--ps-shadow); }
.x { color: #fff; } /* lint-design: allow synthetic test fixture */
.x { color: rgba(0,0,0,.5); margin: 0 !important; transition: color .2s; animation-duration: 100ms; box-shadow: 0 0 2px var(--ps-red); }`;
  const issues = cssIssues(css, 'fixture.css');
  assert.equal(issues.length, 5, issues.join('\n'));
  assert.ok(issues.every(i => i.startsWith('fixture.css:4:')));
  assert.equal(cssIssues('.x { color: #fff; /* lint-design: allow */ }', 'x').length, 1, 'a reason is required');
  assert.equal(cssIssues('@layer components { .x { --ps-local: #fff; } }', 'x').length, 1);
});

test('TS lint limits colours to inline styles and catches control state classes', () => {
  const text = `const label = '#fff';
const a = { color: palette.fg, title: '#fff' }; // x.css('color', '#fff')
el('button.ps-btn', { class: 'ps-btn ps-hot' });
new Node('button', {
 class: () => active() ? 'ps-live' : 'ps-btn'
});
const b = { backgroundColor: '#ffffff' };
x.css('background-color', '#abc'); x.css('color')('#def');
const c = { color: '#fff' }; /* lint-design: allow test fixture */`;
  const issues = tsIssues(text, 'src/ui/fixture.ts');
  assert.equal(issues.filter(i => i.includes('state class')).length, 2, issues.join('\n'));
  assert.equal(issues.filter(i => i.includes('colour literal')).length, 3, issues.join('\n'));
  assert.equal(tsIssues('const p = { color: "#fff" };', 'src/ui/palette.ts').length, 0);
});

test('token sync mirrors canonical declarations verbatim and fails closed', () => {
  const src = `export const primitives = { fg: "#ebdbb2", "text-subtle": "var(--ps-fg)" }; // bg: "#000"
export const scales = { font: '"puppet-show mono", monospace' };`;
  assert.deepEqual(tokenMismatches(':root { --ps-fg: #EBDBB2; --ps-text-subtle: var(--ps-fg); --ps-font: "puppet-show mono",  monospace; }', src), []);
  assert.equal(tokenMismatches(':root { --ps-fg: #000; --ps-font: x; }', src).length, 3, 'changed, changed and missing');
  assert.equal(tokenMismatches(':root { --ps-fg: #ebdbb2; /* --ps-text-subtle: x; */ }', src).filter(i => i.includes('no --ps-text-subtle')).length, 1);
  assert.equal(tokenMismatches('', '').length, 1, 'format changes must fail closed');
});

test('box-shadows composed only of tokens pass; raw geometry or colour fails', () => {
  assert.equal(cssIssues('.x { box-shadow: 0 0 0 var(--ps-space-3) var(--ps-accent); }', 'x').length, 0);
  assert.equal(cssIssues('.x { box-shadow: inset 0 0 0 var(--ps-border-width) var(--ps-border-default), 0 0 0 0 transparent; }', 'x').length, 0);
  assert.equal(cssIssues('.x { box-shadow: 0 0 2px var(--ps-red); }', 'x').length, 1);
});

test('API coverage handles aliases, multiline lists, type-only exports and explicit low-level exceptions', () => {
  const index = `export type { Invisible } from 'x';
export { A as Public, type Hidden,\n Other, getOwner } from 'x';`;
  const issues = apiDocIssues(index, '`Public()`');
  assert.equal(issues.length, 1);
  assert.match(issues[0], /undocumented value export Other/);
  assert.equal(apiDocIssues('export { foo } from "x"', 'foobar').length, 1);
});

test('browser gates catch actual defects and accept named, opaque AA controls and roving groups', async () => {
  const browser = await chrome();
  const page = await browser.newPage();
  try {
    await page.setContent(`<style>body{background:#000;color:#fff}button{color:#fff;background:#000}button:focus-visible{outline:3px solid yellow}</style>
      <div class="ps-deck" tabindex="-1"><p>Readable</p><button>Named</button><span id="label" hidden>Hidden reference</span><input aria-labelledby="label">
      <div role="radiogroup"><button role="radio" aria-checked="true" tabindex="0">One</button><button role="radio" aria-checked="false" tabindex="-1">Two</button></div></div>`);
    assert.deepEqual(await page.evaluate(inspectA11y), []);
    assert.deepEqual(await keyboardIssues(page), []);
    await page.setContent(`<style>body{background:#fff;color:#000}.bad{color:#aaa}.large{font-size:24px;color:#777}button:focus-visible{outline:none;box-shadow:none}</style>
      <div class="ps-deck"><p class="bad">Low contrast</p><p style="opacity:.5">Settled faded text</p><p class="large">Large text passes 3:1</p>
      <button></button><button><span aria-hidden="true">Decorative only</span></button><div role="radio">Orphan</div>
      <div role="radiogroup"><button role="radio" aria-checked="true">One</button><button role="radio" aria-checked="false">Two</button></div>
      <div role="button" aria-label="Outer"><button>Inner</button></div>
      <b id="dup">A</b><b id="dup">B</b><button tabindex="-1">Unreachable</button>
      <div data-verify-ignore><button></button><p class="bad">Ignored</p></div></div>`);
    const issues = await page.evaluate(inspectA11y);
    for (const category of ['contrast', 'name', 'radio-group', 'radio-state', 'roving-tabindex', 'nested-control', 'duplicate-id']) assert.ok(issues.some(i => i.startsWith(`a11y ${category}:`)), `${category}: ${issues.join('\n')}`);
    assert.equal(issues.filter(i => i.startsWith('a11y contrast:')).length, 2, issues.join('\n'));
    assert.equal(issues.filter(i => i.startsWith('a11y name:')).length, 2, 'aria-hidden decoration is not a name');
    assert.ok(issues.every(i => !i.includes('Ignored')));
    const keyboard = await keyboardIssues(page);
    assert.ok(keyboard.some(i => i.includes('focus-visible')));
    assert.ok(keyboard.some(i => i.includes('keyboard-reach') && i.includes('Unreachable')));
    await page.setContent('<style>button:focus-visible{outline:none;box-shadow:0 0 0 3px transparent}</style><div class="ps-deck"><button>Transparent ring</button></div>');
    assert.ok((await keyboardIssues(page)).some(i => i.includes('focus-visible')), 'transparent shadows are not visible focus');
    await page.addStyleTag({ content: 'button:focus-visible{box-shadow:0 0 0 3px red}' });
    assert.deepEqual(await keyboardIssues(page), [], 'a visible shadow-only focus ring passes');
  } finally { await browser.close(); }
});
