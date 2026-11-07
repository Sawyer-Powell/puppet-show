import * as vscode from 'vscode';
import {readFile} from 'node:fs/promises';
import {resolve, relative, isAbsolute, dirname, basename, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {collectors, type Collector} from './collectors/index.ts';
import {evaluateCollector} from './collectors/evaluate.ts';
import {sessionViews, sessionMaxStops, parseSession, resolveAnchor, diffBreakpoints, redactValue, createTraceWriter, type SessionConfig, type ResolvedBreakpoint, type TraceWriter} from './session.ts';
import type {AgentBreakpoint, Stop, ToView, State, ViewSpec} from './protocol.ts';
import type {StoppedBody} from './tracker.ts';

/** All mutable breakpoint ownership is kept here, never inferred from user BPs. */
export class AgentSession implements vscode.Disposable {
  private owned: {spec: ResolvedBreakpoint; handle: vscode.SourceBreakpoint}[] = [];
  private spec?: SessionConfig;
  private sessionPath?: string;
  private fileWatcher?: vscode.FileSystemWatcher;
  private sourceWatchers: vscode.Disposable[] = [];
  private sourceFiles: string[] = [];
  private notes: Record<string, string> = {};
  private errors: string[] = [];
  private views: AgentBreakpoint[] = [];
  private writer?: TraceWriter;
  private fallbackWriter?: TraceWriter;
  private debugSessions = new Map<string, vscode.DebugSession>();
  private runId?: string;
  private queue: Promise<unknown> = Promise.resolve();
  private state: State = 'exited';
  private head: number | null = null;
  private summary?: unknown;
  readonly folder: vscode.WorkspaceFolder | undefined;
  constructor(private context: vscode.ExtensionContext, private post: (messages: ToView[]) => void) {
    this.folder = vscode.workspace.workspaceFolders?.[0];
    if (!this.folder) return;
    this.fallbackWriter = createTraceWriter({directory: this.path('.puppet-show')});
    const watch = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.folder, '.puppet-show/{session,notes}.json'));
    context.subscriptions.push(watch,
      watch.onDidCreate(uri => this.changed(uri)), watch.onDidChange(uri => this.changed(uri)), watch.onDidDelete(uri => this.changed(uri)),
      vscode.workspace.onDidSaveTextDocument(document => {
        if (this.spec?.breakpoints?.some(bp => this.path(bp.file) === document.uri.fsPath)) this.enqueue(() => this.load(this.sessionPath!));
      }));
    void this.enqueue(() => this.loadDefault());
  }
  private enqueue(operation: () => Promise<unknown>) {
    this.queue = this.queue.then(operation).catch(error => this.report(error));
    return this.queue;
  }
  private changed(uri: vscode.Uri) {
    if (basename(uri.fsPath) === 'notes.json') this.enqueue(() => this.loadNotes());
    else this.enqueue(() => this.load(this.sessionPath ?? this.path('.puppet-show/session.json')));
  }
  private async loadDefault() {
    try { await readFile(this.path('.puppet-show/session.json'), 'utf8'); }
    catch { return; }
    await this.load(this.path('.puppet-show/session.json'));
  }
  private path(file: string) {
    if (!this.folder) throw new Error('Open a workspace folder first');
    const path = resolve(this.folder.uri.fsPath, file);
    const rel = relative(this.folder.uri.fsPath, path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Session files and breakpoints must stay inside the workspace');
    return path;
  }
  private safe<T>(value: T): T { return redactValue(value, this.spec?.redact ?? []) as T; }
  private async report(error: unknown) {
    this.errors = [String(error)];
    // Invalid config fails closed: remove only owned BPs; never leave old probes active.
    vscode.debug.removeBreakpoints(this.owned.map(item => item.handle)); this.owned = [];
    this.views = [{id: 'session-error', label: 'Session error', file: this.sessionPath ?? '.puppet-show/session.json', kind: 'stop', error: String(error)}];
    this.post(this.messages());
    await this.writeStatus();
  }
  private async load(path: string) {
    const spec = parseSession(await readFile(path, 'utf8'));
    this.spec = spec;
    this.sessionPath = path;
    this.errors = [];
    const desired: ResolvedBreakpoint[] = [];
    this.views = [];
    for (const bp of spec.breakpoints ?? []) {
      const view: AgentBreakpoint = {id: bp.id, label: bp.label ?? bp.id, note: bp.note, kind: bp.kind ?? 'stop', file: bp.file};
      try {
        const file = this.path(bp.file);
        const resolved = resolveAnchor({...bp, file}, await readFile(file, 'utf8'));
        desired.push(resolved); view.line = resolved.line;
      } catch (error) { view.error = String(error); this.errors.push(view.error); }
      this.views.push(view);
    }
    const diff = diffBreakpoints(this.owned, desired);
    vscode.debug.removeBreakpoints(diff.remove.map(item => item.handle));
    const additions = diff.add.map(spec => {
      const handle = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(spec.file), new vscode.Position(spec.line - 1, 0)), true, spec.condition);
      Object.defineProperty(handle, 'puppetShowId', {value: spec.id});
      return {spec, handle};
    });
    vscode.debug.addBreakpoints(additions.map(item => item.handle));
    this.owned = [...diff.retain, ...additions];
    const sourceFiles = [...new Set((spec.breakpoints ?? []).map(bp => this.path(bp.file)))].sort();
    if (JSON.stringify(sourceFiles) !== JSON.stringify(this.sourceFiles)) {
      this.sourceWatchers.splice(0).forEach(watcher => watcher.dispose());
      this.sourceFiles = sourceFiles;
      for (const file of sourceFiles) {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dirname(file), basename(file)));
        const reload = () => this.enqueue(() => this.load(this.sessionPath!));
        this.sourceWatchers.push(watcher, watcher.onDidChange(reload), watcher.onDidCreate(reload), watcher.onDidDelete(reload));
      }
    }
    this.post(this.messages());
    await this.loadNotes();
    await this.writeStatus();
  }
  private async loadNotes() {
    try {
      const value = JSON.parse(await readFile(this.path('.puppet-show/notes.json'), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(note => typeof note !== 'string')) throw new Error('notes.json must map breakpoint ids or id:seq keys to strings');
      this.notes = value;
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      this.notes = {};
    }
    this.post(this.messages());
  }
  get name(): string { return this.spec?.name ?? 'puppet-show state'; }
  get viewSpecs(): ViewSpec[] { return this.spec ? sessionViews(this.spec) : []; }
  get maxStops(): number { return this.spec ? sessionMaxStops(this.spec) : 10000; }
  get breakpointSpecs(): AgentBreakpoint[] { return this.safe(this.views); }
  messages(): ToView[] {
    const notes = this.spec?.notes;
    return this.safe([{type: 'notes', notes: {
      '*': this.errors.length ? this.errors.join('\n') : Array.isArray(notes) ? notes.join('\n') : notes ?? '',
      ...Object.fromEntries(this.views.filter(bp => bp.note).map(bp => [bp.id, bp.note!])), ...this.notes,
    }}]);
  }
  async start(file = '.puppet-show/session.json') {
    try { await this.begin(file); }
    catch (error) {
      this.state = 'exited'; this.head = null; this.errors = [String(error)];
      await this.writeStatus();
      throw error;
    }
  }
  private async begin(file: string) {
    const path = this.path(file);
    await this.enqueue(() => this.load(path));
    if (this.errors.length || !this.spec) throw new Error(this.errors.join('\n') || 'Invalid session');
    this.fileWatcher?.dispose();
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dirname(path), basename(path)));
    this.fileWatcher.onDidChange(() => this.enqueue(() => this.load(path)));
    this.fileWatcher.onDidDelete(() => this.enqueue(() => this.load(path)));
    this.fileWatcher.onDidCreate(() => this.enqueue(() => this.load(path)));
    await this.stop();
    this.runId = randomUUID(); this.summary = undefined; this.head = null; this.state = 'running';
    this.writer = createTraceWriter({directory: this.path('.puppet-show'), tracePath: this.path(`.puppet-show/traces/${this.runId}.jsonl`), statusPath: this.path('.puppet-show/status.json'), redact: this.spec.redact});
    await this.writeStatus();
    let config: vscode.DebugConfiguration;
    const launchName = typeof this.spec.launch === 'string' ? this.spec.launch : !('type' in this.spec.launch) && typeof this.spec.launch.name === 'string' ? this.spec.launch.name : undefined;
    if (launchName) {
      const configs = vscode.workspace.getConfiguration('launch', this.folder!.uri).get<vscode.DebugConfiguration[]>('configurations', []);
      const found = configs.find(c => c.name === launchName);
      if (!found) throw new Error(`Unknown launch configuration: ${launchName}`);
      config = {...found};
      if (typeof this.spec.launch !== 'string' && typeof this.spec.launch.url === 'string') config.url = this.spec.launch.url;
    } else config = {...this.spec.launch as Record<string, unknown>} as vscode.DebugConfiguration;
    config.name ??= this.spec.name;
    config.__puppetShowRunId = this.runId;
    if (!await vscode.debug.startDebugging(this.folder, config)) { this.state = 'exited'; await this.writeStatus(); throw new Error('Debug launch failed'); }
  }
  owns(session: vscode.DebugSession): boolean {
    const owned = !!this.runId && (session.configuration.__puppetShowRunId === this.runId || (!!session.parentSession && this.owns(session.parentSession)));
    if (owned) this.debugSessions.set(session.id, session);
    return owned;
  }
  async stop() {
    const roots = [...this.debugSessions.values()].filter(session => !session.parentSession || !this.debugSessions.has(session.parentSession.id));
    for (const session of roots) await vscode.debug.stopDebugging(session);
    this.debugSessions.clear();
    if (this.writer) { this.state = 'exited'; this.head = null; await this.writeStatus(); await this.writer.flush(); }
  }
  collectorList(): Collector[] {
    if (!this.spec?.collectors) return collectors;
    return this.spec.collectors.map(item => {
      if (typeof item === 'string') return collectors.find(c => c.id === item)!;
      return evaluateCollector(item.id, item.expr);
    });
  }
  async prepare(stop: Omit<Stop, 'seq'>, body: StoppedBody): Promise<Omit<Stop, 'seq'>> {
    if (body.reason === 'breakpoint') {
      const top = stop.frames[0];
      const candidates = this.owned.filter(item => item.spec.file === top?.path && item.spec.line === top.line);
      const owned = candidates[0];
      if (owned) {
        const bp = owned.spec;
        // A colocated user breakpoint or another stop breakpoint always wins.
        const user = vscode.debug.breakpoints.some(other => other.enabled && !this.owned.some(item => item.handle.id === other.id) && other instanceof vscode.SourceBreakpoint && other.location.uri.fsPath === bp.file && other.location.range.start.line + 1 === bp.line);
        const probe = bp.kind === 'probe' && !user && candidates.every(item => item.spec.kind === 'probe');
        stop.agent = {breakpointId: bp.id, label: bp.label ?? bp.id, note: bp.note, kind: probe ? 'probe' : 'stop'};
      }
    }
    return this.safe(stop);
  }
  async record(session: vscode.DebugSession, stop: Stop) {
    if (!this.owns(session) || !this.writer) return;
    this.state = 'paused'; this.head = stop.seq;
    this.summary = {seq: stop.seq, reason: stop.reason, agent: stop.agent, frame: stop.frames[0]};
    await this.writer.append({sessionId: this.runId, debugSessionId: session.id, ...this.safe(stop)});
    await this.writeStatus();
    if (stop.agent?.kind === 'probe') await session.customRequest('continue', {threadId: stop.threadId});
  }
  async transition(session: vscode.DebugSession, state: State) {
    if (!this.owns(session)) return;
    this.state = state; if (state !== 'paused') this.head = null;
    await this.writeStatus();
  }
  private async writeStatus() {
    await (this.writer ?? this.fallbackWriter)?.writeStatus(this.safe({version: 1, sessionId: this.runId, name: this.spec?.name, state: this.state, head: this.head, stop: this.summary, errors: this.errors, breakpoints: this.views, trace: this.writer?.tracePath}));
  }
  dispose() { this.fileWatcher?.dispose(); this.sourceWatchers.forEach(watcher => watcher.dispose()); vscode.debug.removeBreakpoints(this.owned.map(item => item.handle)); }
}
