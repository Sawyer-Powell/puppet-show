import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { detectProject, help, parseArgs } from '../scripts/portable-args.mjs';
import { initProject, printDocs } from '../scripts/portable-content.mjs';
import { packageRoot, projectContext } from '../scripts/project.mjs';

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'puppet-show-portable-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function withProject(value, run) {
  const previous = process.env.PUPPET_SHOW_PROJECT;
  if (value === undefined) delete process.env.PUPPET_SHOW_PROJECT;
  else process.env.PUPPET_SHOW_PROJECT = value;
  try { return run(); } finally {
    if (previous === undefined) delete process.env.PUPPET_SHOW_PROJECT;
    else process.env.PUPPET_SHOW_PROJECT = previous;
  }
}

test('argument defaults and help describe the portable fast/deep workflow', () => {
  const cwd = resolve('/tmp/portable');
  const args = parseArgs([], cwd);
  assert.equal(args.command, 'help');
  assert.equal(args.dir, cwd);
  assert.equal(args.width, 720);
  assert.equal(args.deep, false);
  assert.equal(args.topic, 'authoring');
  assert.match(help, /check/);
  assert.match(help, /--deep/);
  assert.match(help, /--dir/);
});

test('arguments resolve explicit and positional project directories against cwd', () => {
  const cwd = resolve('/tmp/portable');
  assert.equal(parseArgs(['init', 'demo', '--title', 'A title'], cwd).title, 'A title');
  for (const command of ['init', 'check', 'scenes', 'build']) {
    assert.equal(parseArgs([command, 'demo'], cwd).dir, join(cwd, 'demo'));
    assert.equal(parseArgs([command, '--dir', 'demo'], cwd).dir, join(cwd, 'demo'));
  }
  assert.equal(parseArgs(['check', '--deep'], cwd).deep, true);
  assert.equal(parseArgs(['docs', 'design'], cwd).topic, 'design');
});

test('shot distinguishes addresses from existing project paths', async (t) => {
  const cwd = await temporary(t);
  const project = join(cwd, 'demo');
  await mkdir(project);
  await writeFile(join(project, 'index.html'), '');
  const args = parseArgs(['shot', 'demo', 'value/start', 'delivery', '--width', '420'], cwd);
  assert.equal(args.dir, project);
  assert.deepEqual(args.addresses, ['value/start', 'delivery']);
  assert.equal(args.width, 420);
  assert.deepEqual(parseArgs(['shot', 'value/start'], cwd).addresses, ['value/start']);
  assert.deepEqual(parseArgs(['shot', '--dir', 'demo', '2'], cwd).addresses, ['2']);
});

test('invalid arguments fail instead of silently changing command behavior', () => {
  for (const [args, message] of [
    [['wat'], /unknown command/], [['check', '--wat'], /unknown flag/],
    [['check', '--dir'], /requires a value/], [['init'], /requires a directory/],
    [['init', 'one', 'two'], /unexpected argument/], [['check', 'one', 'two'], /unexpected argument/],
    [['check', '--title', 'Title'], /only for init/], [['build', '--deep'], /only for check/],
    [['check', '--width', '420'], /only for shot/], [['shot'], /requires a step/],
    [['docs', 'api', 'design'], /one topic/],
    ...['199', '4001', 'NaN', '420.5'].map(width => [['shot', '1', '--width', width], /integer 200-4000/]),
  ]) assert.throws(() => parseArgs(args), message, JSON.stringify(args));
});

