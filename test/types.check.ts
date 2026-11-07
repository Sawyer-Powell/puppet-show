// Type-level regression checks; compiled by `npm run typecheck`, never run.
import { choice, el, palette, signal, timeline, type Tone, type Signal } from "../src/index.ts";

export function typeChecks(): void {
  const n = el("div");
  // css() widens palette literals, so colour-to-colour tweens typecheck.
  const c: Signal<string> = n.css("color", palette.purple);
  void c(palette.aqua, 0.3);
  // attr() widens booleans.
  const pressed: Signal<boolean> = n.attr("aria-pressed", false);
  pressed(true);
  // choice() infers T from the signal, not from option literals.
  const mode = signal<"a" | "b">("a");
  choice({ label: "mode", value: mode, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] });
  const tone: Tone = palette.aqua;
  const tl = timeline({ domain: [0, 1] });
  tl.bar(0, 1, { hue: tone });
  tl.dot(0, { hue: "blue" });
  tl.note(0, "start", { hue: palette.yellow });
  tl.marker(1, "end", { hue: palette.green });
  // @ts-expect-error unknown hues must fail at compile time too
  tl.bar(0, 1, { hue: "invisible" });
  // Motion props accept functions.
  el("div", { opacity: () => 0.5 });
}
