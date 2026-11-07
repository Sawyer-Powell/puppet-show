import * as vscode from 'vscode';
import {History} from './model.ts';
import {StopTracker} from './tracker.ts';
import {DebuggerPane} from './pane.ts';
import {AgentSession} from './agent-session.ts';
import {sessionViews} from './session.ts';
import type {ToHost} from './protocol.ts';

export function activate(context: vscode.ExtensionContext) {
  const records = new Map<string, {session: vscode.DebugSession; tracker: StopTracker; history: History}>();
  let active: string | undefined;
  const capture = {count: 0, firstAt: 0, lastAt: 0};
  const output = vscode.window.createOutputChannel('puppet-show debugger');
  context.subscriptions.push(output);
  const current = () => active ? records.get(active) : undefined;
  const pane = new DebuggerPane(context, receive, () => [...(current()?.history.replay() ?? []), ...agent.messages()]);
  const agent = new AgentSession(context, messages => pane.post(messages));
  context.subscriptions.push(pane, agent);
  function receive(message: ToHost) {
    const history = current()?.history;
    if (!history) return;
    // Replies are coalesced by PostBatcher: fast scrubbing is latest-wins and
    // never posts/rebuilds a full history or sends execution commands.
    const reply = message.type === 'get' ? history.select(message.seq) : message.type === 'live' ? history.live() : undefined;
    if (reply) pane.post([reply]);
  }
  const fail = (error: unknown) => { output.appendLine(String(error)); void vscode.window.showErrorMessage(`puppet-show: ${String(error)}`); };
  context.subscriptions.push(
    vscode.commands.registerCommand('puppet-show.openDebugger', () => pane.open()),
    vscode.commands.registerCommand('puppet-show.startSession', async (file?: string) => {
      try { await pane.open(); await agent.start(file); }
      catch (error) { fail(error); throw error; }
    }),
    vscode.commands.registerCommand('puppet-show.stopSession', () => agent.stop()),
    vscode.window.registerUriHandler({async handleUri(uri) {
      try {
        const query = new URLSearchParams(uri.query);
        if (uri.path === '/start') { await pane.open(); await agent.start(query.get('session') ?? undefined); }
        else if (uri.path === '/stop') await agent.stop();
        else throw new Error(`Unknown puppet-show URI action: ${uri.path}`);
      } catch (error) { fail(error); }
    }}),
    vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker(session) {
        const supported = (s: vscode.DebugSession | undefined): boolean => !!s && (['pwa-chrome', 'pwa-node', 'chrome', 'node'].includes(s.type) || supported(s.parentSession));
        if (!supported(session)) return;
        const managed = agent.owns(session);
        const views = managed ? agent.viewSpecs : sessionViews({version: 1, name: session.name, launch: 'manual'});
        const history = new History({id: session.id, name: managed ? agent.name : session.name}, views, managed ? agent.maxStops : 10000, managed ? agent.breakpointSpecs : []);
        let first = true;
        const tracker = new StopTracker(history, session, async path => {
          const uri = path.startsWith('file:') ? vscode.Uri.parse(path) : vscode.Uri.file(path);
          return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        }, (messages, stop) => {
          if (stop) {
            capture.count++; capture.lastAt = Date.now(); capture.firstAt ||= capture.lastAt;
            const changed = active !== session.id;
            active = session.id;
            const initial = first;
            if (first) { first = false; void pane.open().catch(fail); }
            if (changed || initial) pane.post([...history.replay(), ...agent.messages()]);
            else pane.post(messages);
            if (managed) void agent.record(session, stop).catch(fail);
            return;
          }
          if (active === session.id) pane.post(messages);
          if (managed) void agent.transition(session, history.state).catch(fail);
        }, managed ? {collectors: () => agent.collectorList(), prepare: (stop, body) => agent.prepare(stop, body)} : {});
        records.set(session.id, {session, history, tracker});
        if (!active || active === session.parentSession?.id) active = session.id;
        return {
          onDidSendMessage(message) {
            if (message.type !== 'event') return;
            if (message.event === 'stopped') void tracker.stopped(message.body ?? {});
            if (message.event === 'continued') tracker.transition('running');
            if (message.event === 'terminated' || message.event === 'exited') tracker.transition('exited');
          },
          onExit() { tracker.transition('exited'); },
        };
      },
    }),
  );
  return {histories: () => [...records.values()].map(record => record.history), viewReadyCount: () => pane.readyCount, diagnostics: () => ({...pane.receipts, batches: pane.batches, capture: {...capture}})};
}
