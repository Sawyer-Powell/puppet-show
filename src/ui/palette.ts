/** Public drawing/tween primitives. For text and surfaces use semantic CSS roles. */
import { primitives, resolveToken, textRoles } from "./tokens.ts";

/** Existing keys and gruvbox values are retained for source compatibility. */
export const palette = {
  bg: primitives.bg, bg1: primitives.bg1, bg2: primitives.bg2, bg3: primitives.bg3, bg4: primitives.bg4,
  gray: primitives.gray, fg: primitives.fg, fg0: primitives.fg0, fg2: primitives.fg2, fg3: primitives.fg3, fg4: primitives.fg4,
  red: primitives.red, green: primitives.green, yellow: primitives.yellow, blue: primitives.blue,
  purple: primitives.purple, aqua: primitives.aqua, orange: primitives.orange,
} as const;

export type Hue = keyof typeof palette;

/**
 * Semantic text/state roles resolved to hex, for colour tweens in scenes
 * (tweens need a hex start value). Prefer these over raw palette hues for
 * anything a learner reads: they meet AA on every standard surface.
 *   node.css("color", semantic["text-subtle"]); node.css("color")(semantic["state-bad"], 0.3);
 */
export const semantic = Object.fromEntries(textRoles.map((r) => [r, resolveToken(r)])) as Record<(typeof textRoles)[number], string>;
