#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve, relative, isAbsolute} from 'node:path';
const [action, session = '.puppet-show/session.json'] = process.argv.slice(2);
try {
  if (action === 'status') {
    console.log(await readFile(resolve('.puppet-show/status.json'), 'utf8'));
  } else if (action === 'start' || action === 'stop') {
    const path = relative(process.cwd(), resolve(session));
    if (path.startsWith('..') || isAbsolute(path)) throw new Error('Session must be inside the workspace');
    const uri = new URL(`vscode://puppet-show-local.puppet-show-debugger/${action}`);
    if (action === 'start') uri.searchParams.set('session', path);
    const result = spawnSync(process.env.PUPPET_SHOW_CODE ?? 'code', ['--open-url', uri.href], {stdio: 'inherit'});
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    if (!process.exitCode) console.error(`Requested ${action}; read .puppet-show/status.json for asynchronous confirmation.`);
  } else throw new Error('Usage: npm run session -- start [workspace-relative session.json] | stop | status');
} catch (error) { console.error(error.message); process.exitCode = 1; }
