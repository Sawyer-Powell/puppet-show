/** Recipes: controlled answers, anchored annotations, reversible focus, glossary,
 * named regions, synchronized surfaces and a signal-driven minimap. */
import {
  all, ask, beat, box, compare, depth, dim, el, glossary, label, minimap, narrate,
  highlightNodes, note, panel, region, signal, spotlight, term, type Task, type View,
} from "../../../src/index.ts";

// The answer is owned outside the scene, not by reconstructed DOM.
const answer = signal<"one" | "two" | null>(null);

export function* blocks(view: View): Task {
  const level = depth(); // Direct generator read opts this deck into its optional control.
  const position = signal("input");
  const map = minimap([{ id: "input", label: "input" }, { id: "output", label: "output" }], position);
  const surfaces = compare({ left: panel("factor ×1", {}, box("4")), right: panel("factor ×2", {}, box("8")), vary: "same input · different factor" });
  surfaces.css("row-gap", 48); // Reserve annotation space; overlays do not affect layout.
  const left = surfaces.at(0), right = surfaces.at(1);
  const content = region("workspace");
  content.css("padding-top", 20);
  content.fill(surfaces);
  const question = ask({ prompt: "Choose a factor", answer,
    options: [{ value: "one", label: "×1" }, { value: "two", label: "×2" }],
    explain: value => `Selected ${value === "one" ? "×1" : "×2"}; replay retains this answer.`,
  });
  view.add(el("div.x-stack", map, panel("controlled input", {}, question), content,
    panel("inline terms", {}, el("p", term("factor", "A multiplier applied to an input."), " is registered in this run."), glossary())));
  const callout = note(right, "anchored to the right surface", { side: "bottom" });
  callout.opacity(0);
  const tag = label(left, "×1");
  tag.opacity(0);

  yield* narrate("`ask` binds controls to a durable answer signal. Feedback is optional; nothing chooses an answer during seeking.");
  yield* beat("input");
  yield* narrate("`note` and `label` follow layout. `compare` provides two areas driven by one scene.", all(callout.opacity(1, 0.3), tag.opacity(1, 0.3)));
  yield* beat("anchors");
  const focus = spotlight(right);
  yield* narrate("`spotlight` fades sibling branches. The returned task can restore their original appearance.", highlightNodes(right), focus, right.y(10, 0.4));
  yield* beat("focus");
  const fade = dim(left);
  yield* narrate("`dim` targets explicit nodes; both focus operations are reversible.", focus.restore(), fade, fade.restore(), all(callout.opacity(0, 0.2), tag.opacity(0, 0.2)));
  yield* beat("restore");
  yield* narrate("A named region can retire and release space. The map highlight is an ordinary signal.", content.retire(), () => position("output"));
  if (level === "deep") {
    yield* beat("retire");
    yield* narrate("`depth` can include additional steps. Changing it reconstructs all chapters and updates their counts.");
  }
}

/** Optional gated variant: omitted from automatic playback because it awaits input. */
export function* gatedInput(view: View): Task {
  const question = ask({ prompt: "Choose to continue", answer,
    options: [{ value: "one", label: "×1" }, { value: "two", label: "×2" }] });
  view.add(question);
  yield* question.wait(); // Seeking skips unanswered input without inventing feedback.
  yield* narrate("The scene continues; the caller decides what to reveal.");
}
