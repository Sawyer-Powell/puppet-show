/**
 * Reactive core: signals, effects and ownership roots.
 *
 * A signal is a callable value cell. Called with no arguments it reads (and is
 * tracked by the running effect), with one argument it writes, and with a
 * duration it returns a tween task that animates towards the new value:
 *
 *   const x = signal(0);
 *   x();            // read  -> 0
 *   x(10);          // write
 *   yield* x(240, 1, ease.inOutCubic);   // animate over one second
 *
 * Effects re-run when a signal they read changes. Re-runs are queued and
 * flushed together, so many writes in one animation frame cost one DOM update.
 */

import { tween, type Task } from "./thread.ts";
import { ease as easings, type Ease } from "./ease.ts";
import { interpolatorFor, type Interpolator } from "./interp.ts";

export type Source<T> = T | (() => T);

/** A tween task that can be extended with further keyframes via `.to()`. */
export interface TweenTask<T> extends Task {
  to(value: Source<T>, duration: number, ease?: Ease): TweenTask<T>;
}

export interface Signal<T> {
  (): T;
  (value: Source<T>): void;
  (value: Source<T>, duration: number, ease?: Ease): TweenTask<T>;
  /** Read without registering a dependency. */
  peek(): T;
  /** @internal Read only stored values; omit derived callbacks in pure snapshots. */
  peek(evaluate: false): T | undefined;
  /** Restore the value the signal was created with. */
  reset(): void;
}

export interface SignalOptions<T> {
  /** How to blend two values. Defaults by type: number, hex colour, text. */
  interp?: Interpolator<T>;
  /** Default easing for tweens on this signal. */
  ease?: Ease;
}

/* ------------------------------------------------------------------ tracking */

interface Dependency {
  subscribers: Set<Effect>;
}

/** Effects own whatever they create while running; it is disposed on re-run. */
class Effect implements Owner {
  deps = new Set<Dependency>();
  disposed = false;
  private owned: (() => void)[] = [];
  readonly fn: () => void;
  constructor(fn: () => void) {
    this.fn = fn;
  }

  add(dispose: () => void): void {
    this.owned.push(dispose);
  }

  run(): void {
    if (this.disposed) return;
    this.release();
    this.unlink();
    const prevObserver = observer;
    const prevOwner = owner;
    observer = this;
    owner = this;
    try {
      this.fn();
    } finally {
      observer = prevObserver;
      owner = prevOwner;
    }
  }

  private release(): void {
    for (const d of this.owned.splice(0).reverse()) d();
  }

  unlink(): void {
    for (const dep of this.deps) dep.subscribers.delete(this);
    this.deps.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.release();
    this.unlink();
    queue.delete(this);
  }
}

let observer: Effect | null = null;
const queue = new Set<Effect>();
let holdDepth = 0;
let flushScheduled = false;

function track(dep: Dependency): void {
  if (!observer) return;
  dep.subscribers.add(observer);
  observer.deps.add(dep);
}

