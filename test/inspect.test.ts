import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "../src/inspect/index.ts";
import { inspection } from "../src/inspect/hooks.ts";
import { Node } from "../src/dom/node.ts";
import { Root, effect, flush, hold, release, signal } from "../src/core/signal.ts";
import { Runtime, waitFor } from "../src/core/thread.ts";
import type { Deck } from "../src/ui/deck.ts";

test("inspector is opt-in and snapshots existing state without flushing or advancing", () => {
  assert.equal(globalThis.__puppetShow, undefined);
  const api = inspect();
  assert.deepEqual(api.snapshot(), { version: 1, deck: null, threads: null, nodes: [], seeking: false });
  const root = new Root();
  root.run(() => {
    // An unbound node must not materialize motion/text signals during inspection.
    const element = { tagName: "DIV", className: "sample", textContent: "a".repeat(60), isConnected: true } as HTMLElement;
    const node = new Node(element);
    const runtime = new Runtime(waitFor(1));
    runtime.advance(0);
    const d = {
      player: signal({ inspectRuntime: runtime, step: signal(0), playing: signal(false), speed: signal(1), time: signal(0) }),
      chapter: signal(0), chapters: [{ title: "intro" }], players: [{ segments: [{ name: "ready", start: 0, end: 1 }] }],
      caption: signal("hello"), seeks: signal([]),
    } as unknown as Deck;
    inspection.deck!(d, "puppet-show://test");
    let snapshotRuns = 0;
    effect(() => { api.snapshot(); snapshotRuns++; });
    d.caption("changed");
    flush();
    assert.equal(snapshotRuns, 1, "snapshot reads must not subscribe the caller");
    let runs = 0;
    const value = signal(0);
    effect(() => { value(); runs++; });
    hold();
    value(1);
    assert.equal(api.snapshot().nodes.length, 0);
    (node as unknown as { bound: Map<string, unknown> }).bound.set("class:ps-hot", signal(true));
    let derivedReads = 0;
    (node as unknown as { bound: Map<string, unknown> }).bound.set("css:width", signal(() => { derivedReads++; return 20; }));
    const before = api.snapshot();
    const again = api.snapshot();
    assert.deepEqual(again, before);
    assert.equal(derivedReads, 0, "snapshot must not evaluate user callbacks");
    assert.equal(before.nodes[0].bound?.["css:width"], undefined);
    assert.equal(runs, 1);
    assert.equal(runtime.now, 0);
    assert.equal(before.deck?.path, "puppet-show://test");
    assert.equal(before.threads?.label, "waitFor 1s");
    assert.ok(before.threads!.id > 0);
    assert.equal(before.nodes[0].text.length, 40);
    assert.equal(before.nodes[0].motion, undefined);
    assert.equal((node as unknown as { motion: unknown }).motion, null);
    assert.equal(before.nodes[0].bound?.["class:ps-hot"], true);
    (node as unknown as { motion: unknown }).motion = {
      x: signal(12), y: signal(3), scale: signal(1), rotate: signal(0), opacity: signal(0.5),
    };
    assert.deepEqual(api.snapshot().nodes[0].motion, { x: 12, y: 3, scale: 1, rotate: 0, opacity: 0.5 });
    assert.deepEqual(JSON.parse(JSON.stringify(before)), before);
    release(); flush();
    assert.equal(runs, 2);
  });
  root.dispose();
  assert.equal(api.snapshot().nodes.length, 0);
  api.dispose();
  assert.equal(globalThis.__puppetShow, undefined);
  assert.equal(inspection.node, undefined);
});
