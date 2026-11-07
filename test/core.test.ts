import { test } from "node:test";
import assert from "node:assert/strict";

import { signal, effect, flush, Root } from "../src/core/signal.ts";
import { Runtime, useThread, waitFor, type Task } from "../src/core/thread.ts";
import { all, any, beat, chain, sequence } from "../src/core/flow.ts";
import { Player } from "../src/core/player.ts";
import { ease } from "../src/core/ease.ts";
import { retype, color } from "../src/core/interp.ts";

const run = (task: Task, fps: number, maxFrames = 10_000) => {
  const rt = new Runtime(task);
  rt.advance(0);
  let n = 0;
  while (!rt.root.done && n++ < maxFrames) rt.advance(1 / fps);
  return rt;
};

test("tween lands exactly on its target and ends at its logical time", () => {
  const x = signal(0);
  let endTime = -1;
  run(
    (function* () {
      yield* x(240, 1, ease.linear);
      endTime = useThread().time;
    })(),
    7,
  );
  assert.equal(x(), 240);
  assert.equal(endTime, 1);
});

test("sequential tweens do not drift at low frame rates", () => {
  const x = signal(0);
  const starts: number[] = [];
  run(
    (function* () {
      for (let i = 0; i < 6; i++) {
        starts.push(useThread().time);
        yield* x(i, 0.3);
      }
    })(),
    11,
  );
  starts.forEach((s, i) => assert.ok(Math.abs(s - i * 0.3) < 1e-9, `start ${i} = ${s}`));
});

test("all() joins at the latest child, any() at the earliest", () => {
  let afterAll = -1;
  let afterAny = -1;
  run(
    (function* () {
      yield* all(waitFor(0.5), waitFor(0.2));
      afterAll = useThread().time;
      yield* any(waitFor(0.5), waitFor(0.2));
      afterAny = useThread().time;
    })(),
    13,
  );
  assert.equal(afterAll, 0.5);
  assert.ok(Math.abs(afterAny - 0.7) < 1e-9);
});

test("sequence staggers starts", () => {
  const starts: number[] = [];
  const mark = function* () {
    starts.push(useThread().time);
    yield* waitFor(1);
  };
  run(sequence(0.25, mark(), mark(), mark()), 60);
  assert.deepEqual(starts, [0, 0.25, 0.5]);
});

test(".to() chains keyframes from the previous end value", () => {
  const x = signal(0);
  const seen: number[] = [];
  run(
    chain(x(10, 0.2).to(4, 0.2), () => {
      seen.push(x());
    }),
    30,
  );
  assert.deepEqual(seen, [4]);
});

test("effects batch writes until flush", () => {
  const a = signal(1);
  const b = signal(2);
  const r = new Root();
  let runs = 0;
  let sum = 0;
  r.run(() =>
    effect(() => {
      runs++;
      sum = a() + b();
    }),
  );
  a(10);
  b(20);
  flush();
  assert.equal(runs, 2);
  assert.equal(sum, 30);
  r.dispose();
  a(0);
  flush();
  assert.equal(runs, 2);
});

test("player seeks by replay to the same state it plays to", () => {
  const x = signal(0);
  const frames: ((ms: number) => void)[] = [];
  const p = new Player(
    function* () {
      x(0);
      yield* x(100, 0.5);
      yield* beat("a");
      yield* x(50, 0.37);
      yield* beat("b");
      yield* x(-3, 0.21);
    },
    { requestFrame: (cb) => frames.push(cb) },
  );
  assert.deepEqual(
    p.segments.map((s) => s.name),
    ["a", "b", ""],
  );
  p.seek(1);
  assert.equal(x(), 50);
  p.seek(0);
  assert.equal(x(), 100);
  // Play segment 2 with ragged 23 ms frames.
  p.play(2);
  let ms = 0;
  while (frames.length) {
    frames.shift()!((ms += 23));
  }
  assert.equal(p.playing(), false);
  assert.equal(x(), -3);
  assert.ok(p.lastSeek()!.frames > 0);
});

test("retype erases to the common prefix then types", () => {
  assert.equal(retype("cat", "car", 0), "cat");
  assert.equal(retype("cat", "car", 0.5), "ca");
  assert.equal(retype("cat", "car", 1), "car");
  assert.equal(color("#000000", "#ffffff", 1), "#ffffff");
});

test("colour tweens need hex on both ends", async () => {
  const { interpolatorFor, color: blend, retype: re } = await import("../src/core/interp.ts");
  assert.equal(interpolatorFor("#000000", "#ffffff"), blend);
  const warn = console.warn;
  let warned = false;
  console.warn = () => (warned = true);
  assert.equal(interpolatorFor("", "#ffffff"), re);
  console.warn = warn;
  assert.ok(warned);
});
