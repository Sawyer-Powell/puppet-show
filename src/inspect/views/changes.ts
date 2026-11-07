export interface StateChange { path: string; text: string; structural: boolean; weight: number }
const show = (v: unknown): string => v === undefined ? "·" : typeof v === "number" ? String(Number(v.toFixed(3))) : typeof v === "string" ? v.slice(0, 30) : JSON.stringify(v)?.slice(0, 30) ?? "·";
/** Bounded diff of one stop against its same-breakpoint predecessor, never history. */
export function changes(before: unknown, after: unknown): StateChange[] {
  const result: StateChange[] = [];
  let visited = 0;
  function walk(a: unknown, b: unknown, path: string, depth: number): void {
    if (++visited > 2500 || depth > 9 || Object.is(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      const keyed = [...a, ...b].every(v => v && typeof v === "object" && "id" in v);
      if (keyed) {
        const old = new Map(a.map(v => [v.id, v])), next = new Map(b.map(v => [v.id, v]));
        const added = b.filter(v => !old.has(v.id)), removed = a.filter(v => !next.has(v.id));
        const noun = path.includes("threads") ? "thread" : path.split(".").at(-1) ?? "item";
        if (added.length) result.push({ path, text: `+${added.length} ${noun}${added[0].label ? ` (${added[0].label})` : ""}`, structural: true, weight: added.length });
        if (removed.length) result.push({ path, text: `−${removed.length} ${noun}`, structural: true, weight: removed.length });
        for (const [id, v] of next) if (old.has(id)) walk(old.get(id), v, `${path} #${id}`, depth + 1);
      } else {
        if (a.length !== b.length) result.push({ path, text: `${path} ${a.length} → ${b.length} items`, structural: true, weight: Math.abs(b.length - a.length) });
        for (let i = 0; i < Math.min(a.length, b.length, 40); i++) walk(a[i], b[i], `${path}.${i}`, depth + 1);
      }
    } else if (a && b && typeof a === "object" && typeof b === "object") {
      const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(aa), ...Object.keys(bb)])) {
        walk(Object.hasOwn(aa, key) ? aa[key] : undefined, Object.hasOwn(bb, key) ? bb[key] : undefined, path ? `${path}.${key}` : key, depth + 1);
      }
    } else {
      const structural = (a === undefined || b === undefined) && (typeof a === "object" || typeof b === "object");
      const label = path.replace(/\.value(?=\.|$)/g, "").replace(/^puppet-show\./, "");
      result.push({ path: label, text: `${label} ${show(a)} → ${show(b)}`, structural, weight: typeof a === "number" && typeof b === "number" ? Math.abs(b - a) : 0 });
    }
  }
  walk(before, after, "", 0);
  return result.sort((a, b) => Number(b.structural) - Number(a.structural) || b.weight - a.weight).slice(0, 6);
}
