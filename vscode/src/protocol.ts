// Protocol v2: docs/debugger/STATE-FIRST.md (no execution controls).
export interface Stop {
  seq: number;
  reason: string;
  threadId: number;
  frames: {name: string; path?: string; line: number; column: number}[];
  data: Record<string, Collected>;
  agent?: {breakpointId?: string; label?: string; note?: string; kind?: 'stop' | 'probe'; notes?: string};
}
export type Collected = {ok: true; value: unknown} | {ok: false; error: string} | {ok: false; missing: true};
export type State = 'running' | 'paused' | 'exited';
export interface ViewSpec {
  id: string;
  kind: 'value' | 'series' | 'table' | 'tree' | 'events' | 'puppet-show:threads';
  label?: string;
  select?: string | string[];
  breakpoint?: string;
  lines?: {select: string; label?: string}[];
  key?: string;
  columns?: string[];
  children?: string;
  template?: string;
}
export interface AgentBreakpoint {id: string; label: string; note?: string; kind: 'stop' | 'probe'; file?: string; line?: number; error?: string}
export interface IndexItem {seq: number; bp: string | null; reason: string}
export type ToView =
  | {type: 'session'; session: {id: string; name: string; views: ViewSpec[]; breakpoints: AgentBreakpoint[]; maxStops?: number}}
  | {type: 'index'; from: number; items: IndexItem[]}
  | {type: 'series'; id: string; line: number; from: number; values: (number | null)[]}
  | {type: 'status'; state: State; head: number | null; total: number; first: number}
  | {type: 'stop'; stop: Stop; prev: Stop | null}
  | {type: 'notes'; notes: Record<string, string>};
export type ToHost = {type: 'ready'} | {type: 'get'; seq: number} | {type: 'live'};
