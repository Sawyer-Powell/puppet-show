import { test } from "node:test";
import assert from "node:assert/strict";
import { samplePoints } from "../src/blocks/temporal.ts";

test("history checkpoints map extrema and retain ordering", () => {
  assert.deepEqual(samplePoints([10, 30, 20], 100, 40), [
    { x: 0, y: 40 }, { x: 50, y: 0 }, { x: 100, y: 20 },
  ]);
});

test("empty, singleton, and constant histories have finite geometry", () => {
  assert.deepEqual(samplePoints([]), []);
  assert.deepEqual(samplePoints([7]), [{ x: 50, y: 16 }]);
  assert.deepEqual(samplePoints([7, 7]), [{ x: 0, y: 16 }, { x: 100, y: 16 }]);
  assert.deepEqual(samplePoints([-5, 0, 5], 0, 0), [
    { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
  ]);
});

test("history geometry is pure and preserves duplicate checkpoints", () => {
  const input = Object.freeze([2, 2, 4]);
  const first = samplePoints(input);
  assert.equal(first.length, input.length);
  assert.deepEqual(first, samplePoints(input));
  assert.deepEqual(input, [2, 2, 4]);
});

test("invalid samples and dimensions fail instead of generating invalid SVG", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => samplePoints([value]), /finite numbers/);
  }
  for (const value of [-1, NaN, Infinity]) {
    assert.throws(() => samplePoints([1], value), /dimensions/);
    assert.throws(() => samplePoints([1], 100, value), /dimensions/);
  }
});
