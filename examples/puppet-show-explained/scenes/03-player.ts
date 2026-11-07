import { ask, beat, choice, code, el, narrate, panel, readout, region, signal, timeline, type Task, type View } from "../../../src/index.ts";
import { vocabulary } from "./shared.ts";

const answer = signal<"exact" | "late" | null>(null);
const fps = signal<4 | 10>(4);
/** When a frame at `fps` first notices time `t`. */
const noticed = (t: number) => Math.ceil(t * fps() - 1e-9) / fps();

export function* player(view: View): Task {
  fps(4); // the question below is about the 4 fps case; the toggle comes after it
  const terms = vocabulary([
    ["player", "runs the scene, frame by frame"],
    ["frame", "one moment the browser draws"],
  ]);
  const tl = timeline({ domain: [0, 1.2], ticks: [0, 0.3, 0.6, 0.9, 1.2], format: (t) => `${t.toFixed(1)}s`, labelWidth: "13ch" });
  const frames = tl.lane("frames", () => Array.from({ length: Math.floor(1.2 * fps()) + 1 }, (_, i) => tl.dot(i / fps())));
  const exact = tl.lane("puppet-show", tl.bar(0, 0.3, { hue: "blue" }), tl.bar(0.3, 0.6, { hue: "aqua" }));
  const naive = tl.lane("if it waited", tl.bar(0, 0.3, { hue: "blue" }), tl.bar(0.3, () => noticed(0.3), { pattern: "gap" }), tl.bar(() => noticed(0.3), () => noticed(0.3) + 0.3, { hue: "aqua" }));
  frames.opacity(0); exact.opacity(0); naive.opacity(0);
  const work = region("work");
  view.add(el("div.x-stack",
    el("div.ps-grid.ps-cols-2", panel("new terms", {}, terms), panel("two .3s tweens, one after another", {}, code("yield* x(40, .3);\nyield* x(80, .3);", { lang: "ts" }))),
    panel("time", {}, tl),
    work));

  yield* narrate(
    "Something has to run the scene: the *player*. Each time the browser draws a *frame*, the player moves its clock forward and lets the scene continue.",
    terms.show(0), terms.show(1), frames.opacity(1, 0.3),
  );
  yield* beat("the player");

  yield* narrate(
    "Browsers aim for 60 frames a second but can fall behind. Here we pretend they only manage 4: one dot per frame. The first tween ends at .3s, between frames.",
    exact.opacity(1, 0.3),
  );
  yield* beat("late frames");

  const q = ask({
    kind: "predict",
    prompt: "The first tween ends at .3s, but the next frame only comes at .5s. When does the second .3s tween end?",
    answer,
    options: [{ value: "exact", label: "at .6s" }, { value: "late", label: ".3s after that late frame" }],
    correct: "exact",
    feedback: () => "The player keeps its own clock. It records that the first tween ended at exactly .3s and starts the second from there, so it ends at .6s. Late frames show a moment late, but nothing drifts.",
  });
  work.fill(q);
  yield* narrate("Your turn. Answer, then press Next.");
  yield* beat("predict: late frames");

  yield* q.reveal();
  yield* naive.opacity(1, 0.3);
  work.fill(q, panel("try it", {},
    choice({ label: "frames per second", value: fps, options: [{ value: 4, label: "4 fps" }, { value: 10, label: "10 fps" }] }),
    readout("second tween ends", () => ".600s"),
    readout("first frame to show it", () => `${noticed(0.6).toFixed(3)}s`)));
  yield* narrate("The gap row shows the time a waiting clock would lose. Switch to 10 fps: frames land on .3s and the gap disappears, but the end stays .6s.");
}
