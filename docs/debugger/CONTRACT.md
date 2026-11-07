# puppet-show debugger contract v2 — state first

[STATE-FIRST.md](./STATE-FIRST.md) is the design authority. This replaces the
v0/v1 mechanics-first pane/protocol: no source view, execution controls, full-stop
history replay, or DOM stop strip. VS Code owns execution and source. The pane
shows selected state, its previous-same-breakpoint diff, and declared views.

## 1. In-page inspector (snapshot version remains 1)

`inspect()` from `src/inspect/index.ts` installs `globalThis.__puppetShow` with
`version:1`, pure `snapshot()` and `dispose()`. It must not flush effects,
advance time, or evaluate derived signal callbacks. Vite dev injects it before
example main modules; production builds omit it unless explicitly opted in via
`VITE_PUPPET_SHOW_INSPECT=1`. Thread/node identities are stable within a run, not replay.

Snapshot schema remains `src/inspect/schema.ts`: nullable deck (chapter/step,
segments, playing/speed/time/caption/recent seeks), thread tree (id/label/time,
done/children), up to 200 connected bound/motion nodes (id/tag/class/text and
signal values), and seeking flag. No DOM references. Derived bindings are
omitted so reading at a breakpoint does not execute user callbacks.

Dev-only `?autoplay=<pause-seconds>&back=<count>` drives the entire scenario and
then goes backward automatically. Normal and production decks have no driver.

## 2. Session file and stops

Canonical schema: `vscode/session.schema.json`; runtime validation/types:
`vscode/src/session.ts`. Agent guide: [AGENT.md](./AGENT.md).

Session v2: `{version:2,name,launch,breakpoints?,collectors?,redact?,notes?,views?,maxStops?}`.
Existing v1 files continue to load with default state views and maxStops=10000.

- Launch is a launch.json name, inline debug config, or v2 `{name,url}`. The
  latter resolves the named config then overrides **only URL**, preserving its
  prelaunch task/webRoot/source maps/etc.
- Breakpoints: `{id,file,match?,line?,condition?,kind?,label?,note?}`. Kind is
  stop/probe (default stop). Match is a unique executable-line substring or
  `/regex/flags`; one-based fallback line applies only for missing matches,
  never ambiguous ones. Workspace paths only. Owned-only diffing never touches
  user breakpoints. Source-file and session watches re-resolve drifted anchors.
- Probes collect/export and auto-continue. Colocated user/agent stop breakpoints,
  exceptions and stepping never auto-continue. Mostly probes is the default
  workflow: a human should not need to drive the demo.
- Collectors default to puppet-show/source. Explicit lists replace defaults and support
  builtin names and `{id,kind:"evaluate",expr}`. Evaluate runs a JSON wrapper in
  the top frame, preserving JSON string/number/object values and undefined.
  Independent 1500ms timeout/error isolation; failure is data, not lost stops.
- `maxStops`: positive safe integer, default 10000, maximum 1000000. Only newest
  N full stops, compact entries, samples and prev links remain in host memory.
  The trace keeps every stop. Sequence numbers never reset on eviction.

```ts
interface Stop {
  seq: number; reason: string; threadId: number;
  frames: {name:string; path?:string; line:number; column:number}[];
  data: Record<string, Collected>;
  agent?: {breakpointId?:string; label?:string; note?:string;
    kind?:"stop"|"probe"; notes?:string};
}
type Collected = {ok:true;value:unknown} | {ok:false;error:string}
  | {ok:false;missing:true};
```

Puppet Show collector evaluates `JSON.stringify(globalThis.__puppetShow?.snapshot())` using
DAP `context:"clipboard"` (no clipboard writes; avoids watch-preview truncation).
Adapters' quoting is safely decoded without eval. Source is ±12 disk lines,
with `{path,startLine,lines,line}`; v2 demo intentionally does not collect source.

## 3. Declared views and selects

```ts
interface ViewSpec {
  id: string;
  kind: "value"|"series"|"table"|"tree"|"events"|"puppet-show:threads";
  label?: string; select?: string|string[]; breakpoint?: string;
  lines?: {select:string;label?:string}[];
  key?: string; columns?: string[]; children?: string; template?: string;
}
```

Select is a dotted path into stop.data. A scalar evaluate collector is addressed
by id (`clock`); structured paths include `.value` (`puppet-show.value.nodes`). Missing,
failed and non-finite series values are null/·, never display errors. Host series
extraction honors each view's optional breakpoint filter. Every line aligns to
the compact index; other breakpoint samples are null rather than omitted.

Views are responsive; at 400px the one-line header, <=56px canvas scrubber,
two-line note, changed line and first views fit without scrolling. Diff compares
only the previous retained stop of the **same breakpoint**, prioritizing structure
then scalars, at most six items. Full stops do not live in the webview history.

## 4. Host ⇄ webview protocol (breaking v2)