test('scaffold contains portable imports, escaped title, and four-step scenes', async (t) => {
  const root = join(await temporary(t), 'explainer');
  const result = await initProject(root, { title: 'A <value> & "delivery"' });
  assert.equal(result.dir, root);
  for (const file of ['index.html', 'main.ts', 'style.css', 'scenes/01-value.ts', 'scenes/02-delivery.ts', 'AGENTS.md', 'README.md']) {
    assert.ok(result.files.includes(file), file);
    assert.ok((await readFile(join(root, file), 'utf8')).length > 0);
  }
  assert.equal(detectProject(root), root);
  assert.match(await readFile(join(root, 'index.html'), 'utf8'), /A &lt;value&gt; &amp; &quot;delivery&quot;/);
  const main = await readFile(join(root, 'main.ts'), 'utf8');
  assert.match(main, /from "puppet-show"/);
  assert.match(main, /puppet-show\/style\.css/);
  assert.doesNotMatch(main, /\.\.\/.*src/);
  assert.match(await readFile(join(root, 'scenes/01-value.ts'), 'utf8'), /beat\("start"\)/);
  assert.match(await readFile(join(root, 'scenes/02-delivery.ts'), 'utf8'), /fly\(source, destination/);
  assert.match(await readFile(join(root, 'AGENTS.md'), 'utf8'), /check.*default fast gate/);
  assert.ok(!(await readdir(root)).includes('node_modules'));
});

test('scaffold accepts empty directories and never overwrites existing content', async (t) => {
  const root = await temporary(t);
  const empty = join(root, 'empty');
  await mkdir(empty);
  await initProject(empty);
  await assert.rejects(initProject(empty), /Refusing to overwrite/);
  const file = join(root, 'keep.txt');
  await writeFile(file, 'keep me');
  await assert.rejects(initProject(file), /Refusing to overwrite/);
  assert.equal(await readFile(file, 'utf8'), 'keep me');
  await assert.rejects(initProject(''), /directory is required/);
  await assert.rejects(initProject(join(root, 'invalid'), { title: ' ' }), /nonempty string/);
});

test('project detection names missing required files', async (t) => {
  const root = await temporary(t);
  for (const file of ['index.html', 'main.ts', 'style.css']) {
    assert.throws(() => detectProject(root), error => error.message.includes(join(root, file)));
    await writeFile(join(root, file), '');
  }
  assert.equal(detectProject(join(root, '.')), root);
});

test('project context uses absolute standalone paths or packaged example paths', async (t) => {
  const root = await temporary(t);
  withProject(root, () => assert.deepEqual(projectContext('ignored'), {
    sourceDir: root, distFile: join(root, 'dist/index.html'),
    artifactDir: join(root, '.puppet-show'), cacheDir: join(root, '.puppet-show/cache'),
  }));
  withProject('relative/path', () => assert.throws(() => projectContext('ignored'), /absolute path/));
  withProject(undefined, () => {
    const context = projectContext('puppet-show-explained');
    assert.equal(context.sourceDir, join(packageRoot, 'examples/puppet-show-explained'));
    assert.equal(context.distFile, join(packageRoot, 'dist/examples/puppet-show-explained/index.html'));
    assert.equal(projectContext('nonexistent-portable-test').sourceDir, null);
  });
});

test('docs route to packaged sources and recipes use public imports', async () => {
  assert.equal(printDocs(), await readFile(join(packageRoot, 'docs/authoring.md'), 'utf8'));
  assert.match(printDocs('api'), /Portable projects import from "puppet-show"/);
  assert.ok(printDocs('design').startsWith(await readFile(join(packageRoot, 'skills/explainer-design/SKILL.md'), 'utf8')));
  assert.match(printDocs('design'), /docs design\/learner-evaluation\.md/);
  assert.equal(printDocs('design/learner-evaluation'), printDocs('design/learner-evaluation.md'));
  const recipes = printDocs('recipes');
  const names = [...recipes.matchAll(/docs recipes\/(\S+\.ts)/g)].map(match => match[1]);
  assert.ok(names.length > 0);
  for (const name of names) {
    const recipe = printDocs(`recipes/${name}`);
    assert.doesNotMatch(recipe, /\.\.\/\.\.\/\.\.\/src\/index\.ts/);
    assert.ok(recipe.length > 0);
  }
  const all = printDocs('all');
  for (const topic of ['authoring', 'api', 'design', 'recipes']) assert.ok(all.includes(`<!-- ${topic} -->`));
});

test('docs reject unknown topics, traversal, encoded paths, and wrong extensions', () => {
  assert.throws(() => printDocs('unknown'), /Unknown docs topic/);
  for (const topic of [
    'design/../../README', 'design/%2e%2e%2fREADME', 'design//etc/passwd',
    'design/..\\README', 'recipes/../../package.json', 'recipes/%2fetc%2fpasswd.ts',
    'recipes/01-inputs.js', 'recipes/..\\escape.ts',
  ]) assert.throws(() => printDocs(topic), /Invalid documentation filename/, topic);
});

test('Chrome override discovers executable paths and PATH names, rejects invalid overrides', async (t) => {
  const root = await temporary(t);
  const browser = join(root, 'test-chromium');
  await writeFile(browser, '#!/bin/sh\nexit 0\n');
  await chmod(browser, 0o755);
  const moduleURL = new URL('../scripts/chrome.mjs', import.meta.url).href;
  const run = chrome => execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { findChrome } from ${JSON.stringify(moduleURL)}; try { console.log(findChrome()); } catch (error) { console.log(error.message); process.exitCode = 7; }`,
  ], { encoding: 'utf8', env: { ...process.env, CHROME: chrome, PATH: root } });
  assert.equal(run(browser).trim(), browser);
  assert.equal(run('test-chromium').trim(), browser);
  assert.throws(() => run(join(root, 'missing')), error => error.status === 7 && /CHROME does not point/.test(error.stdout));
  await chmod(browser, 0o644);
  assert.throws(() => run(browser), error => error.status === 7 && /CHROME does not point/.test(error.stdout));
});
