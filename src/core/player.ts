/**
 * Player: plays a scene step by step and seeks by deterministic replay.
 *
 * Beats split a scene into segments. Segment `i` runs from beat `i - 1` (or
 * the start) up to beat `i` (or the end). The player is always either playing
 * a segment or paused at the end of one.
 *
 * Nothing ever runs backwards. To show the end of segment `i` the player
 * disposes the current run, starts the scene generator again, and advances it
 * with a fixed time step until it reaches beat `i`. Effects are held during
 * the fast-forward and flushed once, so a seek costs one DOM update.
 */

import { Root, flush, hold, release, signal } from "./signal.ts";
import { Runtime, type Task } from "./thread.ts";

export interface Segment {
  /** Name of the beat that ends this segment ("" for the last one). */
  name: string;
  start: number;
  end: number;
}

export interface SceneError {
  message: string;
  /** Zero-based segment in which the scene threw. */
  chapterStep: number;
  cause: unknown;
}

export interface SeekStats {
  /** Frames simulated to reach the target. */
  frames: number;
  /** Wall-clock milliseconds the seek took, including the flush. */
  ms: number;
  /** Segment the seek landed on. */
  segment: number;
}

export interface PlayerOptions {
  /** Time step used when fast-forwarding. Defaults to 1/60 s. */
  dt?: number;
  /** Abort a fast-forward past this scene time (guards infinite scenes). */
  maxTime?: number;
  /** Frame scheduler; defaults to `requestAnimationFrame`. */
  requestFrame?: (cb: (ms: number) => void) => unknown;
  /** Called once per failure, including analysis failures (before construction returns). */
  onError?: (error: SceneError) => void;
}

let seekingDepth = 0;

/** True while a player fast-forwards. Layout-measuring helpers skip work then. */
export const isSeeking = (): boolean => seekingDepth > 0;

export class Player {
  /** Segment being played, or whose end we are paused at. */
  readonly step = signal(0);
  readonly playing = signal(false);
  /** Most recent scene failure; cleared when a new run begins. */
  readonly error = signal<SceneError | null>(null);
  /** Scene clock of the current run, in seconds. */
  readonly time = signal(0);
  readonly lastSeek = signal<SeekStats | null>(null);
  /** Playback rate; 0.25 is a useful slow motion. */
  readonly speed = signal(1);
  segments: Segment[] = [];

  private scope: Root | null = null;
  private runtime!: Runtime;
  private beats = 0;
  private started = false;
  private token = 0;
  private readonly dt: number;
  private readonly maxTime: number;
  private readonly requestFrame: (cb: (ms: number) => void) => unknown;

  private readonly mount: () => Task;
  private readonly onError?: (error: SceneError) => void;

  constructor(mount: () => Task, options: PlayerOptions = {}) {
    this.mount = mount;
    this.onError = options.onError;
    this.dt = options.dt ?? 1 / 60;
    this.maxTime = options.maxTime ?? 600;
    this.requestFrame = options.requestFrame ?? ((cb) => requestAnimationFrame(cb));
    this.segments = this.analyze();
  }

  get count(): number {
    return this.segments.length;
  }

  /** @internal The existing run, without advancing or creating it. */
  get inspectRuntime(): Runtime | null { return this.runtime ?? null; }

  get done(): boolean {
    return !!this.error.peek() || this.runtime.root.done;
  }

  /** Jump to the end of segment `i` instantly. */
  seek(i: number): void {
    i = this.clamp(i);
    this.stop();
    const t0 = performance.now();
    try {
      this.reset();
      const frames = this.fastForward(i + 1);
      this.step(i);
      this.time(this.runtime.now);
      this.lastSeek({ frames, ms: performance.now() - t0, segment: i });
    } catch (cause) {
      this.fail(cause);
    }
  }

  /** Animate segment `i`, starting from the end of segment `i - 1`. */
  play(i: number): void {
    i = this.clamp(i);
    try {
      if (i === 0) {
        this.stop();
        this.reset();
      } else {
        this.seek(i - 1);
      }
      if (this.error.peek()) return;
      this.step(i);
      this.run();
    } catch (cause) {
      this.fail(cause);
    }
  }

