import type { DebugSession, PuppetShowSnapshot, Stop, StopIndex } from "../../src/inspect/schema.ts";
/** Deterministic synthetic probe trace. Full stops are generated only on request. */
export const fixtureSession: DebugSession = {
  id: "logical-time", name: "How logical time keeps tweens exact",
  breakpoints: [
    { id: "frame", label: "frame", kind: "probe" },
    { id: "join", label: "join", kind: "probe" },
    { id: "seek", label: "seek", kind: "probe" },
  ],
  views: [
    { id: "values", kind: "value", label: "frame state", select: ["clock", "logical", "x"] },
    { id: "time", kind: "series", label: "clock / logical", lines: [{ select: "clock", label: "clock" }, { select: "logical", label: "logical" }] },
    { id: "threads", kind: "puppet-show:threads", label: "logical time against clock" },
    { id: "nodes", kind: "table", label: "animated state", select: "puppet-show.value.nodes", key: "id", columns: ["id", "text", "motion.x", "motion.opacity"] },
    { id: "tree", kind: "tree", label: "owned work", select: "work", key: "id" },
    { id: "events", kind: "events", label: "join probes", breakpoint: "join", template: "#{seq} {bp}" },
  ],
};
export const fixtureNotes = {
  frame: "The clock is ragged; *logical time* records exact tween boundaries. `x` follows progress, not frame count.",
  join: "The parent catches up to its child's *exact end*. A late frame does not add drift.",
  seek: "Replay advances with effects held. The same logical state lands without undo code.",
};
export function fixtureTrace(count = 2400) {
  const bp = (seq: number) => seq % 97 === 0 ? "seek" : seq % 30 === 0 ? "join" : "frame";
  const index: StopIndex[] = Array.from({ length: count }, (_, seq) => ({ seq, bp: bp(seq), reason: "breakpoint" }));
  const previous = new Int32Array(count).fill(-1);
  const last = new Map<string, number>();
  for (const item of index) { previous[item.seq] = last.get(item.bp!) ?? -1; last.set(item.bp!, item.seq); }
  const clock = (seq: number) => (seq % 360) / 60 + (seq % 7) * .001;
  const logical = (seq: number) => Math.floor(clock(seq) * 2) / 2;
  const series = [index.map(i => clock(i.seq)), index.map(i => logical(i.seq))];
  function stop(seq: number): Stop {
    seq = Math.max(0, Math.min(count - 1, seq));
    const now = clock(seq), time = logical(seq);
    const progress = (now - time) / .5;
    const x = Math.round(progress * 2000) / 10;
    const alphaTime = Math.floor(now * 4) / 4;
    const opacity = Math.round((1 - (now - alphaTime) / .25) * 100) / 100;
    const extra = seq % 100 > 50;
    const threads = { id: 10, label: "scene", time, done: false, children: [
      { id: 304, label: "tween x 0.5s", time, done: false, children: [] },
      ...(extra ? [{ id: 305, label: "tween opacity 0.25s", time: alphaTime, done: false, children: [] }] : []),
    ] };
    const snapshot: PuppetShowSnapshot = {
      version: 1, seeking: bp(seq) === "seek", threads,
      nodes: [
        { id: 42, tag: "div", cls: "ps-box", text: "moving box", motion: { x, y: 0, scale: 1, rotate: 0, opacity: 1 } },
        ...(extra ? [{ id: 43, tag: "span", cls: "ps-chip", text: "opacity", motion: { x: 0, y: 0, scale: 1, rotate: 0, opacity } }] : []),
      ],
      deck: { path: "puppet-show://logical-time", chapter: 0, chapters: [{ title: "logical time", segments: [{ name: "tween", start: 0, end: 6 }] }], step: Math.floor(now), playing: true, speed: 1, time: now, caption: "Exact time does not drift.", seeks: [] },
    };
    return { seq, reason: "breakpoint", threadId: 1, frames: [], agent: { breakpointId: bp(seq), label: bp(seq), kind: "probe" }, data: {
      clock: Math.round(now * 1000) / 1000, logical: time, x,
      "puppet-show": { ok: true, value: snapshot },
      work: [{ id: "scene", label: "scene", children: threads.children.map(t => ({ id: String(t.id), label: `${t.label} · ${t.time.toFixed(3)}s`, children: [] })) }],
    } };
  }
  return { index, series, stop, prev: (seq: number) => previous[seq] < 0 ? null : stop(previous[seq]) };
}
