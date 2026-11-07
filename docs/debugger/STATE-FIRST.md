# puppet-show debugger v2: state first

User feedback on v1: the pane spends its space on debugger controls and source
(VS Code already shows both), a stop strip that can't scale, and
breakpoints that need the human to poke the program. What was missing is the
point of the tool: **what state the program is in, what changed, and how
that state drives behaviour.**

## Principles

1. **State, not mechanics.** No source view, no continue/step buttons, no
   control chrome. VS Code owns code and execution. The pane shows data.
2. **Record, then scrub.** Agent sessions are mostly *probes* (collect and
   continue), recording hundreds to thousands of stops without human input.
   The human scrubs the recorded history at leisure. Live `stop`s are rare and
   are for "look at this now" moments.
3. **The agent drives the scenario.** A session includes a driver, so the
   program reaches the interesting behaviour by itself. For puppet-show explainers that
   is a dev-only deck option: `?autoplay=<seconds>` plays every step and
   advances after a pause; `?autoplay=<seconds>&back=<n>` also presses back
   `n` times at the end. No clicks are needed.
4. **Views are declared over data.** The session says which collected values
   matter and how to show them. The pane provides history, diffing and
   layout. Custom views are for what generic ones can't say.

## Pane layout (secondary side bar, ~360–480 px wide, no scrolling for the top three)

```
How logical time keeps tweens exact          ● recording   stop 812 / 3,401
┌ scrubber ───────────────────────────────────────────────────────────────┐
│ frame  ▁▁▂▂▂▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃│▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃▃ │  one lane per breakpoint id
│ join   ·        ·          ·        ·           ·   │       ·          │  cursor │  head ▶
└─────────────────────────────────────────────────────────────────────────┘
› tween x(200, 1) at t=0.533: its thread records 0.500, not the frame time.   (agent note)
changed  x 96.2 → 102.9 · thread #304 time 0.483 → 0.500 · +1 thread (tween 0.4s)
[ declared views … ]
```

- **Header (1 line):** session name, state dot (recording / paused at head /
  exited), `stop i / N`, and the current stop's breakpoint label.
- **Scrubber (≤ 56 px):** drawn on canvas so 10k stops cost nothing. One lane
  per breakpoint id, with density shading when stops are closer than a pixel.
  Click or drag to scrub. Keys: `←/→` previous/next stop, `⇧←/⇧→` previous/next
  stop of the same breakpoint, `Home/End`, `L` jump to live head. A cursor line
  and head marker show browsing versus live. Browsing never resumes the program.
- **Note:** the agent's narration for this breakpoint/stop (`.puppet-show/notes.json`),
  at most 2 lines.
- **Changed:** what differs from the previous stop *of the same breakpoint*, as
  `path old → new`. Show at most 6 items, most significant first (structure
  changes such as threads or rows entering/leaving, then scalars). This is the
  most important line in the pane.
- **Declared views:** grid, responsive to sidebar width.

## Session additions (`.puppet-show/session.json`, version 2; v1 still loads)

```jsonc
{
  "version": 2,
  "launch": { "name": "Debug puppet-show-explained", "url": "http://localhost:5173/puppet-show-explained/?autoplay=1.2&back=1" },
  "maxStops": 10000,                 // keep the newest N in memory; trace file keeps all
  "views": [
    { "id": "time", "kind": "series", "label": "clock vs logical time",
      "lines": [ { "select": "clock", "label": "now" }, { "select": "logical", "label": "thread.time" } ],
      "breakpoint": "frame" },
    { "id": "x", "kind": "series", "select": "x", "label": "box.x" },
    { "id": "threads", "kind": "puppet-show:threads" },
    { "id": "nodes", "kind": "table", "select": "puppet-show.value.nodes", "key": "id",
      "columns": ["tag", "text", "motion.x", "motion.opacity"] },
    { "id": "deck", "kind": "value", "select": ["puppet-show.value.deck.chapter", "puppet-show.value.deck.step", "puppet-show.value.deck.time"] }
  ]
}
```

- `select` is a dotted path into `stop.data` (collector id first). A collector
  result is `{ok, value}`, so paths go through `.value` for structured
  collectors, and scalar `evaluate` collectors are addressed by id directly.
  Missing paths render as "·", never as errors.
- View kinds:
  - **`value`**: labelled values, with changed ones highlighted.
  - **`series`**: numeric history across all stops, or only stops of `breakpoint`. One or more lines, a cursor marker and the current value. The host precomputes series arrays.
  - **`table`**: keyed rows and columns. Changed cells are highlighted; rows that enter or leave animate, using puppet-show `table()`/`collection()`.
  - **`tree`**: keyed nested children.
  - **`events`**: a virtualized list of stops for one breakpoint, using a label template.
  - **`puppet-show:threads`**: live threads as a Gantt of logical time against the clock. This is the view that explains puppet-show.

## Host ⇄ webview protocol v2 (replaces control messages)

Full stops stay in the extension host (bounded by `maxStops`, all on disk in
the trace). The webview gets a compact index plus the full stop under the cursor.

```ts
type ToView =
  | { type: "session"; session: { id; name; views: ViewSpec[]; breakpoints: { id; label; kind }[] } }
  | { type: "index"; from: number; items: { seq: number; bp: string | null; reason: string }[] } // appended, batched ≤ 20 Hz
  | { type: "series"; id: string; line: number; from: number; values: (number | null)[] }        // appended, batched
  | { type: "status"; state: "running" | "paused" | "exited"; head: number | null; total: number }
  | { type: "stop"; stop: Stop; prev: Stop | null }   // reply to "get", prev = previous stop of same bp
  | { type: "notes"; notes: Record<string, string> };
type ToHost =
  | { type: "ready" }
  | { type: "get"; seq: number }                      // cursor moved; host replies with "stop" (debounce, latest wins)
  | { type: "live" };                                 // follow the head again
```

