import type {ToView} from './protocol.ts';

/** One ordered post batch per 50ms; replaces pending stop replies (latest wins). */
export class PostBatcher {
  private pending: ToView[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private send: (messages: ToView[]) => void;
  readonly intervalMs: number;
  constructor(send: (messages: ToView[]) => void, intervalMs = 50) {
    this.send = send; this.intervalMs = intervalMs;
    if (intervalMs < 50) throw new Error('Post interval must be at least 50ms');
  }
  push(messages: ToView[]) {
    for (const message of messages) {
      if (message.type === 'session') this.pending = [];
      if (message.type === 'status' || message.type === 'stop' || message.type === 'notes') {
        this.pending = this.pending.filter(item => item.type !== message.type);
      }
      if (message.type === 'index') {
        const previous = this.pending.findLast(item => item.type === 'index');
        if (previous?.type === 'index' && previous.from + previous.items.length === message.from) { previous.items.push(...message.items); continue; }
      }
      if (message.type === 'series') {
        const previous = this.pending.findLast(item => item.type === 'series' && item.id === message.id && item.line === message.line);
        if (previous?.type === 'series' && previous.from + previous.values.length === message.from) { previous.values.push(...message.values); continue; }
      }
      // Own arrays: merging must not mutate caller-owned fixtures/history buffers.
      this.pending.push(message.type === 'index' ? {...message, items: [...message.items]} : message.type === 'series' ? {...message, values: [...message.values]} : message);
    }
    if (!this.timer && this.pending.length) this.timer = setTimeout(() => this.flush(), this.intervalMs);
  }
  private flush() {
    this.timer = undefined;
    const messages = this.pending.splice(0);
    if (messages.length) this.send(messages);
  }
  dispose() { clearTimeout(this.timer); this.timer = undefined; this.pending = []; }
}
