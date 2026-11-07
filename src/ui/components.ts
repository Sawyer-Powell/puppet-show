/**
 * Small, styled building blocks. Each returns a `Node`, so every piece of the
 * design language is also animatable.
 */

import { effect, type Signal, type Source } from "../core/signal.ts";
import { el, Node, type Child, type Props } from "../dom/node.ts";

import { resolveTone, type Tone } from "./tone.ts";
import { radioGroup } from "./radio.ts";
export { palette, type Hue } from "./palette.ts";
export type { Tone } from "./tone.ts";

/** A framed region with its title set into the top border. */
export function panel(title: Child, props: Props = {}, ...children: Child[]): Node {
  return el("section.ps-panel", props, el("div.ps-panel-title", title), ...children);
}

/** A labelled box: the noun of a diagram. */
export function box(label: Child, sub?: Child, props: Props = {}): Node {
  return el("div.ps-box", props, el("span", label), sub !== undefined && el("small", sub));
}

export function chip(label: Child, props: Props = {}): Node {
  return el("span.ps-chip", props, label);
}

/** `label ........ value`, with the value bound to a signal or function. */
export function readout(label: Child, value: () => unknown, props: Props = {}): Node {
  return el("div.ps-readout", props, el("span", label), el("span", () => String(value())));
}

export interface SliderOptions {
  label: string;
  value: Signal<number>;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}

/** A range input two-way bound to a signal. */
export function slider(o: SliderOptions): Node {
  const input = el("input", {
    attrs: { type: "range", min: o.min, max: o.max, step: o.step ?? 1, "aria-label": o.label },
    on: {
      input: (e) => o.value(Number((e.target as HTMLInputElement).value)),
      keydown: (e) => e.stopPropagation(),
    },
  });
  effect(() => {
    (input.el as HTMLInputElement).value = String(o.value());
  });
  const fmt = o.format ?? String;
  return el("label.ps-slider", el("span", o.label), input, el("output", () => fmt(o.value())));
}

/** Flex row / CSS grid helpers, so scenes rarely need inline layout. */
export const row = (props: Props = {}, ...children: Child[]): Node => el("div.ps-row", props, ...children);
export const grid = (columns: string, props: Props = {}, ...children: Child[]): Node =>
  el("div.ps-grid", { ...props, style: { gridTemplateColumns: columns, ...props.style } }, ...children);

/* ------------------------------------------------------------------ choice */

export interface ChoiceOptions<T> {
  label: string;
  value: Signal<T>;
  options: { value: NoInfer<T>; label: string; disabled?: boolean }[];
}

/** A segmented control (radio group) two-way bound to a signal. */
export function choice<T>(o: ChoiceOptions<T>): Node {
  const group = el("div.ps-choice-options");
  const buttons = o.options.map(opt => el("button", { attrs: { type: "button" } }, opt.label));
  group.add(buttons);
  radioGroup({
    group, label: o.label, buttons,
    checked: i => Object.is(o.value(), o.options[i].value),
    select: i => o.value(o.options[i].value),
    disabled: i => o.options[i].disabled ?? false,
  });
  return el("div.ps-choice", el("span", o.label), group);
}

/* ------------------------------------------------------------------- slots */

export interface SlotsOptions {
  /** Label above each slot; default the index. Return "" for none. */
  label?: (i: number) => string;
  /** Minimum slot width, e.g. "7ch" (default). Slots wrap to fit. */
  width?: string;
}

export interface Slots extends Node {
  /** The content container of slot `i`: `move()` things into it. */
  at(i: number): Node;
  /** The whole cell of slot `i` (frame + label), for highlighting: `cell(i).flag("ps-hot")`. */
  cell(i: number): Node;
  /** Reactively flag every cell matching a predicate. */
  mark(className: string, predicate: (i: number) => boolean): void;
  readonly count: number;
}

/**
 * A row of fixed-size, indexed slots, e.g. array buckets or queue positions.
 * Slots reserve their size while empty, so `move()` between them never
 * shifts the layout.
 */
export function slots(count: number, o: SlotsOptions = {}): Slots {
  const label = o.label ?? String;
  const cells: Node[] = [];
  const bodies: Node[] = [];
  for (let i = 0; i < count; i++) {
    const body = el("div.ps-slot-body");
    const text = label(i);
    cells.push(el("div.ps-slot", text !== "" && el("small", text), body));
    bodies.push(body);
  }
  const root = el("div.ps-slots", { style: o.width ? { "--slot-w": o.width } : {} }, cells);
  return Object.assign(root, {
    at: (i: number) => bodies[i], cell: (i: number) => cells[i], count,
    mark(className: string, predicate: (i: number) => boolean): void {
      const flags = cells.map((cell) => cell.flag(className));
      effect(() => flags.forEach((flag, i) => flag(predicate(i))));
    },
  });
}

/* ---------------------------------------------------------------- timeline */

export interface TimelineOptions {
  /** Visible time (or any numeric) range. Reactive. */
  domain: Source<[number, number]>;
  /** Axis labels at these values. Reactive. */
  ticks?: Source<number[]>;
  format?: (v: number) => string;
  /** Width of the lane label column. Default "17ch". */
  labelWidth?: string;
}

