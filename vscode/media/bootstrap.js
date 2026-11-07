import {mountDebugger} from '../../dist/webview/debugger.js';
const vscode = acquireVsCodeApi();
// Pane zoom from the puppet-show.paneScale setting; set through CSSOM because the CSP forbids inline styles.
const app = document.getElementById('app');
if (app?.dataset.scale) app.style.setProperty('--x-pane-zoom', app.dataset.scale);
// Retention lives in the host. Persist only small session/notes metadata, never
// a second full history or O(N) copy per scrub/capture.
let saved = vscode.getState() ?? {};
const listeners = new Set();
window.addEventListener('message', ({data}) => {
  const messages = Array.isArray(data) ? data : [data];
  const receipt = {type: 'receipt', index: 0, series: 0, stop: 0};
  for (const message of messages) {
    if (message.type === 'session') saved = {session: message, notes: saved.notes};
    if (message.type === 'notes') saved.notes = message;
    for (const listener of listeners) listener(message);
    if (message.type === 'index') receipt.index += message.items.length;
    if (message.type === 'series') receipt.series += message.values.length;
    if (message.type === 'stop') receipt.stop++;
  }
  if (messages.some(message => message.type === 'session' || message.type === 'notes')) vscode.setState(saved);
  // Transport-only receipt for local integration checks; not a view action.
  vscode.postMessage(receipt);
});
mountDebugger(document.getElementById('app'), {
  post: message => vscode.postMessage(message),
  onMessage(listener) {
    listeners.add(listener);
    if (saved.session) listener(saved.session);
    if (saved.notes) listener(saved.notes);
    return () => listeners.delete(listener);
  },
});
