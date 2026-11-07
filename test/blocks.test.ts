import { test } from "node:test";
import assert from "node:assert/strict";
import { signal } from "../src/core/signal.ts";
import { Player } from "../src/core/player.ts";
import { Runtime, waitFor, type Task } from "../src/core/thread.ts";
import { until } from "../src/blocks/interaction.ts";
import { stages, minimap } from "../src/blocks/layout.ts";

test("until waits for a predicate during playback", () => {
  const answer = signal<string | null>(null);
  const runtime = new Runtime(until(answer, value => value !== null));
  runtime.advance(0);
  assert.equal(runtime.root.done, false);
  runtime.advance(1);
  assert.equal(runtime.root.done, false);
  answer("selected");
  runtime.advance(1);
  assert.equal(runtime.root.done, true);
});

test("until resumes subsequent animation at the answer frame", () => {
  const answer = signal(false);
  const value = signal(0);
  const runtime = new Runtime((function* (): Task {
    yield* until(answer, Boolean);
    yield* value(10, 1);
  })());
  runtime.advance(0);
  runtime.advance(5);
  answer(true);
  runtime.advance(1);
  assert.equal(value(), 0);
  runtime.advance(1);
  assert.equal(value(), 10);
});

test("seeking skips unanswered waits without fabricating durable answers", () => {
  const answer = signal<string | null>(null);
  let observed: string | null = null;
  const player = new Player(() => (function* (): Task {
    yield* until(answer, value => value !== null);
    observed = answer();
    yield* waitFor(0.1);
  })(), { requestFrame: () => {} });
  player.seek(0);
  assert.equal(answer(), null);
  assert.equal(observed, null);
  answer("kept");
  player.seek(0);
  assert.equal(answer(), "kept");
  assert.equal(observed, "kept");
  player.dispose();
});

test("composition inputs reject invalid stage counts and duplicate map ids before DOM creation", () => {
  for (const n of [0, -1, 1.5, NaN]) assert.throws(() => stages(n), /positive integer/);
  assert.throws(() => minimap([{ id: "a", label: "A" }, { id: "a", label: "B" }]), /unique/);
});
