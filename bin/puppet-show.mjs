#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, detectProject, help } from '../scripts/portable-args.mjs';
import { initProject, printDocs } from '../scripts/portable-content.mjs';

try {
  const args = parseArgs(process.argv.slice(2));
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  if (['help', '--help', '-h'].includes(args.command)) console.log(help);
  else if (args.command === 'docs') console.log(printDocs(args.topic));
  else if (args.command === 'init') {
    await initProject(args.dir, { title: args.title });
    console.log(`created ${args.dir}\ncd ${JSON.stringify(args.dir)} && puppet-show check`);
  } else {
    const root = detectProject(args.dir);
    process.env.PUPPET_SHOW_PROJECT = root;
    if (args.command === 'check' && !args.deep) {
      const { checkProject } = await import('../scripts/portable-check.mjs');
      await checkProject(root);
    } else if (args.command === 'build') {
      const { buildProject } = await import('../scripts/portable-check.mjs');
      await buildProject();
      console.log(resolve(root, 'dist/index.html'));
    } else {
      const script = args.command === 'check' ? 'verify' : args.command;
      const extra = args.command === 'shot' ? [...args.addresses, '--width', String(args.width)] : [];
      const result = spawnSync(process.execPath, [resolve(packageRoot, `scripts/${script}.mjs`), 'project', ...extra], {
        cwd: packageRoot, env: process.env, stdio: 'inherit',
      });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    }
  }
} catch (error) {
  const output = [error.stdout?.toString(), error.stderr?.toString()].filter(Boolean).join('\n').trim();
  console.error(output || error.message);
  process.exitCode = 1;
}
