/** Quiet, layout-reserved text motion. No timers, geometry reads or blur. */
import { effect, signal, untrack, type Source } from "../core/signal.ts";
import { tween, type Task } from "../core/thread.ts";
import { ease } from "../core/ease.ts";
import { el, type Node } from "../dom/node.ts";
import { render } from "../ui/markup.ts";
import { scales } from "../ui/tokens.ts";

export interface TextMotionOptions {
  /** Defaults to node.text; alternatively bind a reactive source explicitly. */
  text?: Source<string>;
  split?: "words" | "characters" | "lines";
  mode?: "rise" | "type";
  markup?: boolean;
  /** Reserve every future value up front for jump-free swaps/reactive updates. */
  reserve?: readonly string[];
  duration?: number;
  stagger?: number;
}
export interface TextMotion {
  in(): Task;
  out(): Task;
  /** next must be in reserve (or be the initial value). */
  swap(next: string): Task;
}
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const fast = parseFloat(scales["duration-fast"]);

/** Pure segmentation; spaces and explicit newlines are retained exactly. */
export function textUnits(text: string, split: TextMotionOptions["split"] = "words"): string[] {
  if (split === "characters") return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), s => s.segment);
  return text.match(split === "lines" ? /[^\n]+|\n/g : /\S+|\s+/gu) ?? [];
}

/** Owns a text-only node's children; retains its tag, classes and motion signals. */
export function textMotion(node: Node, options: TextMotionOptions = {}): TextMotion {
  const source = options.text ?? node.text;
  const read = () => typeof source === "function" ? source() : source;
  const initial = read();
  const values = [...new Set([initial, ...(options.reserve ?? [])])];
  // Hidden until in(): reduced motion makes the reveal instant, not pre-revealed.
  const progress = signal(0), cross = signal(1);
  let current = initial, previous = initial;
  const layers = new Map<string, { node: Node; units: Node[]; plain: string }>();
  const duration = options.duration ?? fast * 2;
  const stagger = options.stagger ?? fast / 3;
  if (![duration, stagger].every(n => Number.isFinite(n) && n >= 0)) throw new Error("puppet-show: invalid text timing");
  node.el.classList.add("ps-text-motion");

  function layer(value: string) {
    const content = el("span.ps-text-layer", { attrs: { "aria-hidden": "true" } });
    if (options.markup) content.el.innerHTML = render(value);
    else content.el.textContent = value;
    const plain = content.el.textContent ?? "";
    // Range fragments preserve inline markup even when a unit crosses tags.
    const walker = document.createTreeWalker(content.el, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    const locate = (offset: number): [globalThis.Node, number] => {
      for (const text of texts) {
        if (offset <= text.length) return [text, offset];
        offset -= text.length;
      }
      return [content.el, content.el.childNodes.length];
    };
    let offset = 0;
    const units: Node[] = [];
    const fragments = textUnits(plain, options.mode === "type" ? "characters" : options.split).map(text => {
      const range = document.createRange();
      range.setStart(...locate(offset)); offset += text.length; range.setEnd(...locate(offset));
      const fragment = range.cloneContents();
      if (/^\s+$/u.test(text)) return document.createTextNode(text);
      const unit = el("span.ps-text-unit", fragment);
      units.push(unit);
      return unit.el;
    });
    content.el.replaceChildren(...fragments);
    return { node: content, units, plain };
  }
  for (const value of values) layers.set(value, layer(value));
  node.replace(...[...layers.values()].map(l => l.node));

  function paint() {
    const p = progress();
    const active = layers.get(current)!;
    node.el.setAttribute("aria-label", active.plain);
    const total = duration + Math.max(0, active.units.length - 1) * stagger;
    for (const [value, l] of layers) {
      const alpha = value === current ? cross() : value === previous ? 1 - cross() : 0;
      l.node.el.style.opacity = String(alpha);
      l.node.el.style.visibility = alpha === 0 ? "hidden" : "";
      l.units.forEach((unit, i) => {
        const local = options.mode === "type" ? (p * active.units.length >= i + 1 ? 1 : 0)
          : ease.outCubic(duration === 0 ? (p * total >= i * stagger ? 1 : 0) : Math.max(0, Math.min(1, (p * total - i * stagger) / duration)));
        unit.opacity(value === current ? local : 1);
        unit.y(options.mode === "type" ? 0 : (1 - (value === current ? local : 1)) * parseFloat(scales["space-4"]));
        unit.el.classList.toggle("ps-text-caret", options.mode === "type" && p > 0 && p < 1 && i === Math.max(0, Math.floor(p * active.units.length) - 1));
      });
    }
  }
  effect(() => {
    const next = read();
    if (!layers.has(next)) throw new Error("puppet-show: reactive text must be included in reserve");
    current = next;
    // node.text's own binding writes textContent first; restore our reserved layers.
    node.replace(...[...layers.values()].map(l => l.node));
    untrack(paint);
  });
  effect(paint);
  const animate = function* (to: number): Task {
    const start = progress();
    const seconds = options.mode === "type" ? Math.max(duration, layers.get(current)!.units.length * stagger)
      : duration + Math.max(0, layers.get(current)!.units.length - 1) * stagger;
    yield* tween(reduced() ? 0 : seconds, t => { progress(start + (to - start) * t); paint(); });
  };
  paint();
  return {
    in: () => animate(1), out: () => animate(0),
    *swap(next): Task {
      if (!layers.has(next)) throw new Error("puppet-show: swap text must be included in reserve");
      previous = current; current = next; progress(1); cross(0); paint();
      yield* tween(reduced() ? 0 : duration, t => { cross(ease.inOutCubic(t)); paint(); });
      previous = current;
    },
  };
}

export interface CountTextOptions {
  from?: number;
  /** Required fixed capacity in characters, including formatting and signs. */
  width: number;
  format?: (value: number) => string;
  duration?: number;
}
/** A formatted numeric readout. Updates its accessible value once, not each frame. */
export function countText(node: Node, options: CountTextOptions): { to(value: number): Task } {
  if (!Number.isInteger(options.width) || options.width < 1) throw new Error("puppet-show: countText needs a positive width");
  const value = signal(options.from ?? 0);
  const format = options.format ?? (n => String(Math.round(n)));
  const visual = el("span", { attrs: { "aria-hidden": "true" } }, () => format(value()));
  node.replace(visual);
  node.el.classList.add("ps-count-text");
  node.el.style.width = `${options.width}ch`;
  node.el.setAttribute("aria-label", format(value()));
  return { *to(next): Task {
    if (!Number.isFinite(next) || format(next).length > options.width) throw new Error("puppet-show: countText value exceeds reserved width");
    const start = value();
    yield* tween(reduced() ? 0 : options.duration ?? parseFloat(scales["duration-base"]), t => value(start + (next - start) * ease.inOutCubic(t)));
    node.el.setAttribute("aria-label", format(next));
  } };
}
