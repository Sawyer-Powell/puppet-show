import { test } from "node:test";
import assert from "node:assert/strict";
import { palette } from "../src/ui/palette.ts";
import { resolveTone, type Tone } from "../src/ui/tone.ts";

test("every hue accepts both token and exact palette value", () => {
  for (const [name, hex] of Object.entries(palette)) {
    assert.equal(resolveTone(name as Tone), `var(--ps-${name})`);
    assert.equal(resolveTone(hex), `var(--ps-${name})`);
  }
});

test("unknown hues report loudly and remain visible", () => {
  const original = console.error;
  const errors: string[] = [];
  console.error = (message) => errors.push(message);
  try {
    assert.equal(resolveTone("invisible" as Tone), "var(--ps-red)");
    assert.match(errors[0], /^puppet-show: unknown hue/);
  } finally { console.error = original; }
});
