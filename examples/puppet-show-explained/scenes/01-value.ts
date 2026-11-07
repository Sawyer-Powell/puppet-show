import { beat, code, el, narrate, panel, signal, type Task, type View } from "../../../src/index.ts";
import { stageBox, vocabulary } from "./shared.ts";

export function* value(view: View): Task {
  const x = signal(0);
  const terms = vocabulary([
    ["signal", "a value the page follows"],
    ["tween", "a change spread over time"],
  ]);
  const src = code("x(120);\nx(200, 1);", { lang: "ts" });
  src.opacity(0);
  view.add(el("div.x-stack",
    panel("the page", {}, stageBox(x)),
    el("div.ps-grid.ps-cols-2", panel("code", {}, src), panel("new terms", {}, terms))));

  yield* narrate(
    "Everything that moves on this page is driven by numbers. This box sits wherever the number `x` says, and `x` is 0.",
    terms.show(0),
  );
  yield* beat("a value on screen");

  yield* narrate(
    "Calling `x(120)` sets the number. The box follows by itself; nothing redraws it by hand. A value the page follows is a *signal*.",
    src.opacity(1, 0.3), src.focus(1), () => x(120),
  );
  yield* beat("set a signal");

  yield* narrate(
    "Add a duration, `x(200, 1)`, and the change is spread over one second. A change spread over time is a *tween*.",
    src.focus(2), terms.show(1), x(200, 1),
  );
}
