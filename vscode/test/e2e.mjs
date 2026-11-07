import {runTests} from '@vscode/test-electron';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
let server;
try {
  // Refuse to reuse an unknown server: the test must exercise this workspace.
  try { await fetch('http://localhost:5173'); throw new Error('Port 5173 is already in use; stop its server before test:e2e'); }
  catch (error) { if (error.message.includes('already in use')) throw error; }
  server = spawn('npm', ['run', 'dev', '--', '--port', '5173', '--strictPort'], {cwd: root, detached: true, stdio: 'ignore'});
  for (let i = 0; ; i++) {
    try { if ((await fetch('http://localhost:5173/how-puppet-show-works/')).ok) break; } catch {}
    if (i > 100) throw new Error('Vite did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    extensionDevelopmentPath: `${root}/vscode`,
    extensionTestsPath: `${root}/vscode/test/host.cjs`,
    launchArgs: [root, '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
  });
} finally { if (server?.pid) process.kill(-server.pid, 'SIGTERM'); }
