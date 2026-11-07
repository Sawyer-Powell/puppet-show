import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { primitives, roles, scales, tokens, textRoles, surfaces, emphasis } from "../src/ui/tokens.ts";
import { palette } from "../src/ui/palette.ts";

const css = readFileSync(new URL("../src/ui/puppet-show.css", import.meta.url), "utf8");
const foundation = css.slice(css.indexOf(":root, .ps-deck {"), css.indexOf("@media (prefers-reduced-motion"));
const declarations = Object.fromEntries([...foundation.matchAll(/--ps-([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2]]));

function resolve(name: string): string {
  const value = declarations[name];
  assert.ok(value, `missing token ${name}`);
  const reference = /^var\(--ps-([\w-]+)\)$/.exec(value);
  return reference ? resolve(reference[1]) : value;
}
function luminance(hex: string): number {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const [r, g, b] = hex.slice(1).match(/../g)!.map(x => parseInt(x, 16) / 255)
    .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [lo, hi] = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (hi + 0.05) / (lo + 0.05);
}
function passes(text: string, surface: string, threshold: number): void {
  const ratio = contrast(resolve(text), resolve(surface));
  assert.ok(ratio >= threshold, `${text} on ${surface}: ${ratio.toFixed(3)} < ${threshold}`);
}

test("static CSS foundations exactly mirror canonical tokens and public palette", () => {
  assert.deepEqual(declarations, tokens);
  for (const [name, value] of Object.entries(palette)) assert.equal(resolve(name), value);
  for (const value of Object.values(tokens)) {
    for (const match of value.matchAll(/var\(--ps-([\w-]+)\)/g)) assert.ok(match[1] in tokens, match[1]);
  }
});

test("all allowed text / surface contracts meet WCAG AA, without rounding", () => {
  for (const text of textRoles) for (const surface of surfaces) passes(text, surface, 4.5);
  for (const accent of ["accent", "state-hot", "state-live", "state-bad", "state-ok", "text-strong"]) passes("on-accent", accent, 4.5);
});

test("emphasis.dim keeps every text role AA on the surfaces de-emphasised content sits on", () => {
  const rgb = (hex: string) => hex.slice(1).match(/../g)!.map(x => parseInt(x, 16));
  const mix = (fg: string, bg: string, a: number) =>
    "#" + rgb(fg).map((v, i) => Math.round(v * a + rgb(bg)[i] * (1 - a)).toString(16).padStart(2, "0")).join("");
  // Code panels and readouts sit on base/raised/sunken; selected rows are never dimmed.
  for (const surface of ["surface-base", "surface-raised", "surface-sunken"]) {
    for (const text of textRoles) {
      const bg = resolve(surface), ratio = contrast(mix(resolve(text), bg, emphasis.dim), bg);
      assert.ok(ratio >= 4.5, `${text} at opacity ${emphasis.dim} on ${surface}: ${ratio.toFixed(3)} < 4.5`);
    }
  }
});

test("meaningful borders and focus contrast meet 3:1 on all surfaces", () => {
  for (const role of ["border-default", "border-strong", "border-focus"]) {
    for (const surface of surfaces) passes(role, surface, 3);
  }
});

test("components consume semantic tokens, not primitive colors or raw reusable styles", () => {
  const components = css.slice(css.indexOf("@layer puppet-show.components {"));
  const files = [components, ...["collection", "sequence"].map(name => readFileSync(new URL(`../src/ui/${name}.css`, import.meta.url), "utf8"))];
  for (const source of files) {
    for (const name of Object.keys(primitives)) assert.ok(!source.includes(`var(--ps-${name})`), `primitive ${name} in components`);
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|!important|\d+(?:\.\d+)?m?s\b/);
    // Breakpoints and one-off viewport/diagram geometry are explicitly exempt.
    assert.doesNotMatch(source, /(?<![\w.-])(?:1|2|3|4|5|6|7|8|10|12|14|16|18|20|22|26|30)px\b/);
  }
  assert.ok(Object.keys(roles).length > 20);
  assert.ok(Object.keys(scales).length > 20);
});

test("layers put content states before controls; all CSS motion uses overridable durations", () => {
  assert.match(css, /@layer puppet-show.reset, puppet-show.tokens, puppet-show.base, puppet-show.states, puppet-show.components, puppet-show.utilities;/);
  assert.doesNotMatch(css, /:not\(button|font-display: block/);
  // The ordinary meter-button margin must not beat the adjacent replay gap.
  assert.match(css, /:where\(\.ps-meter\) \.ps-btn\s*\{/);
  assert.match(css, /font-display: swap/);
  for (const duration of ["fast", "base", "slow"]) {
    assert.match(css, new RegExp(`--ps-duration-${duration}: 0\\.01ms`));
  }
  const componentCss = css.slice(css.indexOf("@layer puppet-show.components {"));
  for (const declaration of componentCss.matchAll(/(?:animation|transition):([^;]+);/g)) {
    assert.ok(declaration[1].trim() === "none" || declaration[1].includes("var(--ps-duration-"), declaration[0]);
  }
});
