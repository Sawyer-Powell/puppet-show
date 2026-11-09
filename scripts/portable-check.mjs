import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';
import { packageRoot, typecheckProject } from './project.mjs';
import { chrome, openDeck } from './verify-browser.mjs';
import { inventory, shoot } from './frames.mjs';

export async function buildProject() {
  await build({ configFile: resolve(packageRoot, 'vite.config.ts'), logLevel: 'silent' });
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Captioned two-column sheets: 584px tiles keep scene text readable. */
export async function captionSheets(browser, shots, root) {
  const paths = [];
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 1 });
  try {
    for (let start = 0; start < shots.length; start += 12) {
      const batch = shots.slice(start, start + 12);
      const tiles = batch.map((shot) => `<figure><figcaption><b>${escape(shot.target.address)}</b><div>${escape(shot.caption.replace(/\s+/g, ' ').slice(0, 220))}</div></figcaption><img src="data:image/png;base64,${readFileSync(shot.png).toString('base64')}"></figure>`).join('');
      await page.setContent(`<style>body{margin:20px;background:#181818;color:#eee;font:18px/1.4 monospace}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0;min-width:0}figcaption{padding:10px 0;overflow-wrap:anywhere}figcaption div{font:18px/1.4 sans-serif;margin-top:6px}img{width:100%;display:block}</style><main>${tiles}</main>`);
      await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode())));
      const path = resolve(root, `sheet-${paths.length + 1}.png`);
      await page.screenshot({ path, fullPage: true });
      paths.push(path);
    }
  } finally { await page.close(); }
  return paths;
}

export async function checkProject(root) {
  const start = performance.now();
  typecheckProject(root);
  await buildProject();
  const artifacts = resolve(root, '.puppet-show');
  mkdirSync(resolve(artifacts, 'steps'), { recursive: true });
  // This mode never reads an inventory or verification cache.
  for (const file of readdirSync(artifacts)) if (/^sheet-\d+\.png$/.test(file)) rmSync(resolve(artifacts, file));
  const browser = await chrome();
  const errors = [], shots = [];
  let page;
  try {
    const file = resolve(root, 'dist/index.html');
    page = await openDeck(browser, file, 720, true, errors);
    const found = await inventory(page, { onStep: (step) => {
      if (errors.length) throw new Error(`${step.address}: ${errors.join('\n')}`);
    } });
    for (const target of found.steps) {
      const shot = await shoot(browser, { page, file, inventory: found, address: target.address, width: 720,
        visualChecks: false, captureCaption: true, out: resolve(artifacts, 'steps', `${String(target.index).padStart(2, '0')}.png`) });
      if (shot.errors.length) throw new Error(`${target.address}: ${shot.errors.join('\n')}`);
      shots.push(shot);
    }
    await page.close(); page = null;
    const sheets = await captionSheets(browser, shots, artifacts);
    console.log(`ok · ${shots.length} steps · ${((performance.now() - start) / 1000).toFixed(1)}s`);
    for (const sheet of sheets) console.log(sheet);
  } finally { if (page) await page.close(); await browser.close(); }
}
