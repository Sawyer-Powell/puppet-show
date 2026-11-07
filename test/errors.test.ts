import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Player, isSeeking } from "../src/core/player.ts";
import { all, beat, chain } from "../src/core/flow.ts";
import { waitFor, type Task } from "../src/core/thread.ts";
import { fly, move } from "../src/dom/view.ts";
import { connect } from "../src/dom/connect.ts";
import { Node } from "../src/dom/node.ts";

test("scene error browser integration", { timeout: 60_000 }, () => {
  execFileSync(process.execPath, ["test/errors.browser.mjs"], { stdio: "inherit", timeout: 55_000 });
});

test("task thunks are lazy and their returned tasks are awaited", () => {
  const seen: number[] = [];
  const p = new Player(function* () {
    yield* chain(() => { seen.push(1); }, () => (function* (): Task {
      yield* waitFor(0.2); seen.push(2);
    })(), all(() => (function* (): Task { seen.push(3); })()));
  });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.ok(p.segments[0].end >= 0.2);
});

test("analysis errors preserve completed steps and the original cause", () => {
  const cause = new Error("broken analysis");
  const p = new Player(function* () { yield* beat("ok"); throw cause; });
  assert.equal(p.error()?.cause, cause);
  assert.equal(p.error()?.chapterStep, 1);
  assert.equal(p.step(), 1);
  assert.equal(p.count, 2);
  assert.equal(p.playing(), false);
  p.seek(0);
  assert.equal(p.error(), null);
});

test("play catches task exceptions, stops scheduling, and can navigate back", () => {
  const frames: ((ms: number) => void)[] = [];
  const p = new Player(function* () {
    yield* beat("ok");
    yield* all(() => (function* (): Task {
      yield* waitFor(0.01);
      if (!isSeeking()) throw new Error("broken play");
    })());
  }, { requestFrame: cb => frames.push(cb) });
  p.play(1);
  let ms = 0;
  while (frames.length) frames.shift()!(ms += 20);
  assert.equal(p.error()?.message, "broken play");
  assert.equal(p.error()?.chapterStep, 1);
  assert.equal(p.playing(), false);
  assert.equal(p.next(), false);
  p.prev();
  assert.equal(p.error(), null);
});

test("seek catches errors independently of successful analysis", () => {
  let broken = false;
  const p = new Player(function* () { yield* beat(); if (broken) throw "broken seek"; });
  broken = true;
  p.seek(1);
  assert.equal(p.error()?.message, "broken seek");
  assert.equal(p.error()?.chapterStep, 1);
  assert.equal(p.playing(), false);
});

test("failure reporting does not coalesce synchronous occurrences", () => {
  const messages: string[] = [];
  const p = new Player(function* (): Task { throw new Error("failure"); }, {
    onError: error => messages.push(error.message),
  });
  p.seek(0);
  p.seek(0);
  assert.deepEqual(messages, ["failure", "failure", "failure"]);
});

test("mount exceptions are reported without escaping the constructor", () => {
  const p = new Player(() => { throw new Error("mount"); });
  assert.equal(p.error()?.message, "mount");
  p.play(0);
  assert.equal(p.playing(), false);
});

test("node helpers validate before seeking shortcuts or deferred layout", () => {
  const node = Object.create(Node.prototype) as Node;
  const missing = undefined as unknown as Node;
  for (const [name, task] of [
    ["fly", () => fly(node, missing, "x")],
    ["move", () => move(node, missing)],
    ["connect", function* (): Task { connect(node, missing); }],
  ] as const) {
    const p = new Player(task);
    assert.match(p.error()!.message, new RegExp(`puppet-show: ${name}.*undefined`));
    assert.match(p.error()!.message, /pass a thunk/);
    assert.equal(isSeeking(), false);
  }
});
