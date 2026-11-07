/**
 * Connectors: edges between two nodes that follow them as they move.
 *
 *   const e = connect(a, b, { shape: "elbow", draw: 0 });
 *   yield* e.draw(1, 0.5);              // draw the edge on
 *   yield* all(b.x(120, 1), e.color(palette.yellow, 0.3));  // it follows b
 *
 * Geometry is measured from the real layout after each flush, so edges stay
 * attached through CSS layout changes, transforms, `move()` and resizes.
 */

import { effect, signal, type Signal } from "../core/signal.ts";
import { palette } from "../ui/palette.ts";
import type { Node } from "./node.ts";
import { useView, type View } from "./view.ts";
import { validateNode } from "./validate.ts";

export type Side = "auto" | "top" | "right" | "bottom" | "left";

export interface ConnectOptions {
  /** Side of `from` to leave from. Default "auto" (facing the other node). */
  from?: Side;
  /** Side of `to` to arrive at. Default "auto". */
  to?: Side;
  /** Default "curve". */
  shape?: "straight" | "elbow" | "curve";
  /** Arrowhead at `to`. Default true. */
  arrow?: boolean;
  dashed?: boolean;
  /** Hex colour; default palette.bg4. Tween it with `edge.color(...)`. */
  color?: string;
  /** Drawn fraction 0..1. Start at 0 and tween to 1 to draw the edge on. */
  draw?: number;
  opacity?: number;
  /** Gap in px between the node box and the edge end. Default 4. */
  gap?: number;
}

const SVG = "http://www.w3.org/2000/svg";

export class Edge {
  /** Fraction of the edge drawn, 0..1. */
  readonly draw: Signal<number>;
  readonly opacity: Signal<number>;
  /** Stroke colour (hex), tweenable. */
  readonly color: Signal<string>;
  readonly el: SVGGElement;

  constructor(view: View, from: Node, to: Node, o: ConnectOptions) {
    validateNode("connect(from, to)", "from", from);
    validateNode("connect(from, to)", "to", to);
    this.draw = signal(o.draw ?? 1);
    this.opacity = signal(o.opacity ?? 1);
    this.color = signal(o.color ?? palette.bg4);
    const g = (this.el = document.createElementNS(SVG, "g"));
    const line = document.createElementNS(SVG, "path");
    const head = document.createElementNS(SVG, "path");
    if (!o.dashed) line.setAttribute("pathLength", "1");
    line.classList.add("ps-edge");
    head.classList.add("ps-edge-head");
    if (o.dashed) line.classList.add("ps-dashed");
    g.append(line);
    if (o.arrow ?? true) g.append(head);
    view.edges.append(g);

    effect(() => {
      const c = this.color();
      line.setAttribute("stroke", c);
      head.setAttribute("stroke", c);
    });
    effect(() => {
      const d = this.draw();
      const op = this.opacity();
      g.style.opacity = String(o.dashed ? op * Math.min(1, d * 2) : op);
      g.style.visibility = op <= 0.001 || d <= 0.001 ? "hidden" : "";
      if (!o.dashed) {
        line.setAttribute("stroke-dasharray", "1 1");
        line.setAttribute("stroke-dashoffset", String(1 - d));
      }
      head.style.opacity = d >= 0.98 ? "1" : "0";
    });

    view.onLayout(() => {
      const geo = geometry(view.measure(from), view.measure(to), o);
      line.setAttribute("d", geo.d);
      head.setAttribute("d", geo.head);
    });
  }

  remove(): void {
    this.el.remove();
  }
}

/** Connect two nodes with an edge in the current view. */
export const connect = (from: Node, to: Node, options: ConnectOptions = {}): Edge => {
  validateNode("connect(from, to)", "from", from);
  validateNode("connect(from, to)", "to", to);
  return new Edge(useView(), from, to, options);
};

/* ----------------------------------------------------------------- geometry */

type Pt = { x: number; y: number };
const NORMAL: Record<Exclude<Side, "auto">, Pt> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

function sides(a: DOMRect, b: DOMRect, o: ConnectOptions): [Exclude<Side, "auto">, Exclude<Side, "auto">] {
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const horizontal = Math.abs(dx) * 0.75 > Math.abs(dy);
  const autoFrom = horizontal ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
  const autoTo = horizontal ? (dx >= 0 ? "left" : "right") : dy >= 0 ? "top" : "bottom";
  const f = o.from && o.from !== "auto" ? o.from : autoFrom;
  const t = o.to && o.to !== "auto" ? o.to : autoTo;
  return [f, t];
}

function anchor(r: DOMRect, side: Exclude<Side, "auto">, gap: number): Pt {
  const n = NORMAL[side];
  return {
    x: r.left + r.width / 2 + n.x * (r.width / 2 + gap),
    y: r.top + r.height / 2 + n.y * (r.height / 2 + gap),
  };
}

const f = (v: number) => Math.round(v * 10) / 10;

export function geometry(a: DOMRect, b: DOMRect, o: ConnectOptions): { d: string; head: string } {
  const gap = o.gap ?? 4;
  const [sa, sb] = sides(a, b, o);
  const p = anchor(a, sa, gap);
  const q = anchor(b, sb, gap);
  const na = NORMAL[sa];
  const nb = NORMAL[sb];
  let d: string;
  const shape = o.shape ?? "curve";
  if (shape === "straight") d = `M${f(p.x)},${f(p.y)} L${f(q.x)},${f(q.y)}`;
  else if (shape === "elbow") {
    if (na.x !== 0) {
      const mx = nb.x !== 0 ? (p.x + q.x) / 2 : q.x;
      d = nb.x !== 0 ? `M${f(p.x)},${f(p.y)} H${f(mx)} V${f(q.y)} H${f(q.x)}` : `M${f(p.x)},${f(p.y)} H${f(mx)} V${f(q.y)}`;
    } else {
      const my = nb.y !== 0 ? (p.y + q.y) / 2 : q.y;
      d = nb.y !== 0 ? `M${f(p.x)},${f(p.y)} V${f(my)} H${f(q.x)} V${f(q.y)}` : `M${f(p.x)},${f(p.y)} V${f(my)} H${f(q.x)}`;
    }
  } else {
    const k = Math.max(24, Math.hypot(q.x - p.x, q.y - p.y) * 0.4);
    d = `M${f(p.x)},${f(p.y)} C${f(p.x + na.x * k)},${f(p.y + na.y * k)} ${f(q.x + nb.x * k)},${f(q.y + nb.y * k)} ${f(q.x)},${f(q.y)}`;
  }
  // Arrowhead points into the target side; straight lines point along the line.
  let dir = { x: -nb.x, y: -nb.y };
  if (shape === "straight") {
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    dir = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  }
  const s = 5;
  const back = { x: q.x - dir.x * s, y: q.y - dir.y * s };
  const perp = { x: -dir.y * s * 0.8, y: dir.x * s * 0.8 };
  const head = `M${f(back.x + perp.x)},${f(back.y + perp.y)} L${f(q.x)},${f(q.y)} L${f(back.x - perp.x)},${f(back.y - perp.y)}`;
  return { d, head };
}
