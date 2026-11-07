/** Interpolators blend two values by eased progress `t` in [0, 1]. */
export type Interpolator<T> = (from: T, to: T, t: number) => T;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/* -------------------------------------------------------------------- colour */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function parseHex(hex: string): [number, number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

const toHex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");

/** Blend two hex colours in linear-light RGB, which avoids muddy midpoints. */
export const color: Interpolator<string> = (from, to, t) => {
  const a = parseHex(from);
  const b = parseHex(to);
  const lin = (c: number) => (c / 255) ** 2.2;
  const gam = (c: number) => 255 * c ** (1 / 2.2);
  const rgb = [0, 1, 2].map((i) => toHex(gam(lerp(lin(a[i]), lin(b[i]), t))));
  const alpha = lerp(a[3], b[3], t);
  return `#${rgb.join("")}${alpha < 1 ? toHex(alpha * 255) : ""}`;
};

/* ---------------------------------------------------------------------- text */

/**
 * Retype text like a terminal: erase back to the common prefix, then type the
 * rest. Each erased or typed character takes an equal share of the tween.
 */
export const retype: Interpolator<string> = (from, to, t) => {
  let p = 0;
  while (p < from.length && p < to.length && from[p] === to[p]) p++;
  const erase = from.length - p;
  const type = to.length - p;
  const ops = Math.round(t * (erase + type));
  if (ops <= erase) return from.slice(0, from.length - ops);
  return to.slice(0, p + ops - erase);
};

/** Counts characters revealed, for typing markup without breaking tags. */
export const typed = (text: string, t: number): string => text.slice(0, Math.round(text.length * t));

/* ------------------------------------------------------------------- dispatch */

/** Pick an interpolator from the start value (and the target, if known). */
export function interpolatorFor<T>(sample: T, target?: T): Interpolator<T> {
  if (typeof sample === "number") return lerp as unknown as Interpolator<T>;
  if (typeof sample === "string") {
    if (HEX.test(sample) && (target === undefined || HEX.test(String(target)))) return color as unknown as Interpolator<T>;
    if (HEX.test(String(target ?? "")) && !HEX.test(sample)) {
      console.warn(`puppet-show: tweening "${sample}" → ${target} retypes instead of blending; start from a hex colour (e.g. palette.*)`);
    }
    return retype as unknown as Interpolator<T>;
  }
  if (Array.isArray(sample) && sample.every((v) => typeof v === "number")) {
    return ((a: number[], b: number[], t: number) => a.map((v, i) => lerp(v, b[i] ?? v, t))) as unknown as Interpolator<T>;
  }
  // Anything else switches at the midpoint.
  return ((a: T, b: T, t: number) => (t < 0.5 ? a : b)) as Interpolator<T>;
}