No `control` messages. Debug actions live in VS Code's own toolbar.

### Concrete host wire semantics (extension implementation)

- Sequence numbers are absolute and monotonic per DAP session, even after eviction.
  `index.from` and `series.from` are the absolute seq of their first element.
  Series are aligned to the compact index: filtered/missing/non-finite samples
  are `null`, not omitted. This keeps cursor-to-series lookup O(1).
- `status` adds `first: number` (oldest retained seq; 0 when empty). On receipt,
  discard index/series entries below `first`. `total` is lifetime stop count,
  not retained size. Retained memory is bounded by `maxStops` (default 10000).
- `session` resets a view before initial retained index/series delivery and
  carries optional `maxStops`. Normal append batches never resend history.
  Reopening/ready necessarily transfers only the current bounded compact index.
- A `get` for an evicted/out-of-range seq is clamped to the retained interval;
  the returned stop's seq confirms the actual cursor. Empty history has no reply.
  `prev` is the previous retained stop of that breakpoint (null if evicted).
- ViewSpec common fields are `id`, `kind`, optional `label`, `select`
  (`string|string[]`), `breakpoint`, `lines:[{select,label?}]`, `key`,
  `columns:string[]`, `children`, `template`. Missing values stay null/·.
- Full stop replies are latest-request-wins and batched with compact updates;
  the host sends at most one webview post batch per 50ms. The external bootstrap
  may unwrap an array of ToView messages, preserving order, to the transport.
- Builtin v1 files load with default state views; v2 launch `{name,url}` resolves
  the named launch config then overrides only URL, preserving its prelaunch task.
- `notes["*"]` is the session-wide narration/error fallback after `id:seq`, id,
  and Stop.agent note. Bootstrap transport-only receipt counters are diagnostic;
  they are not part of view actions. CONTRACT.md v2 has the full concrete wire.

Performance: probes can fire at 60 Hz. Batch index/series posts, never
re-send history, and keep webview memory O(views × stops) numbers plus one
full stop. Scrubbing across 10k stops must stay smooth (index lookups O(1),
canvas redraw only).

## The demo, rewritten to be about state

Session **"How logical time keeps tweens exact"** on `puppet-show-explained` with
`?autoplay`:

- `frame` probe in the tween update loop (`src/core/thread.ts` `tween()`):
  collect clock `now`, the thread's logical `time`, progress `t`, plus the
  snapshot. Every frame of every tween becomes a stop, about 2–3k over the
  explainer.
- `join` probe where `join()` sets the parent's time: shows a parent jumping to
  the exact child end.
- `seek` probe inside `fastForward` (every 10th frame), driven by `back=1` at
  the end: shows a replay racing through hundreds of frames with effects held,
  then the state landing.
- Views: clock vs logical time series, `box.x` series (or the node under
  tween), `puppet-show:threads`, nodes table, deck value.
- Notes explain what to look for at each breakpoint, in terms of state:
  "logical time steps exactly by the duration while the clock is ragged",
  "x is a pure function of logical progress".

The human presses ▶ once and then scrubs. The pane must be readable without
scrolling at 400 px wide.

## Browser integration clarifications (v2 implementation)

`src/inspect/schema.ts` is the browser protocol. `Stop.data` permits scalar
values as well as collector envelopes. `ViewSpec` has the fields shown above,
plus optional `children` (tree child key, default `children`) and `template`
(events label, supporting `{seq}`, `{bp}`, `{reason}`). `label`, `select`,
`lines`, `breakpoint`, `key`, and `columns` are optional; missing selections
render `·`. A bare scalar `select` on a series defines its single line.

For `index` and `series`, `from` is an **absolute sequence offset**, not an
array index relative to the retained window. Series lines are aligned to the
sequence offsets; positions outside a breakpoint filter are null. Retained
index records can begin above zero after eviction. `status.total` is the
absolute count recorded, not the retained-window length. The host replies to
`get` with the requested stop and its same-breakpoint predecessor, or the
nearest retained stop if that request has expired. Webviews retain compact
index/series only, not full stop history. `stop.agent.breakpointId` carries
the stop's breakpoint identity; `agent.label` and `agent.note` remain supported.
`session.maxStops` may advertise the retained-window bound (default 10,000).
Optional `status.first` advertises the earliest retained sequence so the pane
can evict expired index/series entries even before reaching its own bound.
Bare collector-id selectors unwrap successful envelopes; failed/missing ones
show `·`. Explicit `.value` paths continue to address structured envelopes.
While following, the pane requests `live` after an index batch/head advance;
`get` is reserved for historical cursor requests (so it can disable following
in the host). A live reply may be newer than the last compact batch; it is
accepted at the scrubber's right edge until that batch arrives. Conversely,
a live reply may trail the newest index batch: accept it if newer than the
last displayed full stop, or recording can starve the state view indefinitely.
Stale replies never move a historical cursor. Live keyed row entries/exits animate; scrubbing
snaps keyed structure and highlights changed cells without queuing animations.
Pointer scrubbing selects the nearest stop in the clicked breakpoint lane;
pixel-sized nearest-stop maps avoid history scans on every drag event. Events
use a native-scroll virtual window (six keyed buttons), independent of the global
cursor until an event is selected. Notes support `*` as a session fallback,
with breakpoint and `id:seq` notes taking priority.

The bundle/mount API and snapshot version stay unchanged. Only ToView/ToHost
are replaced by the v2 protocol above. Browser implementation adds no `control`,
`rendered`, source, or full-history replay messages.
