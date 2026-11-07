/** Layout-following annotations, reversible focus, and a run-local glossary. */
import { atNextBeat } from "../core/step-scope.ts";
import { type Step } from "../core/flow.ts";
import { isSeeking } from "../core/player.ts";
import { tween, type Task } from "../core/thread.ts";
import { effect, getOwner, signal, type OwnerHandle } from "../core/signal.ts";
import { el, type Child, type Node } from "../dom/node.ts";
import { useView } from "../dom/view.ts";
import { palette, type Tone } from "../ui/components.ts";
import { emphasis } from "../ui/tokens.ts";

export interface HighlightOptions { tone?: "hot" | "ok" | "bad" | "live" }
/** Step-scoped emphasis; execute with chain/all/narrate. Clears at the next beat. */
export function highlightNodes(...nodes: Node[]): Step;
export function highlightNodes(options: HighlightOptions, ...nodes: Node[]): Step;
export function highlightNodes(...args: [HighlightOptions, ...Node[]] | Node[]): Step {
  const options = args[0] && !("el" in args[0]) ? args.shift() as HighlightOptions : {};
  const nodes = args as Node[];
  return () => {
    const flags = nodes.map(node => node.flag(`ps-${options.tone ?? "hot"}`));
    const initial = flags.map(flag => flag.peek());
    flags.forEach(flag => flag(true));
    atNextBeat(() => flags.forEach((flag, i) => flag(initial[i])));
  };
}

export interface NoteOptions { side?: "top" | "bottom" | "left" | "right"; tone?: Tone; gap?: number }
/** An overlay annotation; returned node supports the usual opacity/motion signals. */
export function note(target: Node, text: Child, options: NoteOptions = {}): Node {
  const view = useView();
  const annotation = el("div.ps-note", { style: { color: toneColor(options.tone ?? "yellow") } }, text);
  view.overlay.add(annotation);
  const layout = () => {
    const r = view.measure(target);
    const w = annotation.el.offsetWidth, h = annotation.el.offsetHeight;
    const gap = options.gap ?? 8;
    const side = options.side ?? "bottom";
    let x = r.x + (r.width - w) / 2, y = r.bottom + gap;
    if (side === "top") y = r.top - h - gap;
    if (side === "left") { x = r.left - w - gap; y = r.y + (r.height - h) / 2; }
    if (side === "right") { x = r.right + gap; y = r.y + (r.height - h) / 2; }
    annotation.el.style.left = `${Math.round(Math.max(0, Math.min(x, view.el.clientWidth - w)))}px`;
    annotation.el.style.top = `${Math.round(y)}px`;
  };
  view.onLayout(layout);
  if (!isSeeking()) layout();
  // The visual overlay is aria-hidden; expose the same text at the target.
  effect(() => {
    const value = typeof text === "function" ? text() : text;
    target.el.setAttribute("aria-description", typeof value === "object" ? annotation.el.textContent ?? "" : String(value ?? ""));
  });
  return annotation;
}
/** Compact annotation using the same layout-following anchor. */
export function label(target: Node, text: Child): Node {
  const tag = note(target, text, { side: "top", gap: 2, tone: "aqua" });
  tag.el.classList.add("ps-label");
  return tag;
}

function toneColor(tone: Tone): string {
  const name = Object.keys(palette).find(key => key === tone || palette[key as keyof typeof palette] === tone);
  if (!name) throw new Error(`puppet-show: unknown tone ${tone}`);
  return `var(--ps-${name})`;
}

export interface FocusTask extends Task { restore(duration?: number): Task }
/** Fade selected nodes to the readable `emphasis.dim` (AA-safe); restore() returns their original opacity. */
export function dim(...nodes: Node[]): FocusTask {
  const initial = nodes.map(node => node.opacity());
  const task = (function* (): Task {
    yield* tween(0.3, t => nodes.forEach((node, i) => node.opacity(initial[i] * (1 - (1 - emphasis.dim) * t))));
  })() as FocusTask;
  task.restore = function* (duration = 0.3): Task {
    const start = nodes.map(node => node.opacity());
    yield* tween(duration, t => nodes.forEach((node, i) => node.opacity(start[i] + (initial[i] - start[i]) * t)));
  };
  return task;
}

/** De-emphasize sibling branches without fading the selected nodes' ancestors. */
export function spotlight(...nodes: Node[]): FocusTask {
  const selected = nodes.map(node => node.el);
  const branches: HTMLElement[] = [];
  function visit(element: HTMLElement): void {
    if (selected.includes(element)) return;
    if (selected.some(target => element.contains(target))) {
      for (const child of element.children) if (child instanceof HTMLElement) visit(child);
    } else branches.push(element);
  }
  for (const child of useView().content.el.children) if (child instanceof HTMLElement) visit(child);
  const initial = branches.map(element => element.style.filter);
  const task = (function* (): Task {
    yield* tween(0.3, t => branches.forEach((element, i) => { element.style.filter = `${initial[i]} opacity(${1 - (1 - emphasis.dim) * t})`.trim(); }));
  })() as FocusTask;
  task.restore = function* (duration = 0.3): Task {
    yield* tween(duration, t => branches.forEach((element, i) => { element.style.filter = t === 1 ? initial[i] : `${initial[i]} opacity(${emphasis.dim + (1 - emphasis.dim) * t})`.trim(); }));
  };
  return task;
}

interface Entry { word: string; definition: string }
const registries = new WeakMap<object, ReturnType<typeof signal<Entry[]>>>();
const fallback = {};
function registry() {
  const owner: OwnerHandle = getOwner();
  const key = owner ?? fallback;
  let entries = registries.get(key);
  if (!entries) { entries = signal<Entry[]>([]); registries.set(key, entries); }
  return entries;
}
/** An inline focusable term with a native hover/focus tooltip. */
export function term(word: string, definition: string): Node {
  const entries = registry();
  if (!entries.peek().some(entry => entry.word === word)) entries([...entries.peek(), { word, definition }]);
  return el("span.ps-term", { attrs: { tabindex: 0, title: definition, "aria-label": `${word}: ${definition}` } }, word,
    el("span.ps-definition", { attrs: { role: "tooltip" } }, definition));
}
/** Terms registered in this run so far, updated as additional terms are built. */
export function glossary(): Node {
  const entries = registry();
  return el("dl.ps-glossary", () => entries().map(entry => [el("dt", entry.word), el("dd", entry.definition)]));
}
