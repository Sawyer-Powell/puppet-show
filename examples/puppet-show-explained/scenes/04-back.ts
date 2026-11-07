import { ask, beat, code, delta, el, narrate, panel, readout, region, signal, type Task, type View } from "../../../src/index.ts";
import { stageBox, vocabulary } from "./shared.ts";

const how = signal<"undo" | "replay" | "snapshot" | null>(null);
const random = signal<"same" | "changes" | "error" | null>(null);

export function* back(view: View): Task {
  const x = signal(0);
  const phase = signal("start");
  const history = delta(x, { format: (v) => v.toFixed(0) });
  const terms = vocabulary([
    ["beat", "where a step ends; the player stops"],
    ["replay", "run again from the start, fast"],
  ]);
  const src = code('yield* x(80, .5);\nyield* beat("A");\nyield* x(160, .5);\nyield* beat("B");', { lang: "ts" });
  const work = region("work");
  view.add(el("div.x-stack",
    panel("the page", {}, stageBox(x), readout("player", phase), history),
    el("div.ps-grid.ps-cols-2", panel("scene", {}, src), panel("new terms", {}, terms)),
    work));

  yield* narrate(
    "Each step of a page like this one ends at a *beat*. When the scene reaches `beat(\"A\")`, the player stops and waits for Next.",
    terms.show(0), src.focus(1), () => phase("running to A"), x(80, 0.5), src.focus(2), () => phase("stopped at A"), history.capture(),
  );
  yield* beat("stop at A");

  yield* narrate("Next runs on to B.",
    src.focus(3), () => phase("running to B"), x(160, 0.5), src.focus(4), () => phase("stopped at B"), history.capture());

  const q = ask({
    kind: "predict",
    prompt: "You press ← to go back to A. The scene only has forward moves. How can the player show x = 80 again?",
    answer: how,
    options: [
      { value: "undo", label: "Play the tween backwards" },
      { value: "replay", label: "Run the scene again from the start, up to A" },
      { value: "snapshot", label: "Restore a copy it saved at A" },
    ],
    correct: "replay",
    feedback: (a) => (a === "undo" ? "Tweens only run forward. " : a === "snapshot" ? "Nothing was saved at A. " : "") +
      "The player throws the run away, starts the scene again from x = 0, and runs it until beat A. It skips drawing the frames in between, so it looks instant.",
  });
  work.fill(q);
  yield* beat("predict: going back");

  yield* q.reveal();
  yield* narrate("Here is that *replay*, slowed down: back to the start, then forward through A.",
    terms.show(1), () => { phase("replay: fresh start"); x(0); }, history.capture(), src.focus(1),
    () => phase("replay: running to A"), x(80, 0.5), src.focus(2), () => phase("stopped at A"), history.capture());
  yield* beat("replay");

  const q2 = ask({
    kind: "check",
    prompt: "A scene places the box with `x(Math.random() * 200)`. You go back one step and return. What happens?",
    answer: random,
    options: [
      { value: "same", label: "The box is where it was" },
      { value: "changes", label: "The box may jump somewhere new" },
      { value: "error", label: "puppet-show refuses to run" },
    ],
    correct: "changes",
    feedback: () => "Replay runs the scene again, so `Math.random()` is called again and returns a new number. Scenes must do the same thing every run. Pick values from a fixed list or the step number instead.",
  });
  work.fill(q2);
  yield* narrate("Because going back means running again, a scene must do the same thing every time it runs.");
  yield* beat("check: same every run");

  yield* q2.reveal();
  yield* narrate("Try it on this page: press ← and → freely. Your answers stay, because they're kept outside the scene.");
}
