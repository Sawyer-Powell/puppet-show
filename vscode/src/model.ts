import type {AgentBreakpoint, IndexItem, State, Stop, ToView, ViewSpec} from './protocol.ts';

/** Scalar evaluate collectors can be selected by id; structured paths use .value. */
export function selectData(stop: Stop, path: string): unknown {
  const parts = path.split('.');
  const collected = stop.data[parts.shift()!];
  if (!collected?.ok) return undefined;
  if (!parts.length) return collected.value;
  let value: unknown = parts[0] === 'value' ? collected : collected.value;
  for (const part of parts) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
export function seriesSample(stop: Stop, view: ViewSpec, path: string): number | null {
  if (view.breakpoint && stop.agent?.breakpointId !== view.breakpoint) return null;
  const value = selectData(stop, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function seriesPaths(view: ViewSpec): string[] {
  if (view.kind !== 'series') return [];
  return view.lines?.map(line => line.select) ?? (typeof view.select === 'string' ? [view.select] : view.select ?? []);
}
const breakpoint = (stop: Stop) => stop.agent?.breakpointId ?? null;
interface Entry {stop: Stop; previous: number | null; samples: (number | null)[][]}

/** Fixed-size ring plus absolute-seq map: append/get/previous are O(views). */
export class History {
  state: State = 'running';
  head: number | null = null;
  cursor = -1;
  following = true;
  total = 0;
  readonly session: {id: string; name: string; views: ViewSpec[]; breakpoints: AgentBreakpoint[]; maxStops: number};
  private entries = new Map<number, Entry>();
  private latestByBreakpoint = new Map<string | null, number>();
  readonly maxStops: number;
  constructor(session: {id: string; name: string}, views: ViewSpec[] = [], maxStops = 10000, breakpoints: AgentBreakpoint[] = []) {
    this.maxStops = maxStops;
    if (!Number.isSafeInteger(maxStops) || maxStops < 1) throw new Error('maxStops must be positive');
    this.session = {...session, views, breakpoints, maxStops};
  }
  get first(): number { return Math.max(0, this.total - this.maxStops); }
  get size(): number { return this.entries.size; }
  get latest(): Stop | undefined { return this.entries.get(this.total - 1)?.stop; }
  /** Diagnostic/compatibility access only; never used on the capture hot path. */
  get stops(): Stop[] { return [...this.entries.values()].map(entry => entry.stop); }
  append(stop: Omit<Stop, 'seq'>): ToView[] {
    const record = {...stop, seq: this.total++};
    const bp = breakpoint(record);
    const prior = this.latestByBreakpoint.get(bp);
    const entry: Entry = {stop: record, previous: prior !== undefined && this.entries.has(prior) ? prior : null, samples: this.session.views.map(view => seriesPaths(view).map(path => seriesSample(record, view, path)))};
    this.entries.set(record.seq, entry);
    this.latestByBreakpoint.set(bp, record.seq);
    const evicted = this.entries.get(record.seq - this.maxStops);
    if (evicted) {
      this.entries.delete(evicted.stop.seq);
      const evictedBP = breakpoint(evicted.stop);
      if (this.latestByBreakpoint.get(evictedBP) === evicted.stop.seq) this.latestByBreakpoint.delete(evictedBP);
    }
    this.state = 'paused'; this.head = record.seq;
    if (this.following) this.cursor = record.seq;
    if (this.cursor < this.first) this.cursor = this.first;
    return [{type: 'index', from: record.seq, items: [{seq: record.seq, bp, reason: record.reason}]}, ...this.samples(entry, record.seq), this.status()];
  }
  private samples(entry: Entry, from: number): ToView[] {
    return entry.samples.flatMap((values, i) => values.map((value, line) => ({type: 'series' as const, id: this.session.views[i]!.id, line, from, values: [value]})));
  }
  transition(state: State): ToView {
    this.state = state;
    if (state !== 'paused') this.head = null;
    return this.status();
  }
  select(seq: number): Extract<ToView, {type: 'stop'}> | undefined {
    if (!Number.isInteger(seq) || !this.size) return;
    this.following = false;
    this.cursor = Math.max(this.first, Math.min(seq, this.total - 1));
    return this.fetch(this.cursor);
  }
  live(): Extract<ToView, {type: 'stop'}> | undefined {
    this.following = true;
    this.cursor = this.total - 1;
    return this.fetch(this.cursor);
  }
  fetch(seq: number): Extract<ToView, {type: 'stop'}> | undefined {
    const entry = this.entries.get(seq);
    if (!entry) return;
    return {type: 'stop', stop: entry.stop, prev: entry.previous === null ? null : this.entries.get(entry.previous)?.stop ?? null};
  }
  status(): Extract<ToView, {type: 'status'}> { return {type: 'status', state: this.state, head: this.head, total: this.total, first: this.first}; }
  replay(): ToView[] {
    const entries = [...this.entries.values()];
    const items: IndexItem[] = entries.map(({stop}) => ({seq: stop.seq, bp: breakpoint(stop), reason: stop.reason}));
    const series = this.session.views.flatMap((view, i) => seriesPaths(view).map((_, line) => ({type: 'series' as const, id: view.id, line, from: this.first, values: entries.map(entry => entry.samples[i]![line] ?? null)})));
    return [{type: 'session', session: this.session}, {type: 'index', from: this.first, items}, ...series, this.status()];
  }
}
