/**
 * Recipe: a diagram of boxes joined by connectors that follow motion.
 * Uses: box, connect (draw-on, colour tween), node.y, move, slots.
 */
import { all, beat, box, connect, el, move, narrate, palette, panel, sequence, slots, type Task, type View } from "../../../src/index.ts";

export function* diagram(view: View): Task {
  const client = box("client", "browser", { opacity: 0 });
  const api = box("api", "checkout()", { opacity: 0 });
  const db = box("db", "orders", { opacity: 0 });
  const queue = slots(4, { label: (i) => `q${i}`, width: "9ch" });
  const job = el("span.ps-chip", "job#1");
  queue.at(0).add(job);

  view.add(
    el(
      "div.x-stack",
      panel("architecture", { class: "x-diagram" }, el("div.x-row", client, api, db)),
      panel("work queue", {}, queue),
    ),
  );

  // Edges start undrawn (draw: 0) and are drawn on with a tween.
  const e1 = connect(client, api, { draw: 0 });
  const e2 = connect(api, db, { draw: 0, shape: "elbow" });
  const e3 = connect(api, job, { draw: 0, dashed: true, shape: "elbow", from: "bottom", to: "top" });

  yield* narrate(
    "`connect(a, b)` draws an edge that stays attached. Start it with `draw: 0` and tween `edge.draw` to draw it on.",
    sequence(0.12, ...[client, api, db].map((b) => b.opacity(1, 0.3))),
    sequence(0.15, e1.draw(1, 0.4), e2.draw(1, 0.4)),
  );
  yield* beat("draw");

  yield* narrate(
    "Edges follow transforms. Move a node and its edges re-route every frame; tween `edge.color` with palette hex values.",
    all(api.y(28, 0.8), e1.color(palette.yellow, 0.3), e2.color(palette.yellow, 0.3)),
    all(api.y(0, 0.6), e1.color(palette.bg4, 0.3), e2.color(palette.bg4, 0.3)),
  );
  yield* beat("follow");

  yield* narrate(
    "`slots(n)` reserves space for each index, so `move(node, slots.at(i))` never shifts the layout. Edges re-route after moves too.",
    e3.draw(1, 0.4),
    move(job, queue.at(2), 0.6),
    () => queue.cell(2).flag("ps-hot")(true),
  );
}
