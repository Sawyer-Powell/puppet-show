/** Downward-time host messages with layout-aware, replayable connectors. */
import { effect } from "../core/signal.ts";
import { connect, type Edge } from "../dom/connect.ts";
import { el, type Child, type Node } from "../dom/node.ts";
import { palette, semantic, type Hue } from "./palette.ts";
import { resolveTone, type Tone } from "./tone.ts";
import "./sequence.css";

export interface SeqDiagramOptions {
  hosts: { id: string; label: Child }[];
  /** Number of reserved time intervals; endpoints range from 0 through rows. */
  rows: number;
}

export interface MessageOptions {
  /** Start row, from 0 through rows - 1. Arrival is at the next row. */
  at: number;
  lost?: boolean;
  tone?: Tone;
  draw?: number;
}

export interface SeqDiagram extends Node {
  message(from: string, to: string, label: Child, options: MessageOptions): Edge;
}

/** Reserve all hosts and rows before narrating. Messages follow layout/resizes. */
export function seqDiagram({ hosts, rows }: SeqDiagramOptions): SeqDiagram {
  if (!Number.isInteger(rows) || rows < 1) throw new Error("puppet-show: sequence rows must be a positive integer");
  if (!hosts.length) throw new Error("puppet-show: sequence needs at least one host");
  const indices = new Map<string, number>();
  hosts.forEach((host, i) => {
    if (!host.id || indices.has(host.id)) throw new Error(`puppet-show: duplicate or empty sequence host ${JSON.stringify(host.id)}`);
    indices.set(host.id, i);
  });
  const x = (i: number) => (i + 0.5) / hosts.length * 100;
  const body = el("div.ps-seq-body", { style: { height: `calc(${rows} * var(--ps-sequence-row-height))` } },
    hosts.map((_, i) => el("div.ps-seq-lifeline", { style: { left: `${x(i)}%` } })),
    Array.from({ length: rows + 1 }, (_, i) => el("div.ps-seq-row", { style: { top: `${i / rows * 100}%` } })),
  );
  const root = el("div.ps-seq", el("div.ps-seq-hosts", {
    style: { gridTemplateColumns: `repeat(${hosts.length}, minmax(0, 1fr))` },
  }, hosts.map((host) => el("div.ps-seq-host", host.label))), body);
  const anchor = (left: number, row: number) => {
    const node = el("span.ps-seq-anchor", { style: { left: `${left}%`, top: `${row / rows * 100}%` } });
    body.add(node);
    return node;
  };
  return Object.assign(root, {
    message(from: string, to: string, label: Child, options: MessageOptions): Edge {
      const a = indices.get(from), b = indices.get(to);
      if (a === undefined || b === undefined) throw new Error(`puppet-show: unknown sequence host ${JSON.stringify(a === undefined ? from : to)}`);
      if (!Number.isInteger(options.at) || options.at < 0 || options.at >= rows) {
        throw new Error(`puppet-show: sequence row ${options.at} outside 0..${rows - 1}`);
      }
      if (a === b) throw new Error("puppet-show: sequence self-messages are not supported");
      const tone = options.tone ?? "aqua";
      // Validate using the shared contract, but use a hex start for colour tweens.
      resolveTone(tone);
      const name = (Object.keys(palette) as Hue[]).find((key) => key === tone || palette[key] === tone);
      const color = options.lost ? semantic["state-bad"] : name ? palette[name] : semantic["state-bad"];
      const startX = x(a), endX = options.lost ? (x(a) + x(b)) / 2 : x(b);
      const endRow = options.at + (options.lost ? 0.5 : 1);
      const start = anchor(startX, options.at), end = anchor(endX, endRow);
      const edge = connect(start, end, {
        shape: "straight", gap: 0, arrow: !options.lost, color, draw: options.draw,
      });
      edge.el.classList.add("ps-seq-edge");
      if (options.lost) edge.el.classList.add("ps-bad");
      const caption = el(`div.ps-seq-label${options.lost ? ".ps-bad" : ""}`, { style: {
        left: `${(startX + endX) / 2}%`,
        top: `${(options.at + endRow) / 2 / rows * 100}%`,
        maxWidth: `${Math.max(100 / hosts.length, Math.abs(endX - startX))}%`,
      } }, label);
      const cross = options.lost ? el("span.ps-seq-lost.ps-bad", {
        style: { left: `${endX}%`, top: `${endRow / rows * 100}%` },
        attrs: { "aria-label": "lost" },
      }, "×") : null;
      body.add(caption, cross);
      effect(() => {
        // Keep hex signal values for interpolation, but render exact palette
        // colours through their theme tokens (including palette hex inputs).
        const color = edge.color();
        const token = (Object.keys(palette) as Hue[]).find((key) => palette[key] === color);
        const role = (Object.keys(semantic) as (keyof typeof semantic)[]).find((key) => semantic[key] === color);
        const cssColor = token ? resolveTone(token) : role ? `var(--ps-${role})` : color;
        edge.el.style.setProperty("--ps-seq-color", cssColor);
        caption.el.style.color = cssColor;
        const visible = edge.draw() > 0.001;
        caption.el.style.opacity = String(visible ? edge.opacity() : 0);
        if (cross) cross.el.style.opacity = String(edge.draw() >= 0.98 ? edge.opacity() : 0);
      });
      const remove = edge.remove.bind(edge);
      edge.remove = () => { remove(); start.remove(); end.remove(); caption.remove(); cross?.remove(); };
      return edge;
    },
  });
}
