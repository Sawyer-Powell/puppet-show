// Installed-browser smoke: node scripts/test-portable.mjs (never installs a browser).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from './chrome.mjs';

const cli = fileURLToPath(new URL('../bin/puppet-show.mjs', import.meta.url));
// Fail before scaffolding when Chrome is unavailable; CHROME is honored by the CLI.
const browser = findChrome();
const workspace = await mkdtemp(join(tmpdir(), 'puppet-show-portable-smoke-'));
const project = join(workspace, 'external explainer');
const run = (...args) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: workspace, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, CHROME: browser, PUPPET_SHOW_PROJECT: '' },
  });
  if (result.error) throw result.error;
  return { ...result, output: `${result.stdout}\n${result.stderr}` };
};

try {
  const init = run('init', project, '--title', 'Portable smoke');
  assert.equal(init.status, 0, init.output);
  assert.match(init.output, /created/);
  await assert.rejects(access(join(project, 'node_modules')), { code: 'ENOENT' });

  const checked = run('check', '--dir', project);
  assert.equal(checked.status, 0, checked.output);
  assert.match(checked.output, /ok\s*·\s*4 steps/);
  await access(join(project, 'dist/index.html'));
  const artifacts = join(project, '.puppet-show');
  const sheets = (await readdir(artifacts)).filter(name => /^sheet-\d+\.png$/.test(name));
  assert.ok(sheets.length > 0, 'check must produce captioned contact sheets');
  for (const name of sheets) {
    const file = join(artifacts, name);
    assert.ok(checked.output.includes(file), `check must print ${file}`);
    const png = await readFile(file);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  assert.equal((await readdir(join(artifacts, 'steps'))).filter(name => name.endsWith('.png')).length, 4);
  await assert.rejects(access(join(project, 'node_modules')), { code: 'ENOENT' });

  // Valid TypeScript, deliberately broken runtime: the diagnostic must identify
  // the failing chapter and step, not merely say the build/check failed.
  const scene = join(project, 'scenes/02-delivery.ts');
  const original = await readFile(scene, 'utf8');
  const needle = '  received(true);';
  assert.ok(original.includes(needle), 'starter delivery fixture changed');
  await writeFile(scene, original.replace(needle, '  throw new Error("portable-smoke deliberate scene failure");\n' + needle));
  const broken = run('check', project);
  assert.notEqual(broken.status, 0, broken.output);
  assert.match(broken.output, /portable-smoke deliberate scene failure/);
  assert.match(broken.output, /chapter\s+2[^\n]*step\s+2/i);
  await assert.rejects(access(join(project, 'node_modules')), { code: 'ENOENT' });
  console.log('ok · portable CLI smoke: external scaffold, four steps, sheets, chapter/step failure, no node_modules');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
