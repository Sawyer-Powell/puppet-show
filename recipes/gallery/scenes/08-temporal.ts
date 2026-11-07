/** Recipe: explicit temporal checkpoints remain identical under seeking. */
import { all, beat, box, delta, el, ghost, history, narrate, panel, signal, stages, trail, type Task, type View } from "../../../src/index.ts";

export function* temporal(view: View): Task {
  const value = signal(1);
  const moving = box(() => String(Math.round(value())), "live");
  moving.css("width", "10ch"); // Keep the translated box inside the reserved surface.
  const changes = delta(value);
  const path = trail(moving);
  const samples = history(value);
  const surfaces = stages(2);
  const space = el("div", { style: { minHeight: 150, paddingTop: 16 } }, moving);
  surfaces.at(0).add(panel("state and frozen copy", {}, space, changes));
  surfaces.at(1).add(el("div.x-stack", panel("transform checkpoints", {}, path), panel("value checkpoints", {}, samples)));
  view.add(surfaces);
  const previous = ghost(moving); // Mount source first; captures immediately.

  yield* narrate("`ghost` freezes a faded copy. `trail` and `history` record explicit checkpoints, not frame-dependent samples.", path.capture(), samples.capture());
  yield* beat("baseline");
  yield* narrate("The live node moves and changes. `delta.capture()` displays the previous and current value.",
    all(moving.x(140, 0.8), moving.y(20, 0.8), value(7, 0.8)), changes.capture(), path.capture(), samples.capture());
  yield* beat("change");
  yield* narrate("Capture a new ghost before the next change. The trail records logical transform offsets; history records values.",
    previous.capture(), all(moving.x(20, 0.8), moving.y(70, 0.8), value(3, 0.8)), changes.capture(), path.capture(), samples.capture());
  yield* beat("checkpoints");
  yield* narrate("Each temporal block has `clear()`. Delta resets its comparison baseline; clearing a ghost removes only the frozen copy.",
    () => { previous.clear(); path.clear(); samples.clear(); changes.clear(); });
}
