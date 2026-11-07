import { test } from "node:test";
import assert from "node:assert/strict";
import { textUnits } from "../src/blocks/text.ts";

test("text splitting preserves spaces, newlines and Unicode graphemes", () => {
  const text = "  One two\nthree 👩‍💻 é";
  for (const split of ["words", "characters", "lines"] as const) {
    assert.equal(textUnits(text, split).join(""), text);
  }
  assert.deepEqual(textUnits("👩‍💻é", "characters"), ["👩‍💻", "é"]);
  assert.deepEqual(textUnits("one\ntwo", "lines"), ["one", "\n", "two"]);
  assert.deepEqual(textUnits(""), []);
});
