import { all } from "../core/flow.ts";
import { ease } from "../core/ease.ts";
import { isSeeking } from "../core/player.ts";
import { flush, getOwner, Root, runWithOwner, signal, onCleanup, type Signal } from "../core/signal.ts";
import { tween, waitFor, type Task } from "../core/thread.ts";
import { el, Node } from "../dom/node.ts";
import { useView } from "../dom/view.ts";
import { reconcilePlan } from "./collection-plan.ts";
import "./collection.css";

export { reconcilePlan } from "./collection-plan.ts";
/** Per-transition timing and a replacement for the default entering fade. */
export interface CollectionSetOptions {
  duration?: number;
  /** The node is mounted and its slot is growing. Runs during seek too.
   * Longer hooks extend the transition; duration: 0 skips hooks. */
  enter?: (node: Node, key: string) => Task;
}
export interface CollectionOptions<T> {
  key: (item: T) => string;
  render: (item: Signal<T>, key: string) => Node;
  layout?: "row" | "column" | "wrap";
  gap?: string | number;
  /** Runs alongside FLIP, including seeking. Longer hooks extend play/seek. */
  update?: (node: Node, next: T, prev: T) => Task;
}
export interface Collection<T> extends Node {
  set(items: T[], options?: number | CollectionSetOptions): Task;
  node(key: string): Node | undefined;
}

/** Stable keyed nodes within a scene run, with collapsing exits and growing entries. */
export function collection<T>(options: CollectionOptions<T>): Collection<T> {
  const owner = getOwner();
  const host = el(`div.ps-collection.ps-collection-${options.layout ?? "column"}`, {
    style: { gap: options.gap ?? "var(--ps-collection-gap)" },
  }) as unknown as Collection<T>;
  const entries = new Map<string, { node: Node; item: Signal<T>; root: Root }>();
  let order: string[] = [];
  let busy = false;
  onCleanup(() => { for (const entry of entries.values()) entry.root.dispose(); });
  const remove = (key: string) => {
    const entry = entries.get(key)!;
    entry.node.remove();
    entry.root.dispose();
    entries.delete(key);
  };
  host.node = key => entries.get(key)?.node;
  host.set = function* (items, timing = 0.8): Task {
    const { duration = 0.8, enter } = typeof timing === "number" ? { duration: timing } : timing;
    if (!Number.isFinite(duration) || duration < 0) throw new Error("puppet-show: collection duration must be finite and nonnegative");
    if (busy) throw new Error("puppet-show: overlapping collection.set tasks");
    const keys = items.map(options.key);
    const plan = reconcilePlan(order, keys);
    const values = new Map(keys.map((key, i) => [key, items[i]]));
    const instant = duration === 0 || isSeeking();
    const cleanups: (() => void)[] = [];
    busy = true;
    try {
      // Wrap grows horizontally, like row; wrapping itself remains discrete.
      const horizontal = options.layout === "row" || options.layout === "wrap";
      const axis = horizontal ? "width" : "height";
      const gap = !instant ? parseFloat(getComputedStyle(host.el)[horizontal ? "columnGap" : "rowGap"]) || 0 : 0;
      if (!instant) {
        flush();
        const exits = plan.exit.map((key, i) => {
          const node = entries.get(key)!.node;
          const grow = opening(node, axis, gap && (plan.stay.length || i > 0) ? gap : 0);
          cleanups.push(grow.clear);
          return { node, grow };
        });
        yield* all(tween(duration * 0.2, t => {
          const p = 1 - ease.inOutCubic(t);
          for (const { node, grow } of exits) { grow.at(p); node.opacity(p); }
        }));
      } else if (duration > 0) yield* waitFor(duration * 0.2);
      const view = !instant ? useView() : null;
      if (!instant) flush();
      const before = new Map(plan.stay.map(key => [key, view?.measure(entries.get(key)!.node)]));
      for (const key of plan.exit) remove(key);
      const updates: Task[] = [];
      for (const key of plan.stay) {
        const entry = entries.get(key)!;
        const prev = entry.item.peek();
        const next = values.get(key)!;
        entry.item(() => next);
        if (duration > 0 && options.update) updates.push(runWithOwner(owner, () => options.update!(entry.node, next, prev)));
      }
      for (const key of plan.enter) {
        const root = new Root();
        const entry = runWithOwner(owner, () => root.run(() => {
          const item = signal<T>(values.get(key)!);
          return { node: options.render(item, key), item, root };
        }));
        entries.set(key, entry);
      }
      for (const key of plan.order) host.el.append(entries.get(key)!.node.el);
      order = plan.order;
      if (instant) {
        if (duration > 0) yield* all(waitFor(duration * 0.8), ...updates,
          ...plan.enter.flatMap(key => enter ? [runWithOwner(owner, () => enter(entries.get(key)!.node, key))] : []));
        return;
      }
      flush();
      // Measure natural sizes together, then collapse before yielding a frame.
      const openings = plan.enter.map((key, i) => {
        const node = entries.get(key)!.node;
        const grow = opening(node, axis, gap && (plan.stay.length || i > 0) ? gap : 0);
        cleanups.push(grow.clear);
        return { node, key, grow };
      });
      for (const { node, grow } of openings) { grow.at(0); if (!enter) node.opacity(0); }
      const targets = plan.stay.map(key => {
        const node = entries.get(key)!.node;
        return { node, a: before.get(key)!, b: view!.measure(node), x: node.x.peek(), y: node.y.peek() };
      });
      for (const { node, a, b, x, y } of targets) {
        node.x(x + a!.left - b.left);
        node.y(y + a!.top - b.top);
      }
      try {
        yield* all(tween(duration * 0.8, t => {
          const p = ease.inOutCubic(t);
          for (const { node, grow } of openings) { grow.at(p); if (!enter) node.opacity(p); }
        }), ...targets.flatMap(({ node, x, y }) => [node.x(x, duration * 0.8), node.y(y, duration * 0.8)]), ...updates,
        ...openings.flatMap(({ node, key }) => enter ? [runWithOwner(owner, () => enter(node, key))] : []));
      } finally {
        for (const { node, x, y } of targets) { node.x(x); node.y(y); }
      }
    } finally {
      if (!instant) flush();
      for (const clear of cleanups) clear();
      busy = false;
    }
  };
  return host;
}

