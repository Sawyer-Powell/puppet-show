import { el, panel, textMotion, countText, all, beat, say, type View, type Task } from "../../../src/index.ts";

export function* textScene(view: View): Task {
  const words = el("p", "Small motion. Clear meaning.");
  const chars = el("p", "Ready to ship.");
  const lines = el("p", "Read one line.\nThen the next.");
  const terminal = el("p", "build --ready");
  const swap = el("p", "Waiting for input");
  const number = el("span");
  const a = textMotion(words);
  const b = textMotion(chars, { split: "characters" });
  const c = textMotion(lines, { split: "lines" });
  const d = textMotion(terminal, { mode: "type" });
  const e = textMotion(swap, { reserve: ["All changes saved"] });
  const count = countText(number, { width: 6, format: n => `${Math.round(n)} ms` });
  view.add(el("div.ps-grid.ps-cols-2",
    panel("word rise · default", {}, words),
    panel("character rise", {}, chars),
    panel("explicit lines", {}, lines),
    panel("terminal type", {}, terminal),
    panel("reserved swap", {}, swap),
    panel("tabular count", {}, number)));
  yield* say("A small rise, no blur. Words are the everyday default.");
  yield* all(a.in(), b.in(), c.in(), d.in(), e.in(), count.to(128));
  yield* beat("reveal");
  yield* say("Reserve both phrases; cross-fade without moving the neighbours.");
  yield* all(e.swap("All changes saved"), count.to(42));
  yield* beat("swap");
  yield* say("An exit keeps its place. Animate text in once per step.");
  yield* all(a.out(), b.out(), c.out(), d.out());
  yield* beat("out");
  yield* say("Keep body captions instant. Save motion for a meaningful change.");
  yield* all(a.in(), b.in(), c.in(), d.in());
}