  /** Advance one step. Returns false at the end of the scene. */
  next(): boolean {
    if (this.error.peek()) return false;
    if (this.playing()) {
      this.seek(this.step());
      return true;
    }
    if (this.step() + 1 >= this.count) return false;
    this.play(this.step() + 1);
    return true;
  }

  /** Go back one step. Returns false at the start of the scene. */
  prev(): boolean {
    const i = this.step();
    if (i === 0) return false;
    this.seek(i - 1);
    return true;
  }

  replay(): void {
    this.play(this.step());
  }

  /** Progress through the current segment, 0..1. */
  progress(): number {
    const s = this.segments[this.step()];
    if (!s) return 0;
    if (!this.playing()) return 1;
    const span = s.end - s.start;
    return span <= 0 ? 1 : Math.min(1, Math.max(0, (this.time() - s.start) / span));
  }

  dispose(): void {
    this.stop();
    this.scope?.dispose();
    this.scope = null;
  }

  /* ------------------------------------------------------------- internals */

  private clamp(i: number): number {
    return Math.max(0, Math.min(this.count - 1, i));
  }

  private stop(): void {
    this.token++;
    this.playing(false);
  }

  private fail(cause: unknown): void {
    this.stop();
    this.step(this.beats);
    const error = { message: cause instanceof Error ? cause.message : String(cause), chapterStep: this.beats, cause };
    this.error(error);
    this.onError?.(error);
  }

  private reset(): void {
    this.error(null);
    this.beats = 0;
    this.started = false;
    this.scope?.dispose();
    this.scope = new Root();
    this.runtime = this.scope.run(() => new Runtime(this.mount()));
  }

  private advance(dt: number): string[] {
    const step = this.started ? dt : 0;
    this.started = true;
    const { beats } = this.scope!.run(() => this.runtime.advance(step));
    this.beats += beats.length;
    return beats;
  }

  /**
   * Run with held effects until `beats` beats have been seen or the scene
   * ends, then flush once. Returns the number of frames simulated.
   */
  private fastForward(beats: number, onBeat?: (name: string, at: number) => void): number {
    seekingDepth++;
    hold();
    let frames = 0;
    try {
      while (this.beats < beats && !this.runtime.root.done) {
        for (const name of this.advance(this.dt)) onBeat?.(name, this.runtime.now);
        frames++;
        if (this.runtime.now > this.maxTime) throw new Error(`puppet-show: scene exceeded ${this.maxTime}s while seeking`);
      }
    } finally {
      release();
      seekingDepth--;
    }
    flush();
    return frames;
  }

  /** Dry-run the whole scene once to find its segments. */
  private analyze(): Segment[] {
    const segments: Segment[] = [];
    let start = 0;
    try {
      this.reset();
      this.fastForward(Infinity, (name, at) => {
        segments.push({ name, start, end: at });
        start = at;
      });
    } catch (cause) {
      this.fail(cause);
    }
    const end = this.runtime?.now ?? start;
    if (this.error.peek() || end - start > 1e-9 || segments.length === 0) segments.push({ name: "", start, end });
    return segments;
  }

  private run(): void {
    const token = ++this.token;
    this.playing(true);
    let last: number | null = null;
    const frame = (ms: number) => {
      if (token !== this.token) return;
      const dt = last === null ? 0 : Math.min((ms - last) / 1000, 0.1) * this.speed.peek();
      last = ms;
      try {
        hold();
        try {
          this.advance(dt);
          this.time(this.runtime.now);
        } finally {
          release();
        }
        flush();
      } catch (cause) {
        this.fail(cause);
        return;
      }
      const target = this.step.peek() + 1;
      if (this.beats >= target || this.runtime.root.done) {
        this.playing(false);
        return;
      }
      this.requestFrame(frame);
    };
    this.requestFrame(frame);
  }
}
