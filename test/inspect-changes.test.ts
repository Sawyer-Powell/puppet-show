import { test } from "node:test";
import assert from "node:assert/strict";
import { changes } from "../src/inspect/views/changes.ts";

test("state diff ranks keyed structure before scalars and uses readable collector paths", () => {
  const before = { x: { ok: true, value: 90 }, "puppet-show": { ok: true, value: { threads: { children: [{ id: 1, label: "tween x", time: .4 }] } } } };
  const after = { x: { ok: true, value: 100 }, "puppet-show": { ok: true, value: { threads: { children: [{ id: 1, label: "tween x", time: .5 }, { id: 2, label: "tween opacity", time: 0 }] } } } };
  const saved = JSON.stringify([before, after]);
  const result = changes(before, after);
  assert.equal(result[0].structural, true);
  assert.match(result[0].text, /\+1 thread \(tween opacity\)/);
  assert.ok(result.some(change => change.text === "x 90 → 100"));
  assert.equal(JSON.stringify([before, after]), saved);
});
test("generic state fields are not suppressed by runtime metadata names", () => {
  const result = changes({ frames: 1, version: 1, ok: false, caption: "old" }, { frames: 2, version: 2, ok: true, caption: "new" });
  for (const path of ["frames", "version", "ok", "caption"]) assert.ok(result.some(change => change.path === path));
});
test("diff is bounded and identical states have no changes", () => {
  assert.deepEqual(changes({ x: 1 }, { x: 1 }), []);
  const before = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`v${i}`, 0]));
  const after = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`v${i}`, i + 1]));
  assert.equal(changes(before, after).length, 6);
  assert.equal(changes(before, after)[0].path, "v99");
});
