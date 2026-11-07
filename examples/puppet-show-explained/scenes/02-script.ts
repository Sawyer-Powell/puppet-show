import { all, ask, beat, code, el, narrate, panel, readout, region, signal, timeline, type Task, type View } from "../../../src/index.ts";
import { stageBox, vocabulary } from "./shared.ts";

// Answers live at module scope so going back or replaying keeps them.
const fadeStart = signal<"0" | "1" | "1.5" | null>(null);
const continues = signal<"0.5" | "1" | "1.5" | null>(null);

export function* script(view: View): Task {
  const x = signal(0), fade = signal(1);
  const status = signal("not started");
  const terms = vocabulary([
    ["scene", "the moves, written in order"],
    ["yield*", "do this, wait until it's done"],
    ["task", "a move described, not yet run"],
  ]);
  const src = code("function* scene() {\n  yield* x(200, 1);\n  yield* fade(0.3, .5);\n}", { lang: "ts" });
  const work = region("work");
  view.add(el("div.x-stack",
    panel("the page", {}, stageBox(x, fade), readout("running", status)),
    el("div.ps-grid.ps-cols-2", panel("scene", {}, src), panel("new terms", {}, terms)),
    work));

  yield* narrate(
    "To animate several things, write the moves in order in a *scene*. The `function*` marks a function that can pause between lines.",
    terms.show(0), src.focus(1, 4),
  );
  yield* beat("a scene");

  yield* narrate(
    "`yield*` means *do this, and wait until it's done*. Watch the box: line 3 starts only after line 2's second is over.",
    terms.show(1),
    () => status("line 2: moving"), src.focus(2), x(200, 1),
    () => status("line 3: fading"), src.focus(3), fade(0.3, 0.5),
    () => status("done"),
  );
  yield* beat("yield* waits");

  yield* narrate(
    "`x(200, 1)` on its own only *describes* the move: a *task*. Nothing happens until `yield*` runs it. That is why the scene can be written ahead of time.",
    () => { x(0); fade(1); status("task built: x is still 0"); }, terms.show(2), src.focus(2),
  );
  yield* beat("a task");

  // First question: uses only signal, tween, scene, yield* and task.
  const q1 = ask({
    kind: "predict",
    prompt: "In the scene above, the move takes 1s and the fade .5s. When does the fade *start*?",
    answer: fadeStart,
    options: [{ value: "0", label: "at 0s" }, { value: "1", label: "at 1s" }, { value: "1.5", label: "at 1.5s" }],
    correct: "1",
    feedback: (a) => (a === "0" ? "Starting together would mean not waiting. " : a === "1.5" ? "1.5s is when the fade *ends*. " : "") +
      "`yield*` waits for the 1s move, so the fade starts at 1s and ends at 1.5s.",
  });
  const tl = timeline({ domain: [0, 1.6], ticks: [0, 0.5, 1, 1.5], format: (t) => `${t}s`, labelWidth: "8ch" });
  const lanes = [
    tl.lane("move", tl.bar(0, 1, { hue: "blue" })),
    tl.lane("fade", tl.bar(1, 1.5, { hue: "aqua" })),
  ];
  for (const l of lanes) l.opacity(0);
  work.fill(q1, panel("time · shown after you answer", {}, tl));
  yield* narrate("Your turn. Answer, then press Next.", src.focus(2, 3));
  yield* beat("predict: when does the fade start?");

  yield* q1.reveal();
  yield* all(...lanes.map((l) => l.opacity(1, 0.3)));
  yield* narrate("Each `yield*` line starts where the previous one ended.",
    () => status("line 2: moving"), x(200, 1), () => status("line 3: fading"), fade(0.3, 0.5), () => status("done"));
  yield* beat("one after another");

  // Contrast, then a check on a new case.
  const both = code("yield* all(\n  x(200, 1),\n  fade(0.3, .5),\n);", { lang: "ts" });
  const q2 = ask({
    kind: "check",
    prompt: "With `all(...)`, when does the scene move on to its next line?",
    answer: continues,
    options: [{ value: "0.5", label: "at .5s" }, { value: "1", label: "at 1s" }, { value: "1.5", label: "at 1.5s" }],
    correct: "1",
    feedback: () => "`all` starts both tasks together and `yield*` waits for *all* of them, so the scene continues when the longer one ends: 1s.",
  });
  const tl2 = timeline({ domain: [0, 1.6], ticks: [0, 0.5, 1, 1.5], format: (t) => `${t}s`, labelWidth: "8ch" });
  tl2.lane("move", tl2.bar(0, 1, { hue: "blue" }));
  tl2.lane("fade", tl2.bar(0, 0.5, { hue: "aqua" }));
  const tl2Panel = panel("time with all(...)", { opacity: 0 }, tl2);
  work.fill(el("div.ps-grid.ps-cols-2", panel("run together", {}, both), q2), tl2Panel);
  yield* narrate("To run moves at the same time, wrap them in `all(...)`.",
    () => { x(0); fade(1); status("all: moving + fading"); }, all(x(200, 1), fade(0.3, 0.5)), () => status("done"));
  yield* beat("check: all(...)");

  yield* q2.reveal();
  yield* tl2Panel.opacity(1, 0.3);
}
