import { test } from "node:test";
import assert from "node:assert/strict";
import { Root, signal } from "../src/core/signal.ts";
import { Player } from "../src/core/player.ts";
import { beat, chain } from "../src/core/flow.ts";
import { Runtime, waitFor, type Task } from "../src/core/thread.ts";
import { highlightNodes } from "../src/blocks/attention.ts";
import type { Node } from "../src/dom/node.ts";

function target() {
  const flags = new Map<string, ReturnType<typeof signal<boolean>>>();
  return { el: {}, flag(name: string) {
    if (!flags.has(name)) flags.set(name, signal(false));
    return flags.get(name)!;
  } } as Node;
}

test("step emphasis clears at the next beat, not before, and preserves persistent state", () => {
  const root = new Root();
  const row = target(), cell = target();
  cell.flag("ps-ok")(true);
  const runtime = new Runtime((function* (): Task {
    yield* chain(highlightNodes(row), highlightNodes(row), highlightNodes({ tone: "ok" }, cell));
    yield* waitFor(1);
    yield* beat();
  })());
  root.run(() => runtime.advance(0));
  assert.equal(row.flag("ps-hot")(), true);
  root.run(() => runtime.advance(1));
  assert.equal(row.flag("ps-hot")(), false);
  assert.equal(cell.flag("ps-ok")(), true);
  root.dispose();
});

test("seek and replay reconstruct emphasis without leaking from earlier steps", () => {
  let row: Node;
  const player = new Player(() => (function* (): Task {
    row = target();
    yield* chain(highlightNodes(row));
    yield* waitFor(0.1);
    yield* beat("focused");
    assert.equal(row.flag("ps-hot")(), false);
    yield* waitFor(0.1);
  })(), { requestFrame: () => {} });
  for (const step of [0, 1, 0, 1]) {
    player.seek(step);
    assert.equal(row!.flag("ps-hot")(), false);
  }
  player.dispose();
});
