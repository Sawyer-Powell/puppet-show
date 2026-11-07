/**
 * Cooperative threads with exact logical time.
 *
 * A task is a generator. It runs until it yields, which means "resume me next
 * frame". Every frame the runtime moves its clock forward and resumes each
 * live thread once, children before parents.
 *
 * Frames arrive whenever the browser gives us one, so a one-second tween
 * usually *notices* it is over a little late, at the first frame after 1.0s.
 * Each thread therefore keeps a logical `time`: the exact moment its last
 * operation was meant to finish. The next operation starts from that moment,
 * never from the late frame, so sequential animations do not drift and the
 * same scene produces the same state at any frame rate.
 */

import { inspection, inspectionEnabled } from "../inspect/hooks.ts";

export type Task = Generator<unknown, void, unknown>;

let taskLabels: WeakMap<Task, string> | undefined;
/** Give a task an optional debugger label without changing its execution. */
export function labelTask<T extends Task>(task: T, label: string): T {
  if (inspectionEnabled && inspection.thread) (taskLabels ??= new WeakMap()).set(task, label);
  return task;
}

const BEAT = Symbol("puppet-show.beat");

/** Yielded by `beat()`; tells the runtime to stop the clock. */
export interface BeatMark {
  readonly [BEAT]: true;
  readonly name: string;
}

export const isBeat = (v: unknown): v is BeatMark => typeof v === "object" && v !== null && BEAT in v;
export const beatMark = (name: string): BeatMark => ({ [BEAT]: true, name });

const isTask = (v: unknown): v is Task =>
  typeof v === "object" && v !== null && typeof (v as Task).next === "function" && typeof (v as Task)[Symbol.iterator] === "function";

export class Thread {
  /** Logical time: when this thread's last operation was meant to end. */
  time: number;
  children: Thread[] = [];
  done = false;

  readonly task: Task;
  readonly runtime: Runtime;
  readonly parent: Thread | null;
  /** @internal Debugger label; only set while inspection is enabled. */
  declare label: string;
  /** @internal Debugger id; only set while inspection is enabled. */
  declare id: number;

  constructor(task: Task, runtime: Runtime, parent: Thread | null) {
    this.task = task;
    this.runtime = runtime;
    this.parent = parent;
    this.time = parent ? parent.time : runtime.now;
    if (inspectionEnabled && inspection.thread) {
      this.label = taskLabels?.get(task) ?? (parent ? "task" : "scene");
      inspection.thread(this);
    }
  }

  /** Stop this thread and its children, running their `finally` blocks. */
  cancel(): void {
    if (this.done) return;
    this.done = true;
    for (const c of this.children) c.cancel();
    this.children = [];
    this.task.return();
  }
}

let current: Thread | null = null;

/** The thread whose generator is executing right now. */
export function useThread(): Thread {
  if (!current) throw new Error("puppet-show: no running thread (call this inside a task)");
  return current;
}

/** Current clock time of the running scene, in seconds. */
export const useNow = (): number => useThread().runtime.now;

export type Status = "running" | "beat" | "done";

/** Owns the clock and the root thread of one scene run. */
export class Runtime {
  now = 0;
  readonly root: Thread;
  private beats: string[] = [];

  constructor(task: Task) {
    this.root = new Thread(task, this, null);
  }

  /**
   * Advance the clock by `dt` seconds and resume every thread once.
   * Returns "beat" if any thread reached a beat during this frame.
   */
  advance(dt: number): { status: Status; beats: string[] } {
    this.now += dt;
    this.beats = [];
    step(this.root);
    const status: Status = this.root.done ? "done" : this.beats.length ? "beat" : "running";
    return { status, beats: this.beats };
  }

  /** @internal */
  hitBeat(name: string): void {
    this.beats.push(name);
  }
}

/** Resume children first so a parent sees this frame's completions. */
function step(thread: Thread): void {
  if (thread.done) return;
  for (const child of [...thread.children]) step(child);
  thread.children = thread.children.filter((c) => !c.done);
  resume(thread);
}

function resume(thread: Thread): void {
  const prev = current;
  current = thread;
  try {
    for (;;) {
      const r = thread.task.next();
      if (r.done) {
        thread.done = true;
        for (const c of thread.children) c.cancel();
        thread.children = [];
        return;
      }
      const v = r.value;
      if (isTask(v)) {
        spawnIn(thread, v);
        continue;
      }
      if (isBeat(v)) thread.runtime.hitBeat(v.name);
      return;
    }
  } finally {
    current = prev;
  }
}

function spawnIn(parent: Thread, task: Task): Thread {
  const child = new Thread(task, parent.runtime, parent);
  parent.children.push(child);
  step(child);
  return child;
}

/**
 * Start `task` as a child of the running thread and return immediately.
 * The child starts at its parent's logical time and stops with its parent.
 * `yield task` inside a generator does the same thing.
 */
export function fork(task: Task): Thread {
  return spawnIn(useThread(), task);
}

/* ------------------------------------------------------------- time primitives */

/** Wait `seconds` of scene time. */
export function* waitFor(seconds: number): Task {
  const thread = useThread();
  if (inspectionEnabled && inspection.thread) thread.label = `waitFor ${Number(seconds.toFixed(3))}s`;
  const end = thread.time + seconds;
  while (thread.runtime.now < end) yield;
  thread.time = end;
}

/**
 * Call `update(t)` every frame for `seconds`, with linear progress `t` in
 * [0, 1]. The final call is always exactly `update(1)`.
 */
export function* tween(seconds: number, update: (t: number) => void): Task {
  const thread = useThread();
  if (inspectionEnabled && inspection.thread) thread.label = `tween ${Number(seconds.toFixed(3))}s`;
  const start = thread.time;
  const end = start + seconds;
  while (thread.runtime.now < end) {
    update(Math.max(0, (thread.runtime.now - start) / seconds));
    yield;
  }
  thread.time = end;
  update(1);
}

/**
 * Wait for a condition. Conditions are only checked on frames, so afterwards
 * the thread's logical time snaps to the frame that observed it.
 */
export function* waitUntil(condition: () => boolean): Task {
  const thread = useThread();
  while (!condition()) yield;
  thread.time = Math.max(thread.time, thread.runtime.now);
}

/**
 * Wait for `threads`. Afterwards the caller's logical time is the latest
 * child's end time (or the earliest, with `any`), not the frame that noticed.
 */
export function* join(threads: Thread[], mode: "all" | "any" = "all"): Task {
  const thread = useThread();
  if (inspectionEnabled && inspection.thread) thread.label = mode;
  if (threads.length === 0) return;
  if (mode === "all") {
    while (threads.some((t) => !t.done)) yield;
    thread.time = Math.max(thread.time, ...threads.map((t) => t.time));
  } else {
    while (!threads.some((t) => t.done)) yield;
    thread.time = Math.max(thread.time, Math.min(...threads.filter((t) => t.done).map((t) => t.time)));
  }
}
