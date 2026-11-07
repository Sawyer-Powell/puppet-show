/**
 * Flow combinators. Each returns a task, so they nest freely:
 *
 *   yield* all(
 *     box.x(200, 1),
 *     sequence(0.1, ...dots.map((d) => d.opacity(1, 0.3))),
 *   );
 */

import { beatMark, fork, join, waitFor, type Task } from "./thread.ts";
import { clearStep } from "./step-scope.ts";

/** A task, an instant callback, or a task factory evaluated when reached. */
export type Step = Task | (() => void | Task);

function* asTask(step: Step): Task {
  const task = typeof step === "function" ? step() : step;
  if (task) yield* task;
}

/** Run tasks in parallel and finish when all of them have. */
export function* all(...tasks: Step[]): Task {
  yield* join(tasks.map((t) => fork(asTask(t))), "all");
}

/** Run tasks in parallel and finish when the first one does. Others keep running. */
export function* any(...tasks: Step[]): Task {
  yield* join(tasks.map((t) => fork(asTask(t))), "any");
}

/** Run tasks one after another. */
export function* chain(...tasks: Step[]): Task {
  for (const t of tasks) yield* asTask(t);
}

/** Wait, then run. */
export function* delay(seconds: number, task: Step): Task {
  yield* waitFor(seconds);
  yield* asTask(task);
}

/** Start each task `stagger` seconds after the previous one; finish when all have. */
export function* sequence(stagger: number, ...tasks: Step[]): Task {
  const threads = [];
  for (let i = 0; i < tasks.length; i++) {
    if (i > 0) yield* waitFor(stagger);
    threads.push(fork(asTask(tasks[i])));
  }
  yield* join(threads, "all");
}

/** Run `factory(i)` sequentially `count` times (`Infinity` for ambient loops). */
export function* loop(count: number, factory: (i: number) => Step | void): Task {
  for (let i = 0; i < count; i++) {
    const step = factory(i);
    if (step) yield* asTask(step);
    else yield; // guard against a tight synchronous loop
  }
}

/**
 * Mark a step boundary. The player stops the clock here until the viewer asks
 * for the next step; seeking replays the scene up to a beat.
 */
export function* beat(name = ""): Task {
  clearStep();
  yield beatMark(name);
}
