/**
 * Recipe: interactive inputs that survive replays and drive a live chart.
 * Uses: module-scope signals, slider, choice, timeline with reactive lanes.
 */
import { beat, choice, el, narrate, panel, readout, signal, slider, timeline, type Task, type View } from "../../../src/index.ts";

// Inputs live at module scope: replays (back, replay) never reset them.
const base = signal(0.2);
const mode = signal<"none" | "full">("full");

/** Deterministic pseudo-random in [0, 1): never Math.random() in a scene. */
const noise = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const schedule = (client: number) => {
  let t = 0;
  return [0, 1, 2, 3].map((attempt) => {
    const delay = base() * 2 ** attempt;
    t += mode() === "full" ? delay * noise(client * 7 + attempt) : delay;
    return t;
  });
};

export function* inputs(view: View): Task {
  const tl = timeline({ domain: [0, 4], ticks: [0, 1, 2, 3, 4], format: (t) => `${t}s`, labelWidth: "10ch" });
  const lanes = [0, 1, 2, 3, 4].map((c) => tl.lane(`client ${c}`, () => schedule(c).map((t) => tl.dot(t))));
  for (const l of lanes) l.opacity(0);

  const controls = panel(
    "inputs",
    { opacity: 0 },
    slider({ label: "base delay", value: base, min: 0.05, max: 0.5, step: 0.05, format: (v) => `${v.toFixed(2)}s` }),
    choice({
      label: "jitter",
      value: mode,
      options: [
        { value: "none", label: "none" },
        { value: "full", label: "full" },
      ],
    }),
    readout("last retry, client 0", () => `${schedule(0)[3].toFixed(2)}s`),
  );
  view.add(el("div.x-stack", controls, panel("retries", {}, tl)));

  yield* narrate(
    "A `timeline()` lane can take a function child: it re-renders whenever the signals it reads change.",
    ...lanes.map((l) => l.opacity(1, 0.25)),
  );
  yield* beat("lanes");

  yield* narrate(
    "Inputs declared at module scope stay live while paused and keep their values when you go back. Try them.",
    controls.opacity(1, 0.3),
  );
}
