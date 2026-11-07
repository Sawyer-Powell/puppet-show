/** Explicit temporal checkpoints, independent of frame rate and effect flushing. */
import { flush, onCleanup, type Signal } from "../core/signal.ts";
import type { Task } from "../core/thread.ts";
import { el, Node } from "../dom/node.ts";

export interface Point { readonly x: number; readonly y: number }

/** Pure sparkline geometry. Constant series sit on the middle line. */
export function samplePoints(values: readonly number[], width = 100, height = 32): readonly Point[] {
  if (values.some(v => !Number.isFinite(v))) throw new Error("puppet-show: history requires finite numbers");
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    throw new Error("puppet-show: invalid history dimensions");
  }
  const lo = Math.min(...values), hi = Math.max(...values);
  return values.map((value, i) => ({
    x: values.length === 1 ? width / 2 : i * width / (values.length - 1),
    y: hi === lo ? height / 2 : height * (1 - (value - lo) / (hi - lo)),
  }));
}

export interface Ghost extends Node {
  /** Replace the frozen copy with the source's current logical state. */
  capture(): Task;
  /** Remove the frozen copy, retaining its in-place anchor. */
  clear(): void;
}

/**
 * Freeze a faded, inert visual copy in the source's layout cell. Mount the
 * source first. A grid wrapper reserves its original place even if it moves.
 * Explicit flushing materializes reactive text/styles before cloning, including
 * during held-effect seeks; no viewport geometry or computed styles are read.
 * Styles inherited from ancestors remain inherited, not frozen computed values.
 */
export function ghost(source: Node): Ghost {
  const parent = source.el.parentNode;
  if (!parent) throw new Error("puppet-show: mount a node before creating its ghost");
  const anchor = el("div.ps-ghost-anchor", { style: { display: "grid" } });
  const node = el("div.ps-ghost", {
    opacity: 0.25,
    style: { gridArea: "1 / 1", pointerEvents: "none" },
    attrs: { "aria-hidden": "true", inert: true },
  }) as unknown as Ghost;
  const previousArea = source.el.style.gridArea;
  parent.insertBefore(anchor.el, source.el);
  anchor.add(node, source);
  source.el.style.gridArea = "1 / 1";
  function capture(): void {
    // cloneNode alone would otherwise copy stale DOM during fast-forward.
    flush();
    const copy = source.el.cloneNode(true) as HTMLElement;
    copy.style.gridArea = previousArea;
    for (const element of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
      element.removeAttribute("id");
      element.removeAttribute("autofocus");
    }
    node.replace(copy);
  }
  node.capture = function* (): Task { capture(); };
  node.clear = () => node.replace();
  onCleanup(() => {
    if (source.el.parentNode === anchor.el) {
      anchor.el.before(source.el);
      source.el.style.gridArea = previousArea;
    }
    anchor.remove();
  });
  capture();
  return node;
}

export interface Trail extends Node {
  /** Recorded logical transform offsets, not measured viewport positions. */
  readonly points: readonly Point[];
  capture(): Task;
  clear(): void;
}

/**
 * A standalone path of explicit x/y checkpoints. Add the returned node wherever
 * the path should be displayed. Coordinates are source transform offsets in px;
 * CSS layout motion and ancestor transforms are intentionally not sampled.
 */
export function trail(source: Node): Trail {
  const { node, line, dots, svg } = plot("ps-trail");
  const result = node as Trail;
  let points: Point[] = [];
  const draw = () => {
    drawPoints(line, dots, points);
    node.el.setAttribute("aria-label", points.length
      ? `Trail: ${points.map(p => `(${p.x}, ${p.y})`).join(" → ")}`
      : "Trail: empty");
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const left = Math.min(0, ...xs), top = Math.min(0, ...ys);
    svg.setAttribute("viewBox", `${left - 2} ${top - 2} ${Math.max(100, ...xs) - left + 4} ${Math.max(32, ...ys) - top + 4}`);
  };
  Object.defineProperty(result, "points", { get: () => points.map(p => ({ ...p })) });
  result.capture = function* (): Task {
    const point = { x: source.x(), y: source.y() };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("puppet-show: trail requires finite coordinates");
    points.push(point);
    draw();
  };
  result.clear = () => { points = []; draw(); };
  draw();
  return result;
}

export interface DeltaOptions<T> { format?: (value: T) => string }
export interface Delta<T> extends Node {
  readonly previous: T;
  readonly current: T;
  /** Compare the last checkpoint against the current source value. */
  capture(): Task;
  /** Reset the baseline to the current source and remove the arrow. */
  clear(): void;
}

export function delta(source: Node, options?: DeltaOptions<string>): Delta<string>;
export function delta<T>(source: Signal<T>, options?: DeltaOptions<T>): Delta<T>;
/** Explicit old → new display; Node sources read flushed text content. */
export function delta<T>(source: Signal<T> | Node, options: DeltaOptions<T | string> = {}): Delta<T | string> {
  const read = (): T | string => {
    if (!(source instanceof Node)) return source();
    flush();
    return source.el.textContent ?? "";
  };
  const format = options.format ?? String;
  const node = el("span.ps-delta") as Delta<T | string>;
  let current = read(), previous = current;
  Object.defineProperties(node, {
    previous: { get: () => previous },
    current: { get: () => current },
  });
  node.capture = function* (): Task {
    previous = current;
    current = read();
    node.replace(Object.is(previous, current) ? format(current) : `${format(previous)} → ${format(current)}`);
  };
  node.clear = () => { previous = current = read(); node.replace(format(current)); };
  node.clear();
  return node;
}

export interface History extends Node {
  readonly values: readonly number[];
  /** Append the source's current value. No implicit per-frame sampling. */
  capture(): Task;
  clear(): void;
}

/** A numeric sparkline of explicit checkpoints, including equal-valued ones. */
export function history(source: Signal<number>): History {
  const { node, line, dots } = plot("ps-history");
  const result = node as History;
  let values: number[] = [];
  Object.defineProperty(result, "values", { get: () => [...values] });
  result.capture = function* (): Task {
    const next = [...values, source()];
    const points = samplePoints(next);
    values = next;
    drawPoints(line, dots, points);
    node.el.setAttribute("aria-label", `History: ${values.join(", ")}`);
  };
  result.clear = () => { values = []; drawPoints(line, dots, []); node.el.setAttribute("aria-label", "History: empty"); };
  result.clear();
  return result;
}

function drawPoints(line: SVGPolylineElement, dots: SVGGElement, points: readonly Point[]): void {
  line.setAttribute("points", points.map(p => `${p.x},${p.y}`).join(" "));
  dots.replaceChildren(...points.map(point => {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(point.x));
    dot.setAttribute("cy", String(point.y));
    dot.setAttribute("r", "1.7");
    return dot;
  }));
}

function plot(className: string): { node: Node; svg: SVGSVGElement; line: SVGPolylineElement; dots: SVGGElement } {
  const node = el(`div.${className}`, { attrs: { role: "img" } });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 -2 100 36");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "48");
  svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "var(--ps-aqua)");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  const dots = document.createElementNS("http://www.w3.org/2000/svg", "g");
  dots.setAttribute("fill", "var(--ps-aqua)");
  svg.append(line, dots);
  node.add(svg);
  return { node, svg, line, dots };
}
