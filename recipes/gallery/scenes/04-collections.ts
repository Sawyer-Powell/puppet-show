/** Keyed identity, reactive row patches, and a linked snapshot inspector. */
import { beat, choice, chip, collection, el, fly, narrate, panel, signal, table, timeline, type Task, type View } from "../../../src/index.ts";

const snapshot = signal<"early" | "late">("early");
// Durable state belongs to keys, not physical nodes reconstructed by the deck.
const local = new Map([["B", signal(7)]]);
type Item = { id: string; label: string; at: number };
const first: Item[] = [
  { id: "A", label: "Ash", at: 1 },
  { id: "B", label: "Birch", at: 2 },
  { id: "C", label: "Cedar", at: 4 },
];

export function* collections(view: View): Task {
  const list = collection<Item>({
    key: item => item.id, layout: "wrap",
    render: (item, key) => chip(() => `${key}: ${item().label}${local.has(key) ? ` · ${local.get(key)!()}` : ""}`),
  });
  const pending = chip("E · Elm");
  const versions = signal(first);
  const limit = () => snapshot() === "early" ? 2 : 5;
  const tl = timeline({ domain: [0, 5], ticks: [0, 1, 2, 3, 4, 5] });
  tl.lane("snapshot", tl.bar(0, limit, { hue: "aqua" }));
  const inspector = table<Item>({
    columns: [{ key: "id", label: "key" }, { key: "label", label: "value" }, { key: "at", label: "time", align: "right" }],
    rows: () => versions(), key: item => item.id,
    rowClass: item => item.at <= limit() ? "ps-live" : "ps-dim",
  });
  view.add(el("div.ps-grid.ps-cols-2",
    panel("stable nodes", {}, list, el("div.ps-row", el("small", "next insert"), pending)),
    panel("snapshot inspector", {}, choice({ label: "snapshot", value: snapshot, options: [
      { value: "early", label: "early" }, { value: "late", label: "late" },
    ] }), tl, inspector),
  ));
  yield* narrate("A `collection()` owns each node by key. B carries key-owned local state.", list.set(first));
  yield* beat("keys");
  const next = [first[1], { id: "D", label: "Dogwood", at: 5 }, first[0]].map(item => item.id === "B" ? { ...item, label: "Birch ✓" } : item);
  yield* narrate("C exits first. B and A move together; D enters at its final position. B’s label patches in place.", list.set(next), inspector.set(next));
  versions(next);
  yield* beat("reconcile");
  yield* narrate("Change the snapshot: the timeline and row visibility react together. Gray rows remain present but are ignored by this snapshot.", () => inspector.row("B")?.flag("ps-hot")(true));
  yield* beat("snapshot");
  // The hook receives the real row while its slot opens: no hidden staging row.
  const inserted = [...next, { id: "E", label: "Elm", at: 3 }];
  yield* narrate("Insert a record: space opens smoothly and the token becomes the new row.",
    inspector.set(inserted, {
      duration: 1,
      enter: row => fly(pending, row, "E · Elm", { duration: 0.8, land: true }),
    }));
  versions(inserted);
}
