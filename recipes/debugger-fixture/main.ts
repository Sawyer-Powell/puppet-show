import { deck, el, narrate, beat, waitFor, onCleanup, type Task, type View } from "../../src/index.ts";
import { mountDebugger } from "../../src/inspect/views/index.ts";
import type { ToView } from "../../src/inspect/schema.ts";
import { fixtureTrace, fixtureSession, fixtureNotes } from "./stops.ts";
import "./style.css";
const trace = fixtureTrace();
function* fixture(view: View): Task {
  const host = el("div.x-debugger-host"); view.add(host);
  let deliver: (message: ToView) => void = () => {};
  const show = (seq: number) => deliver({ type: "stop", stop: trace.stop(seq), prev: trace.prev(seq) });
  const app = mountDebugger(host.el, {
    post(message) {
      if (message.type === "get") show(message.seq);
      else if (message.type === "live") show(trace.index.length - 1);
    },
    onMessage(callback) { deliver = callback; },
  });
  onCleanup(() => app.dispose());
  deliver({ type: "session", session: fixtureSession });
  deliver({ type: "notes", notes: fixtureNotes });
  deliver({ type: "index", from: 0, items: trace.index });
  trace.series.forEach((values, line) => deliver({ type: "series", id: "time", line, from: 0, values }));
  deliver({ type: "status", state: "running", head: 2399, total: 2400 });
  const scrub = host.el.querySelector<HTMLElement>(".x-state-scrub")!;
  function key(key: string, shiftKey = false) { scrub.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true })); }
  const steps: [string, () => void][] = [
    ["2,400 probes become a compact *state history*, not 2,400 DOM rows.", () => key("Home")],
    ["A cursor move compares against the previous probe at the *same breakpoint*.", () => { key("End"); key("ArrowLeft"); }],
    ["Shift + arrows follow one breakpoint; logical boundaries remain exact.", () => key("ArrowLeft", true)],
    ["Series, keyed rows, owned work and events all describe this one state.", () => { key("Home"); key("ArrowRight"); }],
    ["New work enters by stable key; the changed line puts *structure before scalars*.", () => { key("Home"); for (let n = 0; n < 51; n++) key("ArrowRight"); }],
    ["The newest state remains one key away. Browsing never resumes execution.", () => key("l")],
    ["Recorded state remains available when the scenario exits.", () => { deliver({ type: "status", state: "exited", head: null, total: 2400 }); key("ArrowLeft", true); }],
  ];
  for (let i = 0; i < steps.length; i++) {
    const [caption, action] = steps[i];
    yield* narrate(caption, action, waitFor(.4));
    if (i + 1 < steps.length) yield* beat(`state ${i + 1}`);
  }
}
deck(document.body, { path: "puppet-show://debugger-fixture", chapters: [{ title: "state, not debugger mechanics", scene: fixture }] });
