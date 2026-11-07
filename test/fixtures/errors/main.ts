import { deck, el, beat, fly, table, narrate, isSeeking } from "../../../src/index.ts";
import "../../../src/ui/puppet-show.css";

const d = deck(document.body, { hash: false, chapters: [
  { title: "Broken analysis", scene: function* (view) {
    const source = el("div", "source");
    const orders = table({ columns: [{ key: "id", label: "id" }], rows: [] as { id: string }[], key: r => r.id });
    view.add(source, orders);
    yield* narrate("eager target", orders.set([{ id: "101" }], 0), fly(source, orders.row("101")!, "x"));
  } },
  { title: "Healthy", scene: function* (view) { view.add(el("div", "healthy")); yield* beat("ok"); } },
  { title: "Broken live", scene: function* () { if (!isSeeking()) throw new Error("live failure"); yield* beat(); } },
  { title: "Lazy target", scene: function* (view) {
    const source = el("div", "source");
    const orders = table({ columns: [{ key: "id", label: "id" }], rows: [] as { id: string }[], key: r => r.id });
    view.add(source, orders);
    yield* narrate("lazy target", orders.set([{ id: "101" }], 0), () => fly(source, orders.row("101")!, "x"));
  } },
] });
Object.assign(window, { d });