export interface BarOptions {
  /** Palette token name or hex value. Default "bg3". */
  hue?: Tone;
  /** "wait" is hatched (blocked/waiting), "gap" is red hatching (lost time). */
  pattern?: "solid" | "wait" | "gap";
  /** Initial grow (scaleX from the left). Tween `bar.grow` to animate. Default 1. */
  grow?: number;
}

export interface Bar extends Node {
  /** 0..1, how much of the bar is drawn from its left edge. */
  readonly grow: Signal<number>;
}

/**
 * Lanes of bars and marks over a shared numeric axis: thread timelines, retry
 * schedules, Gantt-like charts. Positions are percentages, so it is fully
 * responsive, and every position accepts a signal or function.
 *
 *   const tl = timeline({ domain: [0, 1], ticks: [0, 0.5, 1], format: (t) => `${t}s` });
 *   const work = tl.bar(0, 0.5, { hue: "blue", grow: 0 });
 *   tl.lane("worker", work, () => frames().map((t) => tl.dot(t)));
 *   tl.marker(0.5, "done");
 *   yield* work.grow(1, 0.4);
 */
export class Timeline extends Node<HTMLDivElement> {
  private readonly labels: Node;
  private readonly tracks: Node;
  private readonly axis: Node;
  private readonly domain: Source<[number, number]>;

  constructor(o: TimelineOptions) {
    super(document.createElement("div"));
    this.el.className = o.ticks === undefined ? "ps-timeline ps-no-axis" : "ps-timeline";
    this.el.style.setProperty("--label-w", o.labelWidth ?? "17ch");
    this.domain = o.domain;
    const fmt = o.format ?? String;
    const ticks = o.ticks;
    this.axis = el(
      "div.ps-tl-axis",
      ticks === undefined ? null : () => (typeof ticks === "function" ? ticks() : ticks).map((t) => el("span", { style: { left: this.pos(t) } }, fmt(t))),
    );
    this.labels = el("div.ps-tl-labels", el("div.ps-tl-axis-label"));
    this.tracks = el("div.ps-tl-tracks", this.axis);
    this.add(this.labels, this.tracks);
  }

  /** CSS `left` for value `v`, reactive to the domain. */
  pos(v: Source<number>): () => string {
    return () => {
      const [a, b] = typeof this.domain === "function" ? this.domain() : this.domain;
      const x = typeof v === "function" ? v() : v;
      return `${(100 * (x - a)) / (b - a || 1)}%`;
    };
  }

  /** Width for the span [from, to], reactive to the domain. */
  span(from: Source<number>, to: Source<number>): () => string {
    return () => {
      const [a, b] = typeof this.domain === "function" ? this.domain() : this.domain;
      const v = (s: Source<number>) => (typeof s === "function" ? s() : s);
      return `${(100 * (v(to) - v(from))) / (b - a || 1)}%`;
    };
  }

  /** Add a lane. Its opacity also fades its label. */
  lane(label: Child, ...marks: Child[]): Node {
    const track = el("div.ps-tl-lane", marks);
    const name = el("div.ps-tl-label", { opacity: () => track.opacity() }, label);
    this.labels.el.insertBefore(name.el, this.labels.el.lastChild);
    this.tracks.el.insertBefore(track.el, this.axis.el);
    return track;
  }

  bar(from: Source<number>, to: Source<number>, o: BarOptions = {}): Bar {
    const b = el(`div.ps-tl-bar.ps-${o.pattern ?? "solid"}`, {
      style: { left: this.pos(from), width: this.span(from, to), "--hue": resolveTone(o.hue ?? "bg3") },
    });
    const grow = b.css("--g", o.grow ?? 1);
    return Object.assign(b, { grow });
  }

  /** A point mark; `ring` marks a completion or event. */
  dot(at: Source<number>, o: { ring?: boolean; hue?: Tone } = {}): Node {
    return el(`div.ps-tl-dot${o.ring ? ".ps-ring" : ""}`, { style: { left: this.pos(at), "--hue": resolveTone(o.hue ?? (o.ring ? "yellow" : "fg")) } });
  }

  /** A short vertical tick, e.g. a frame boundary. */
  tick(at: Source<number>): Node {
    return el("div.ps-tl-tick", { style: { left: this.pos(at) } });
  }

  /** A text label in a lane, starting at `at`. */
  note(at: Source<number>, text: Child, o: { hue?: Tone } = {}): Node {
    return el("div.ps-tl-note", { style: { left: this.pos(at), color: resolveTone(o.hue ?? "yellow") } }, text);
  }

  /** A vertical line across all lanes, labelled above. */
  marker(at: Source<number>, label?: Child, o: { hue?: Tone; opacity?: number } = {}): Node {
    const m = el(
      "div.ps-tl-marker",
      { style: { left: this.pos(at), "--hue": resolveTone(o.hue ?? "yellow") }, opacity: o.opacity ?? 1 },
      label !== undefined && el("span", label),
    );
    this.tracks.add(m);
    this.el.classList.add("ps-has-markers");
    return m;
  }
}

export const timeline = (o: TimelineOptions): Timeline => new Timeline(o);
