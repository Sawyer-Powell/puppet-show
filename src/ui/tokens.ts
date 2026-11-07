/** Canonical foundations. puppet-show.css mirrors these declarations; tokens.test.ts
 * checks every declaration so the static, single-file CSS build cannot drift. */
export const primitives = {
  bg: "#1d2021", bg1: "#282828", bg2: "#3c3836", bg3: "#504945", bg4: "#665c54",
  gray: "#928374", fg: "#ebdbb2", fg0: "#fbf1c7", fg2: "#d5c4a1", fg3: "#bdae93", fg4: "#a89984",
  red: "#fb4934", green: "#b8bb26", yellow: "#fabd2f", blue: "#83a598", purple: "#d3869b", aqua: "#8ec07c", orange: "#fe8019",
  // Accessible variants: the original gruvbox primitives remain public.
  "neutral-aa": "#afa08a", "red-aa": "#ff806c", "blue-aa": "#8aaea0", "purple-aa": "#dc91a6",
} as const;

export const roles = {
  "text-strong": "var(--ps-fg0)", "text-default": "var(--ps-fg2)",
  "text-muted": "var(--ps-fg3)", "text-subtle": "var(--ps-neutral-aa)",
  "surface-base": "var(--ps-bg)", "surface-raised": "var(--ps-bg1)",
  "surface-sunken": "var(--ps-bg)", "surface-selected": "var(--ps-bg2)",
  "border-default": "var(--ps-gray)", "border-strong": "var(--ps-fg4)",
  "border-focus": "var(--ps-yellow)", "border-decoration": "var(--ps-bg2)",
  "accent": "var(--ps-yellow)", "on-accent": "var(--ps-bg)",
  "state-hot": "var(--ps-yellow)", "state-live": "var(--ps-aqua)",
  "state-dim": "var(--ps-neutral-aa)", "state-bad": "var(--ps-red-aa)", "state-ok": "var(--ps-green)",
  "lane-blue": "var(--ps-blue-aa)", "lane-purple": "var(--ps-purple-aa)",
  "prompt": "var(--ps-orange)", "value": "var(--ps-aqua)",
  // Legacy semantic names remain supported. Primitive names are unchanged.
  "line": "var(--ps-border-decoration)", "frame": "var(--ps-border-default)",
  "muted": "var(--ps-text-subtle)", "text": "var(--ps-text-default)", "strong": "var(--ps-text-strong)",
} as const;

export const scales = {
  "font": '"puppet-show mono", ui-monospace, "SF Mono", Menlo, monospace',
  "size": "13px", "size-s": "11px", "size-l": "15px", "size-code": "12.5px",
  "radius": "3px", "radius-s": "1px",
  "border-width": "1px", "border-width-strong": "2px", "border-width-accent": "3px",
  "space-1": "1px", "space-2": "2px", "space-3": "3px", "space-4": "4px", "space-5": "5px",
  "space-6": "6px", "space-7": "7px", "space-8": "8px", "space-10": "10px", "space-12": "12px",
  "space-14": "14px", "space-16": "16px", "space-18": "18px", "space-20": "20px", "space-22": "22px",
  "space-26": "26px", "space-30": "30px",
  "duration-fast": "0.15s", "duration-base": "0.9s", "duration-slow": "1.1s",
  "ease": "cubic-bezier(0.2, 0.7, 0.2, 1)",
  "z-edge": "0", "z-content": "1", "z-tooltip": "3", "z-overlay": "10",
  "focus-ring": "var(--ps-border-width) solid var(--ps-border-focus)", "focus-offset": "2px",
  "shadow-float": "0 2px 10px #0008",
  "opacity-dim": "0.84",
  "sequence-row-height": "64px",
  "table-cell-padding": "0.35em 0.6em", "table-cell-padding-compact": "0.3em 0.4em",
  "collection-gap": "0.5em",
} as const;

export const tokens = { ...primitives, ...roles, ...scales } as const;

/**
 * Emphasis opacities for de-emphasised content that must stay readable
 * (e.g. code.focus() context lines). `dim` is the lowest opacity at which every
 * text role still meets AA on every standard surface; tokens.test.ts enforces it.
 */
export const emphasis = { dim: Number(scales["opacity-dim"]) } as const;

/** Resolve a token to its final value (follows var(--ps-*) aliases). */
export function resolveToken(name: keyof typeof tokens): string {
  let value: string = tokens[name];
  for (let m; (m = /^var\(--ps-([\w-]+)\)$/.exec(value)); ) value = tokens[m[1] as keyof typeof tokens];
  return value;
}

/** Allowed text contracts: these roles can be used on any standard surface.
 * Raw palette hues are drawing/tween primitives, not general text roles. */
export const textRoles = ["text-strong", "text-default", "text-muted", "text-subtle", "accent", "state-hot", "state-live", "state-dim", "state-bad", "state-ok", "lane-blue", "lane-purple", "prompt", "value"] as const;
export const surfaces = ["surface-base", "surface-raised", "surface-sunken", "surface-selected"] as const;
