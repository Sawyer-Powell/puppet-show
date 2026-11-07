import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcilePlan } from "../src/ui/collection-plan.ts";

test("empty collection and first insertion", () => {
  assert.deepEqual(reconcilePlan([], []), { exit: [], stay: [], update: [], move: [], enter: [], order: [] });
  assert.deepEqual(reconcilePlan([], ["A", "B"]).enter, ["A", "B"]);
});

test("patch, exit, enter and moves are ordered by key", () => {
  assert.deepEqual(reconcilePlan(["A", "B", "C"], ["B", "D", "A"]), {
    exit: ["C"], stay: ["B", "A"], update: ["B", "A"], enter: ["D"],
    move: [{ key: "B", from: 1, to: 0 }, { key: "A", from: 0, to: 2 }],
    order: ["B", "D", "A"],
  });
});

test("unchanged keys are patched but not moved; remove all", () => {
  const keys = ["A", "B"];
  const plan = reconcilePlan(keys, keys);
  assert.deepEqual(plan.update, keys);
  assert.deepEqual(plan.move, []);
  assert.notEqual(plan.order, keys);
  assert.deepEqual(reconcilePlan(keys, []).exit, keys);
  assert.deepEqual(keys, ["A", "B"]);
});

test("duplicates and invalid keys fail loudly on either side", () => {
  assert.throws(() => reconcilePlan(["A", "A"], []), /duplicate collection key/);
  assert.throws(() => reconcilePlan([], ["A", "A"]), /duplicate collection key/);
  assert.throws(() => reconcilePlan([], [""]), /nonempty strings/);
  assert.throws(() => reconcilePlan([], [1 as unknown as string]), /nonempty strings/);
  assert.deepEqual(reconcilePlan(["__proto__"], ["constructor"]).enter, ["constructor"]);
});
