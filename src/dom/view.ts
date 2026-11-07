/**
 * Views host a scene's DOM, plus layout-aware motion: `fly` and `move`.
 *
 * Both measure the real layout, so they only work while playing. During a
 * seek they skip straight to their end state (and still take their duration
 * of scene time, so beats land where they would have).
 */

import { afterFlush, flush, onCleanup } from "../core/signal.ts";
import { isSeeking } from "../core/player.ts";
import { ease as easings, type Ease } from "../core/ease.ts";
import { lerp } from "../core/interp.ts";
import { tween, waitFor, type Task } from "../core/thread.ts";
import { el, Node, type Child } from "./node.ts";
import { validateNode } from "./validate.ts";

export class View extends Node<HTMLDivElement> {
  /** Absolutely positioned layer above the content, for things in flight. */
  readonly overlay: Node<HTMLDivElement>;
  /** Where scene content goes; `add()` appends here. */
  readonly content: Node<HTMLDivElement>;
  /** SVG layer under the content, for connectors. */
  readonly edges: SVGSVGElement;
  /** Layout-dependent drawing to redo after each flush and on resize. */
  private readonly layoutHooks = new Set<() => void>();

  constructor(host: HTMLElement) {
    super(host as HTMLDivElement);
    host.classList.add("ps-view");
    this.content = el("div.ps-view-content");
    this.overlay = el("div.ps-overlay", { attrs: { "aria-hidden": "true" } });
    this.edges = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.edges.classList.add("ps-edges");
    this.edges.setAttribute("aria-hidden", "true");
    host.replaceChildren(this.edges, this.content.el, this.overlay.el);
    afterFlush(() => this.relayout());
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.relayout()).observe(host);
  }

  /**
   * Register drawing that depends on layout (it measures elements). It runs
   * after every flush and on resize, and is dropped when the scene resets.
   */
  onLayout(fn: () => void): void {
    this.layoutHooks.add(fn);
    onCleanup(() => this.layoutHooks.delete(fn));
  }

  private relayout(): void {
    // Without a layout box there is nothing meaningful to measure; the next
    // flush or resize after the view is laid out redraws.
    if (!this.layoutHooks.size || !this.el.isConnected || !this.el.getClientRects().length) return;
    for (const fn of this.layoutHooks) fn();
  }

  override add(...children: Child[]): this {
    this.content.add(...children);
    return this;
  }

  clear(): void {
    this.content.el.replaceChildren();
    this.overlay.el.replaceChildren();
    this.edges.replaceChildren();
    this.layoutHooks.clear();
  }

  /** `node`'s box in view coordinates. Flushes pending effects first. */
  rect(node: Node): DOMRect {
    flush();
    return this.measure(node);
  }

  /** `node`'s box in view coordinates, without flushing. */
  measure(node: Node): DOMRect {
    const v = this.el.getBoundingClientRect();
    const r = node.el.getBoundingClientRect();
    // CSS scale of the view (e.g. a zoomed embed). A view with no layout box
    // (display:none, detached, mid chapter swap) reports 0; treat it as unscaled
    // rather than dividing by zero.
    const scale = v.width / (this.el.offsetWidth || v.width || 1);
    const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return new DOMRect((r.left - v.left) / k, (r.top - v.top) / k, r.width / k, r.height / k);
  }
}

let currentView: View | null = null;

/** The view of the scene being built or played. */
export function useView(): View {
  if (!currentView) throw new Error("puppet-show: no active view");
  return currentView;
}

/** Set the active view when mounting a scene in a deck or custom shell. */
export function setView(view: View | null): void {
  currentView = view;
}

/* --------------------------------------------------------------------- fly */

export interface FlyOptions {
  duration?: number;
  ease?: Ease;
  /** Height of the arc in px; negative arcs downward. */
  arc?: number;
  /** Extra classes for the token, e.g. "ps-fly-aqua". */
  class?: string;
  /** Cross-fade the token into the destination during the final fifth. */
  land?: boolean;
}

/**
 * Send a small labelled token from one node to another, through the overlay.
 * The classic "this value goes there" explainer move.
 */
export function* fly(from: Node, to: Node, label: Child, options: FlyOptions = {}): Task {
  validateNode("fly(from, to)", "from", from);
  validateNode("fly(from, to)", "to", to);
  const { duration = 0.6, ease = easings.inOutCubic, arc = 24 } = options;
  if (isSeeking()) return yield* waitFor(duration);
  const view = useView();
  const a = center(view.rect(from));
  const opacity = to.opacity.peek();
  if (options.land) to.opacity(0);
  const token = el(`div.ps-fly${options.class ? "." + options.class.split(" ").join(".") : ""}`, { x: a.x, y: a.y, opacity: 0 }, el("span", label));
  view.overlay.add(token);
  try {
    yield* tween(duration, (t) => {
      // Both endpoints can move as collection slots open or layout reflows.
      flush();
      const a = center(view.measure(from));
      const b = center(view.measure(to));
      const e = ease(t);
      token.x(lerp(a.x, b.x, e));
      token.y(lerp(a.y, b.y, e) - arc * 4 * e * (1 - e));
      const landing = Math.max(0, (t - 0.8) / 0.2);
      token.opacity(options.land ? Math.min(1, t * 6) * (1 - landing) : Math.min(1, t * 6, (1 - t) * 6));
      if (options.land) to.opacity(opacity * landing);
    });
  } finally {
    if (options.land) to.opacity(opacity);
    token.remove();
  }
}

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/* -------------------------------------------------------------------- move */

/**
 * Move `node` into `parent` (before `before`, if given) and animate it from
 * where it was to where layout puts it. FLIP, as a task.
 */
export function* move(node: Node, parent: Node, duration = 0.5, ease: Ease = easings.inOutCubic, before?: Node): Task {
  validateNode("move(node, parent)", "node", node);
  validateNode("move(node, parent)", "parent", parent);
  if (before !== undefined) validateNode("move(node, parent)", "before", before);
  const place = () => parent.el.insertBefore(node.el, before?.el ?? null);
  if (isSeeking()) {
    place();
    return yield* waitFor(duration);
  }
  const view = useView();
  const a = view.rect(node);
  place();
  const b = view.rect(node);
  const x0 = node.x();
  const y0 = node.y();
  node.x(x0 + a.left - b.left);
  node.y(y0 + a.top - b.top);
  const dx = node.x();
  const dy = node.y();
  yield* tween(duration, (t) => {
    const e = ease(t);
    node.x(lerp(dx, x0, e));
    node.y(lerp(dy, y0, e));
  });
}
