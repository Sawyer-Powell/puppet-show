import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const help = `puppet-show — portable single-file explainers
  init <dir> [--title "Title"]
  check [dir] [--deep]
  shot [dir] <address...> [--width N]
  scenes [dir]
  build [dir]
  docs [authoring|api|design|recipes|all|design/<ref>|recipes/<file>]
All project commands accept --dir <path> (default: cwd).
check: fast typecheck, build, cold-seek PNGs and captioned sheets.
--deep: slow, rarely needed; only investigate user-reported problems that
check, shot and looking at the sheets cannot find.`;

export function parseArgs(args, cwd = process.cwd()) {
  const [command = 'help', ...rest] = args;
  if (!['init', 'check', 'shot', 'scenes', 'build', 'docs', 'help', '--help', '-h'].includes(command)) throw new Error(`unknown command ${command}; use puppet-show --help`);
  let dir, title, deep = false, width = 720;
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (['--dir', '--title', '--width'].includes(arg)) {
      const value = rest[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--dir') dir = resolve(cwd, value);
      if (arg === '--title') title = value;
      if (arg === '--width') width = Number(value);
    } else if (arg === '--deep') deep = true;
    else if (arg.startsWith('-')) throw new Error(`unknown flag ${arg}`);
    else positional.push(arg);
  }
  if (title !== undefined && command !== 'init') throw new Error('--title is only for init');
  if (deep && command !== 'check') throw new Error('--deep is only for check');
  if (rest.includes('--width') && command !== 'shot') throw new Error('--width is only for shot');
  if (!Number.isInteger(width) || width < 200 || width > 4000) throw new Error('--width must be an integer 200-4000');
  if (command === 'init') {
    if (!dir && positional.length) dir = resolve(cwd, positional.shift());
    if (!dir) throw new Error('init requires a directory');
    if (positional.length) throw new Error(`unexpected argument ${positional[0]}`);
  } else if (command !== 'docs' && !dir && positional.length && (command !== 'shot' || existsSync(resolve(cwd, positional[0], 'index.html')))) {
    dir = resolve(cwd, positional.shift());
  }
  if (!['docs', 'shot', 'init'].includes(command) && positional.length) throw new Error(`unexpected argument ${positional[0]}`);
  if (command === 'shot' && !positional.length) throw new Error('shot requires a step address or chapter');
  if (command === 'docs' && positional.length > 1) throw new Error('docs takes one topic');
  return { command, dir: dir ?? cwd, title, deep, width, addresses: positional, topic: positional[0] ?? 'authoring' };
}

export function detectProject(dir) {
  const root = resolve(dir);
  for (const file of ['index.html', 'main.ts', 'style.css']) {
    if (!existsSync(resolve(root, file))) throw new Error(`not a puppet-show project: missing ${resolve(root, file)}; run puppet-show init <dir>`);
  }
  return root;
}