/** Animate the actual layout box, not a scale transform (also works for subgrid).
 * Save only properties we own, preserving author inline styles on completion/cancel. */
function opening(node: Node, axis: "width" | "height", gap: number) {
  const style = node.el.style;
  const computed = getComputedStyle(node.el);
  const sides = axis === "height" ? ["top", "bottom"] : ["left", "right"];
  const margins = sides.map(side => `margin-${side}`);
  const edges = sides.flatMap(side => [`padding-${side}`, `border-${side}-width`]);
  const edgeSizes = edges.map(prop => parseFloat(computed.getPropertyValue(prop)) || 0);
  const resolved = parseFloat(computed.getPropertyValue(axis));
  const size = Number.isFinite(resolved)
    ? resolved + (computed.boxSizing === "border-box" ? 0 : edgeSizes.reduce((a, b) => a + b, 0))
    : axis === "height" ? node.el.offsetHeight : node.el.offsetWidth;
  const marginSizes = margins.map(prop => parseFloat(computed.getPropertyValue(prop)) || 0);
  const props = [axis, `min-${axis}`, "overflow", "box-sizing", "flex-shrink", ...margins, ...edges];
  const saved = props.map(prop => [prop, style.getPropertyValue(prop), style.getPropertyPriority(prop)]);
  return {
    at(p: number) {
      style.setProperty(`min-${axis}`, "0");
      style.setProperty("overflow", "clip");
      style.setProperty("box-sizing", "border-box");
      style.setProperty("flex-shrink", "0");
      style.setProperty(axis, `${size * p}px`);
      margins.forEach((prop, i) => style.setProperty(prop, `${marginSizes[i] * p - (i === 1 ? gap * (1 - p) : 0)}px`));
      edges.forEach((prop, i) => style.setProperty(prop, `${edgeSizes[i] * p}px`));
    },
    clear() {
      for (const [prop, value, priority] of saved) {
        if (value) style.setProperty(prop, value, priority);
        else style.removeProperty(prop);
      }
      if (!style.length) node.el.removeAttribute("style");
    },
  };
}
