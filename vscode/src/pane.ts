import * as vscode from 'vscode';
import {randomBytes} from 'node:crypto';
import {PostBatcher} from './batch.ts';
import type {ToHost, ToView} from './protocol.ts';

/** User zoom for the pane (setting puppet-show.paneScale), clamped to a sane range. */
const paneScale = (): number => {
  const v = vscode.workspace.getConfiguration('puppet-show').get<number>('paneScale', 1.25);
  return Number.isFinite(v) ? Math.min(3, Math.max(0.75, v)) : 1.25;
};

/** Secondary side bar, supported by the installed 1.132 contribution schema. */
export class DebuggerPane implements vscode.Disposable {
  private view?: vscode.WebviewView;
  private panel?: vscode.WebviewPanel;
  private webviews = new Set<vscode.Webview>();
  readyCount = 0;
  receipts = {index: 0, series: 0, stop: 0};
  batches = 0;
  private batcher = new PostBatcher(messages => {
    this.batches++;
    for (const view of this.webviews) void view.postMessage(messages);
  });
  constructor(private context: vscode.ExtensionContext, private receive: (message: ToHost) => void, private replay: () => ToView[]) {
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('puppet-show.debugger', {
      resolveWebviewView: view => {
        this.view = view;
        this.mount(view.webview);
        view.onDidDispose(() => { this.webviews.delete(view.webview); this.view = undefined; });
      },
    }, {webviewOptions: {retainContextWhenHidden: true}}));
  }
  private mount(webview: vscode.Webview) {
    this.webviews.add(webview);
    const root = vscode.Uri.joinPath(this.context.extensionUri, '..');
    webview.options = {enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(root, 'dist/webview'), vscode.Uri.joinPath(this.context.extensionUri, 'media')]};
    const nonce = randomBytes(18).toString('base64');
    const uri = (path: string) => webview.asWebviewUri(vscode.Uri.joinPath(root, path)).toString();
    webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'strict-dynamic'; style-src ${webview.cspSource}; font-src ${webview.cspSource} data:;"><link rel="stylesheet" href="${uri('dist/webview/debugger.css')}"></head><body><main id="app" data-scale="${paneScale()}"></main><script nonce="${nonce}" type="module" src="${uri('vscode/media/bootstrap.js')}"></script></body></html>`;
    webview.onDidReceiveMessage((message: ToHost | {type: 'receipt'; index: number; series: number; stop: number}) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') {
        this.readyCount++;
        this.post(this.replay());
      } else if (message.type === 'receipt') {
        this.receipts.index += Number.isSafeInteger(message.index) ? message.index : 0;
        this.receipts.series += Number.isSafeInteger(message.series) ? message.series : 0;
        this.receipts.stop += Number.isSafeInteger(message.stop) ? message.stop : 0;
      }
      else this.receive(message);
    }, undefined, this.context.subscriptions);
  }
  async open() {
    if (vscode.workspace.getConfiguration('puppet-show').get<string>('location', 'sidebar') === 'editor') {
      if (!this.panel) {
        this.panel = vscode.window.createWebviewPanel('puppet-show', 'puppet-show', {viewColumn: vscode.ViewColumn.Beside, preserveFocus: true}, {retainContextWhenHidden: true});
        this.mount(this.panel.webview);
        const panel = this.panel;
        panel.onDidDispose(() => { this.webviews.delete(panel.webview); this.panel = undefined; });
        // There is no stable public TabGroup id or lock API. Focus this panel
        // briefly so the built-in command targets its group, then restore the
        // previous group. Never run lock against an arbitrary source group.
        panel.reveal(panel.viewColumn, false);
        await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
        await vscode.commands.executeCommand('workbench.action.focusPreviousGroup');
      } else this.panel.reveal(this.panel.viewColumn, true);
    } else {
      if (!this.view) await vscode.commands.executeCommand('puppet-show.debugger.focus', {preserveFocus: true});
      this.view?.show(true);
    }
  }
  post(messages: ToView[]) { this.batcher.push(messages); }
  dispose() { this.batcher.dispose(); this.panel?.dispose(); }
}
