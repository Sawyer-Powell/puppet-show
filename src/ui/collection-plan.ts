/** Pure keyed reconciliation plan; no DOM or animation dependencies. */
export interface ReconcilePlan {
  /** Removed keys, in previous order. */
  exit: string[];
  /** Retained keys, in destination order. */
  stay: string[];
  /** Retained keys to patch, in destination order. */
  update: string[];
  /** Retained keys whose index changes. */
  move: { key: string; from: number; to: number }[];
  /** New keys, in destination order. */
  enter: string[];
  /** Complete destination order. */
  order: string[];
}

export function reconcilePlan(previous: readonly string[], next: readonly string[]): ReconcilePlan {
  const unique = (keys: readonly string[]) => {
    const seen = new Set<string>();
    for (const key of keys) {
      if (typeof key !== "string" || !key.length) throw new Error("puppet-show: collection keys must be nonempty strings");
      if (seen.has(key)) throw new Error(`puppet-show: duplicate collection key ${JSON.stringify(key)}`);
      seen.add(key);
    }
    return seen;
  };
  const old = unique(previous);
  const incoming = unique(next);
  const indices = new Map(previous.map((key, index) => [key, index]));
  return {
    exit: previous.filter(key => !incoming.has(key)),
    stay: next.filter(key => old.has(key)),
    update: next.filter(key => old.has(key)),
    move: next.flatMap((key, to) => {
      const from = indices.get(key);
      return from !== undefined && from !== to ? [{ key, from, to }] : [];
    }),
    enter: next.filter(key => !old.has(key)),
    order: [...next],
  };
}
