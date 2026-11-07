/** Optional composition surfaces and orientation controls. */
import { signal, type Signal } from "../core/signal.ts";
import { type Task } from "../core/thread.ts";
import { el, type Child, type Node } from "../dom/node.ts";

export interface Region extends Node {
  collapsed: Signal<boolean>;
  fill(...children: Child[]): void;
  clear(): void;
  collapse(value?: boolean): void;
  retire(duration?: number): Task;
}
/** A named surface. Collapsing releases its layout space; filling restores it. */
export function region(name: string): Region {
  const collapsed = signal(false);
  const node = el("section.ps-region", { attrs: { "data-region": name, "aria-label": name, hidden: collapsed } }) as Region;
  node.collapsed = collapsed;
  node.fill = (...children) => { node.replace(...children); collapsed(false); node.opacity(1); };
  node.clear = () => { node.replace(); };
  node.collapse = (value = true) => collapsed(value);
  node.retire = function* (duration = 0.3): Task { yield* node.opacity(0, duration); collapsed(true); };
  return node;
}

export interface Stages extends Node {
  areas: readonly Node[];
  at(index: number): Node;
}
/** Independent surfaces in one scene; drive all of them with shared signals/tasks. */
export function stages(count: number): Stages {
  if (!Number.isInteger(count) || count < 1) throw new Error("puppet-show: stages count must be a positive integer");
  const areas = Array.from({ length: count }, (_, i) => el("div.ps-substage", { attrs: { "data-stage": i } }));
  const node = el("div.ps-stages", areas) as unknown as Stages;
  node.areas = areas;
  node.at = index => {
    if (!areas[index]) throw new Error(`puppet-show: stage ${index} out of range`);
    return areas[index];
  };
  return node;
}

export interface CompareOptions { left: Child; right: Child; vary?: Child }
/** A two-surface shorthand; vary is an optional label, not a runtime parameter. */
export function compare(options: CompareOptions): Stages {
  const node = stages(2);
  node.at(0).add(options.left);
  node.at(1).add(options.right);
  if (options.vary !== undefined) node.add(el("div.ps-compare-vary", options.vary));
  return node;
}

export interface MapPart { id: string; label: string }
export interface Minimap extends Node { active: Signal<string> }
/** Compact system map; active can be shared with any other scene control. */
export function minimap(parts: readonly MapPart[], active: Signal<string> = signal(parts[0]?.id ?? "")): Minimap {
  if (new Set(parts.map(part => part.id)).size !== parts.length) throw new Error("puppet-show: minimap ids must be unique");
  const node = el("nav.ps-minimap", { attrs: { "aria-label": "system map" } }, parts.map(part =>
    el("span.ps-chip", { class: () => active() === part.id ? "ps-hot" : "ps-dim",
      attrs: { "aria-current": () => active() === part.id ? "location" : null } }, part.label))) as Minimap;
  node.active = active;
  return node;
}
