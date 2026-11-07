/** Recipe: reactive half-open byte windows and the semantic colour vocabulary. */
import { beat, chip, el, narrate, palette, panel, signal, slots, timeline, type Task, type View } from "../../../src/index.ts";

export function* byteWindow(view: View): Task {
  const start = signal(1);
  const bytes = slots(8, { width: "3ch", label: String });
  // This compact byte strip keeps all eight cells on one line at both widths.
  bytes.css("grid-template-columns", "repeat(8, minmax(0, 1fr))");
  for (let i = 0; i < 8; i++) bytes.at(i).add(chip(String(i)));
  bytes.mark("ps-live", (i) => i >= Math.round(start()) && i < Math.round(start()) + 3);
  bytes.mark("ps-dim", (i) => i < Math.round(start()));
  const tl = timeline({ domain: [0, 8], ticks: [0, 2, 4, 6, 8], labelWidth: "8ch" });
  tl.lane("hex", tl.bar(0, 8, { hue: palette.aqua }));
  tl.lane("name", tl.bar(0, 8, { hue: "yellow" }));
  view.add(el("div.x-stack",
    panel("bytes · [start, start + 3)", {}, bytes),
    panel("hue forms · palette hex and token name", {}, tl),
    panel("colour means state", {}, el("div.ps-row",
      chip("focus", { class: "ps-hot" }), chip("live", { class: "ps-live" }),
      chip("ignored", { class: "ps-dim" }), chip("lost", { class: "ps-bad" }), chip("done", { class: "ps-ok" }))),
  ));
  yield* narrate("`slots.mark` binds each cell to a predicate. Aqua marks the half-open byte window; gray marks acknowledged bytes.");
  yield* beat("window");
  yield* narrate("The window slides without rebuilding cells. Hue options accept token names and `palette` hex values.", start(4, 1));
}
