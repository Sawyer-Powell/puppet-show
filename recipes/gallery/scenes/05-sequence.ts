/** Recipe: ordered host messages, a lost packet, and a retry. */
import { beat, narrate, palette, panel, seqDiagram, type Task, type View } from "../../../src/index.ts";

export function* sequenceDiagram(view: View): Task {
  const diagram = seqDiagram({
    hosts: [{ id: "client", label: "client" }, { id: "server", label: "server" }],
    rows: 5,
  });
  view.add(panel("time flows down", {}, diagram));
  const request = diagram.message("client", "server", "request", { at: 0, tone: "blue", draw: 0 });
  const lost = diagram.message("server", "client", "reply lost", { at: 1, lost: true, draw: 0 });
  const retry = diagram.message("client", "server", "retry", { at: 3, tone: palette.yellow, draw: 0 });
  const reply = diagram.message("server", "client", "reply", { at: 4, tone: "green", draw: 0 });

  yield* narrate("Each message moves down one reserved row. Lifelines keep the hosts aligned as the diagram resizes.", request.draw(1, 0.5));
  yield* beat("request");
  yield* narrate("A lost reply stops halfway with a red ×. It never reaches the receiver.", lost.draw(1, 0.5));
  yield* beat("loss");
  yield* narrate("The client retries later. The successful reply reaches its lifeline.", retry.draw(1, 0.5), reply.draw(1, 0.5));
}
