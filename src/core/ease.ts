/** Easing functions map linear progress in [0, 1] to eased progress. */
export type Ease = (t: number) => number;

const pow = (p: number) => ({
  in: (t: number) => t ** p,
  out: (t: number) => 1 - (1 - t) ** p,
  inOut: (t: number) => (t < 0.5 ? 2 ** (p - 1) * t ** p : 1 - (-2 * t + 2) ** p / 2),
});

const cubic = pow(3);
const quart = pow(4);
const quad = pow(2);

/** A cubic-bezier easing, as in CSS `cubic-bezier(x1, y1, x2, y2)`. */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const a = (p1: number, p2: number) => 1 - 3 * p2 + 3 * p1;
  const b = (p1: number, p2: number) => 3 * p2 - 6 * p1;
  const c = (p1: number) => 3 * p1;
  const at = (t: number, p1: number, p2: number) => ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;
  const slope = (t: number, p1: number, p2: number) => 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);
  return (x) => {
    if (x <= 0 || x >= 1) return x;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const s = slope(t, x1, x2);
      if (Math.abs(s) < 1e-6) break;
      t -= (at(t, x1, x2) - x) / s;
    }
    return at(t, y1, y2);
  };
}

export const ease = {
  linear: (t: number) => t,
  inQuad: quad.in,
  outQuad: quad.out,
  inOutQuad: quad.inOut,
  inCubic: cubic.in,
  outCubic: cubic.out,
  inOutCubic: cubic.inOut,
  inQuart: quart.in,
  outQuart: quart.out,
  inOutQuart: quart.inOut,
  outBack: (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  /** Snappy settle used for most UI motion. */
  snap: bezier(0.2, 0.7, 0.2, 1),
  /** Discrete steps, like a terminal redraw. */
  steps: (n: number): Ease => (t) => Math.min(1, Math.floor(t * n) / (n - 1 || 1)),
} satisfies Record<string, Ease | ((n: number) => Ease)>;
