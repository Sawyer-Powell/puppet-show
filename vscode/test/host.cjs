const vscode = require('vscode');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.run = async () => {
  const extension = vscode.extensions.all.find(e => e.packageJSON.name === 'puppet-show-debugger');
  assert.ok(extension);
  const api = await extension.activate();
  const root = path.resolve(__dirname, '../..');
  const dir = path.join(root, '.puppet-show');
  const sessionPath = path.join(dir, 'session.json');
  let previous;
  try { previous = await fs.readFile(sessionPath); } catch {}
  const sentinel = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(path.join(root, 'src/core/signal.ts')), new vscode.Position(0, 0)), false);
  vscode.debug.addBreakpoints([sentinel]);
  let resolvedUrl;
  // The outer runner owns Vite. Preserve the shipped named-launch URL override,
  // removing only its competing prelaunch task at the final resolver boundary.
  const provider = vscode.debug.registerDebugConfigurationProvider('pwa-chrome', {resolveDebugConfiguration(_folder, config) {
    if (config.__puppetShowRunId) { resolvedUrl = config.url; delete config.preLaunchTask; }
    return config;
  }});
  try {
    const example = JSON.parse(await fs.readFile(path.join(root, 'docs/debugger/logical-time.puppet-show-session.json'), 'utf8'));
    assert.ok(example.breakpoints.every(bp => bp.kind === 'probe'), 'demo has no stop breakpoints');
    const url = example.launch.url;
    example.collectors.push({id: 'privacy', kind: 'evaluate', expr: '({password:"never-export-me", nested:{apiToken:"also-secret"}, safe:7})'});
    await fs.mkdir(dir, {recursive: true});
    await fs.writeFile(sessionPath, JSON.stringify(example));
    await vscode.commands.executeCommand('puppet-show.startSession');
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const histories = api.histories();
      const history = histories.find(h => h.total > 500);
      const diagnostics = api.diagnostics();
      if (history && diagnostics.index > 500 && diagnostics.series > 500 && diagnostics.stop > 0) {
        const stop = history.latest;
        const status = JSON.parse(await fs.readFile(path.join(dir, 'status.json'), 'utf8'));
        const trace = await fs.readFile(status.trace, 'utf8');
        const records = trace.trim().split('\n').map(line => JSON.parse(line));
        assert.ok(records.length > 500, 'all probes exported');
        assert.equal(resolvedUrl, url, 'named launch preserves autoplay URL override');
        assert.ok(records.every(record => record.agent?.kind === 'probe'), 'no human stops or automatic stop breakpoints');
        assert.ok(records.some(record => record.data["puppet-show"]?.ok), 'runtime snapshot exported');
        assert.equal(stop.data.privacy.value.password, '[REDACTED]');
        assert.ok(!trace.includes('never-export-me') && !trace.includes('also-secret'));
        assert.ok(vscode.debug.breakpoints.some(bp => bp.id === sentinel.id));
        assert.ok(history.size <= example.maxStops);
        const {count, firstAt, lastAt} = diagnostics.capture;
        const stopsPerSecond = +((count - 1) / ((lastAt - firstAt) / 1000)).toFixed(2);
        const metrics = {count, stopsPerSecond, durationSeconds: +((lastAt - firstAt) / 1000).toFixed(2), trace: status.trace, indexReceived: diagnostics.index, seriesReceived: diagnostics.series, fullStopsReceived: diagnostics.stop, postBatches: diagnostics.batches, heapMiB: +(process.memoryUsage().heapUsed / 2**20).toFixed(2)};
        await fs.writeFile(path.join(dir, 'v2-e2e-metrics.json'), JSON.stringify(metrics, null, 2));
        console.log('PUPPET_SHOW_STATE_E2E_OK', JSON.stringify(metrics));
        return;
      }
      await wait(200);
    }
    throw new Error('Expected >500 autonomous probe stops/index/series: ' + JSON.stringify({histories: api.histories().map(h => ({total: h.total, latest: h.latest})), diagnostics: api.diagnostics()}));
  } finally {
    await vscode.commands.executeCommand('puppet-show.stopSession');
    provider.dispose();
    vscode.debug.removeBreakpoints([sentinel]);
    if (previous) await fs.writeFile(sessionPath, previous); else await fs.rm(sessionPath, {force: true});
  }
};
