import {collectAll, type Collector, type Frame, type Session} from './collectors/index.ts';
import {History} from './model.ts';
import type {Stop, ToView} from './protocol.ts';
export interface StoppedBody {threadId?: number; reason?: string; hitBreakpointIds?: number[]}
export interface TrackerOptions {
  collectors?: () => Collector[];
  prepare?: (stop: Omit<Stop, 'seq'>, body: StoppedBody) => Promise<Omit<Stop, 'seq'>>;
}

/** Epoch invalidates pending collection when the debuggee resumes or exits. */
export class StopTracker {
  private epoch = 0;
  threadId: number | undefined;
  readonly history: History;
  private session: Session;
  private readFile: (path: string) => Promise<string>;
  private emit: (messages: ToView[], stop?: Stop) => void;
  private options: TrackerOptions;
  constructor(history: History, session: Session, readFile: (path: string) => Promise<string>, emit: (messages: ToView[], stop?: Stop) => void, options: TrackerOptions = {}) {
    this.history = history; this.session = session; this.readFile = readFile; this.emit = emit; this.options = options;
  }
  transition(state: 'running' | 'exited') {
    this.epoch++;
    this.emit([this.history.transition(state)]);
  }
  async stopped(body: StoppedBody) {
    const epoch = ++this.epoch;
    this.history.state = 'paused';
    try {
      // Always fetch threads: stopped.threadId is optional (allThreadsStopped).
      const threads = await this.session.customRequest('threads');
      const threadId = body.threadId ?? threads.threads?.[0]?.id;
      if (typeof threadId !== 'number') throw new Error('No stopped thread');
      this.threadId = threadId;
      const stack = await this.session.customRequest('stackTrace', {threadId, startFrame: 0, levels: 20});
      const frames: Frame[] = (stack.stackFrames ?? []).slice(0, 20);
      const data = await collectAll({session: this.session, frame: frames[0], readFile: this.readFile}, this.options.collectors?.());
      let stop: Omit<Stop, 'seq'> = {reason: body.reason ?? 'pause', threadId, frames: frames.map(f => ({name: f.name, path: f.source?.path, line: f.line, column: f.column})), data};
      if (this.options.prepare) stop = await this.options.prepare(stop, body);
      if (epoch !== this.epoch) return;
      const messages = this.history.append(stop);
      this.emit(messages, this.history.latest);
    } catch (error) {
      if (epoch !== this.epoch) return;
      const messages = this.history.append({reason: body.reason ?? 'pause', threadId: body.threadId ?? 0, frames: [], data: {adapter: {ok: false, error: String(error)}}});
      this.emit(messages, this.history.latest);
    }
  }
}
