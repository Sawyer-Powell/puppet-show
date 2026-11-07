/** JSON-only debugger protocol. Shared with the extension host. */
export interface ThreadInfo { id: number; label: string; time: number; done: boolean; children: ThreadInfo[] }
export interface NodeInfo {
  id: number; tag: string; cls: string; text: string;
  motion?: { x: number; y: number; scale: number; rotate: number; opacity: number };
  bound?: Record<string, string | number | boolean | null>;
}
export interface PuppetShowSnapshot {
  version: 1;
  deck: null | {
    path?: string; chapter: number;
    chapters: { title: string; segments: { name: string; start: number; end: number }[] }[];
    step: number; playing: boolean; speed: number; time: number; caption: string;
    seeks: { frames: number; ms: number; segment: number }[];
  };
  threads: ThreadInfo | null; nodes: NodeInfo[]; seeking: boolean;
}
export type Collected = { ok: true; value: unknown } | { ok: false; error: string } | { ok: false; missing: true };
export interface Stop {
  seq: number; reason: string; threadId: number;
  frames: { name: string; path?: string; line: number; column: number }[];
  data: Record<string, unknown>;
  agent?: { breakpointId?: string; label?: string; note?: string; kind?: "stop" | "probe"; notes?: string };
}
export interface ViewSpec {
  id: string; kind: "value" | "series" | "table" | "tree" | "events" | "puppet-show:threads";
  label?: string; select?: string | string[]; lines?: { select: string; label?: string }[];
  breakpoint?: string; key?: string; columns?: string[]; children?: string; template?: string;
}
export interface StopIndex { seq: number; bp: string | null; reason: string }
export interface DebugSession {
  id: string; name: string; views: ViewSpec[]; maxStops?: number;
  breakpoints: { id: string; label: string; kind: "stop" | "probe" }[];
}
export type ToView =
  | { type: "session"; session: DebugSession }
  | { type: "index"; from: number; items: StopIndex[] }
  | { type: "series"; id: string; line: number; from: number; values: (number | null)[] }
  | { type: "status"; state: "running" | "paused" | "exited"; head: number | null; total: number; first?: number }
  | { type: "stop"; stop: Stop; prev: Stop | null }
  | { type: "notes"; notes: Record<string, string> };
export type ToHost = { type: "ready" } | { type: "get"; seq: number } | { type: "live" };