function trigger(dep: Dependency): void {
  for (const sub of dep.subscribers) queue.add(sub);
  if (queue.size && !holdDepth && !flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
}

const afterFlushHooks = new Set<() => void>();

/**
 * Run `fn` after every flush that ran at least one effect, once the DOM is
 * up to date. Layout-dependent drawing (connectors) hooks in here. Returns
 * an unsubscribe function.
 */
export function afterFlush(fn: () => void): () => void {
  afterFlushHooks.add(fn);
  return () => afterFlushHooks.delete(fn);
}

/** Run every queued effect now. Effects queued while flushing also run. */
export function flush(): void {
  flushScheduled = false;
  let guard = 0;
  let ran = false;
  while (queue.size) {
    if (++guard > 100) throw new Error("puppet-show: effects did not settle (cycle?)");
    const batch = [...queue];
    queue.clear();
    for (const e of batch) e.run();
    ran = true;
  }
  if (ran) for (const hook of [...afterFlushHooks]) hook();
}

/**
 * Defer effect flushing until `release()`. The player holds while it advances
 * a frame, or while fast-forwarding during a seek, then flushes once.
 */
export function hold(): void {
  holdDepth++;
}

export function release(): void {
  holdDepth = Math.max(0, holdDepth - 1);
}

/** Read signals inside `fn` without tracking them. */
export function untrack<T>(fn: () => T): T {
  const prev = observer;
  observer = null;
  try {
    return fn();
  } finally {
    observer = prev;
  }
}

/* ----------------------------------------------------------------- ownership */

/**
 * An ownership scope. Effects and cleanups created while a root is running
 * are released together by `dispose()`. Each scene run gets its own root, so
 * a replay starts from a clean slate.
 */
interface Owner {
  add(dispose: () => void): void;
}

export class Root implements Owner {
  private disposers: (() => void)[] = [];

  /** Run `fn` with this root as the owner of anything it creates. */
  run<T>(fn: () => T): T {
    const prev = owner;
    owner = this;
    try {
      return fn();
    } finally {
      owner = prev;
    }
  }

  /** @internal */
  add(dispose: () => void): void {
    this.disposers.push(dispose);
  }

  dispose(): void {
    const ds = this.disposers.splice(0).reverse();
    for (const d of ds) d();
  }
}

let owner: Owner | null = null;

/** An opaque handle to the current owner, for `runWithOwner`. */
export type OwnerHandle = Owner | null;

export const getOwner = (): OwnerHandle => owner;

/**
 * Run `fn` owned by `handle` and untracked. Used to create bindings lazily
 * (say, the first time `node.x` is read inside some effect) without tying
 * their lifetime to whichever effect happened to be running.
 */
export function runWithOwner<T>(handle: OwnerHandle, fn: () => T): T {
  const prevOwner = owner;
  const prevObserver = observer;
  owner = handle;
  observer = null;
  try {
    return fn();
  } finally {
    owner = prevOwner;
    observer = prevObserver;
  }
}

/** Register `fn` to run when the current root is disposed. */
export function onCleanup(fn: () => void): void {
  owner?.add(fn);
}

/** Run `fn` now and again whenever a signal it read changes. */
export function effect(fn: () => void): () => void {
  const e = new Effect(fn);
  e.run();
  const dispose = () => e.dispose();
  onCleanup(dispose);
  return dispose;
}

/* ------------------------------------------------------------------- signals */

const resolve = <T>(v: Source<T>): T => (typeof v === "function" ? (v as () => T)() : v);

/**
 * Create a signal. Its value may be a constant or a function of other signals;
 * a function makes it derived until the next write.
 */
export function signal<T>(initial: Source<T>, options: SignalOptions<T> = {}): Signal<T> {
  const dep: Dependency = { subscribers: new Set() };
  let source: Source<T> = initial;
  let interp = options.interp;

  const read = (): T => {
    track(dep);
    return resolve(source);
  };
  const write = (value: Source<T>) => {
    if (Object.is(value, source)) return;
    source = value;
    trigger(dep);
  };

  const animate = (target: Source<T>, duration: number, e: Ease = options.ease ?? easings.inOutCubic): TweenTask<T> => {
    function* run(): Task {
      const from = untrack(read);
      const to = untrack(() => resolve(target));
      interp ??= interpolatorFor(from, to);
      yield* tween(duration, (t) => write(interp!(from, to, e(t))));
      write(target);
    }
    const task = run() as TweenTask<T>;
    task.to = (next, d, e2) => chained(task, animate, next, d, e2);
    return task;
  };

  function sig(...args: unknown[]): unknown {
    if (args.length === 0) return read();
    if (args.length === 1) return write(args[0] as Source<T>);
    return animate(args[0] as Source<T>, args[1] as number, args[2] as Ease | undefined);
  }
  sig.peek = ((evaluate = true) => evaluate ? untrack(read) : typeof source === "function" ? undefined : source) as Signal<T>["peek"];
  sig.reset = () => write(initial);
  return sig as Signal<T>;
}

type Animate<T> = (target: Source<T>, duration: number, ease?: Ease) => TweenTask<T>;

/** `first`, then a tween to `value` that starts from wherever `first` ended. */
function chained<T>(first: Task, animate: Animate<T>, value: Source<T>, d: number, e?: Ease): TweenTask<T> {
  function* run(): Task {
    yield* first;
    yield* animate(value, d, e);
  }
  const task = run() as TweenTask<T>;
  task.to = (v, d2, e2) => chained(task, animate, v, d2, e2);
  return task;
}

export const isSignal = (v: unknown): v is Signal<unknown> =>
  typeof v === "function" && typeof (v as Signal<unknown>).peek === "function";
