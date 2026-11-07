import { all, delay, el, textMotion, type Node, type Task } from "../../../src/index.ts";

/**
 * The terms a chapter introduces, in order. Every card is laid out (hidden)
 * from the start, so revealing one never moves the page; `show(i)` rises it in
 * at the moment the term is first named.
 */
export function vocabulary(terms: [name: string, meaning: string][]): Node & { show(i: number): Task } {
  const items = terms.map(([name, meaning]) => {
    const n = el("code", name), m = el("span", meaning);
    return { node: el("div.x-term", n, m), name: textMotion(n, { text: name, split: "characters" }), meaning: textMotion(m, { text: meaning }) };
  });
  const root = el("div.x-vocab", { attrs: { role: "list", "aria-label": "terms so far" } }, ...items.map((i) => i.node));
  for (const i of items) i.node.el.setAttribute("role", "listitem");
  return Object.assign(root, {
    *show(i: number): Task {
      yield* all(items[i].name.in(), delay(0.15, items[i].meaning.in()));
    },
  });
}

/** The box whose position is the signal `x`. */
export function stageBox(x: () => number, opacity: () => number = () => 1): Node {
  return el("div.x-track", el("div.ps-box.x-token", { x, opacity, attrs: { "data-contrast-exempt": "the box fading is the subject" } }, el("span", "box"), el("small", () => `x ${x().toFixed(0)}`)));
}