```ts
type ToView =
  | {type:"session";session:{id:string;name:string;views:ViewSpec[];
      breakpoints:{id:string;label:string;kind:"stop"|"probe"}[];
      maxStops?:number}}
  | {type:"index";from:number;items:{seq:number;bp:string|null;reason:string}[]}
  | {type:"series";id:string;line:number;from:number;values:(number|null)[]}
  | {type:"status";state:"running"|"paused"|"exited";
      head:number|null;total:number;first:number}
  | {type:"stop";stop:Stop;prev:Stop|null}
  | {type:"notes";notes:Record<string,string>};
type ToHost = {type:"ready"} | {type:"get";seq:number} | {type:"live"};
```

- `session` resets the consumer. Ready/reopen sends retained compact index and
  series once; normal append batches **never** resend history. `index.from` and
  `series.from` are absolute seq numbers, and series align one-to-one with index.
- **Retention:** `status.first` is mandatory on host messages (0 when empty).
  Consumers discard index/series below first; total is lifetime count, not size.
  This is required to keep both sides bounded after maxStops is exceeded.
- `get` is O(1), latest-request-wins. Evicted/out-of-range requests clamp to the
  retained interval; returned stop.seq confirms actual cursor. Empty has no reply.
  `prev` is null if the previous same-bp sample has been evicted. Anonymous stops
  form a null-bp lane. `live` fetches the newest stop. No DAP commands are issued.
- The view follows new samples by issuing `live` after index/head advances;
  only historical cursor moves issue `get`, which disables following in the host.
  Live replies may trail the newest compact batch: accept progress beyond the
  last displayed stop, or recording can starve the state view. Stale replies
  never move a historical cursor. Host full-stop replies occur only for get/live.
- Host coalesces compact appends, status, notes and full-stop replies into **one
  array of ToView messages per webview post at most every 50ms**. Bootstrap unwraps
  arrays into individual transport callbacks in order. Only the newest pending
  full-stop reply survives rapid scrubbing. No large getState history copy.
- Bootstrap may send a transport-only `{type:"receipt",index,series,stop}` count
  after dispatch for integration diagnostics; this is not a view action/control.

## 5. Mount, pane and exports

`npm run build:webview` emits `dist/webview/debugger.js` (ESM named export
`mountDebugger`) and `debugger.css` with embedded fonts. Mount signature remains
`mountDebugger(host,{post,onMessage}) => {dispose()}`; mount sends ready.
External bootstrap/CSS only, strict nonce CSP, restricted local resource roots.
The retained WebviewView uses VS Code 1.132 secondarySidebar; optional editor mode
opens beside and locks its group. Preserve-focus reveal; global focus settings
are recommendations, never mutated.

Commands: `puppet-show.startSession(path?)`, `puppet-show.stopSession`, `puppet-show.openDebugger`.
URI: `vscode://puppet-show-local.puppet-show-debugger/start?session=<relative-path>` and `/stop`.
`npm run session -- start|stop|status` wraps CLI/files; no MCP/listener/new connector.

Each managed Stop appends `.puppet-show/traces/<run-id>.jsonl` with run sessionId and
DAP debugSessionId; `(debugSessionId,seq)` uniquely identifies it. Atomic
`.puppet-show/status.json` contains state/head/summary/errors/trace path. Notes map bp id
or `id:seq` to short escaped markup, specific wins; `*` is a session-wide fallback.
Trace files are immutable after append; note edits do not rewrite prior exports.

## Security/data

Traces contain real program data/source and are **data exports**. `.puppet-show/` is
Git-ignored. Recursive key redaction runs before retained history, rendering and
file writes; matched values become `[REDACTED]`. New trace/status files use 0600.
Key redaction cannot find secrets embedded inside arbitrary strings, source,
notes, captions or serialized JSON. Evaluate expressions can have side effects:
choose pure expressions, never PHI/customer data, and review exports before sharing.

## Demo and checks

`logical-time.puppet-show-session.json` replaces the mechanics-first README demo:
frame/join/seek probes, dev autoplay/back driver, clock/logical/box.x series,
thread Gantt, keyed nodes table and deck values. No stop breakpoints or clicks.
The old puppet-show-explained v1 file remains solely as a compatibility example.

Unit tests cover bounded lookup/prev links, aligned series, <=20Hz batching,
latest-get wins and schema v1/v2. Electron e2e records >500 autonomous probes,
checks actual index/series delivery and traces. `test/bench-history.mjs` measures
retention at 5k cloned real synthetic-demo snapshots and 100k scrub lookups.
Browser fixture verifies compact layout and 10k-stop scrub performance.
`npm run test:debugger` builds the webview and tests strict CSP, all six views,
lane-aware drag/keys, independent virtual-event scrolling, stable keyed live
enter/exit, eviction and delayed/stale replies. See [PERFORMANCE.md](./PERFORMANCE.md)
for measurements, artifacts and disclosed large-payload inspection bounds.
