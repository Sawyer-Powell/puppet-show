import { palette, type Hue } from "./palette.ts";

export type { Hue } from "./palette.ts";
/** A palette token name or its exact hex value. */
export type Tone = Hue | (typeof palette)[Hue];

/** Resolve both public colour forms to a theme-aware CSS variable. */
export function resolveTone(tone: Tone): string {
  const name = Object.prototype.hasOwnProperty.call(palette, tone)
    ? tone as Hue
    : (Object.keys(palette) as Hue[]).find((key) => palette[key] === tone);
  if (name) return `var(--ps-${name})`;
  console.error(`puppet-show: unknown hue ${JSON.stringify(tone)}`);
  return "var(--ps-red)";
}
