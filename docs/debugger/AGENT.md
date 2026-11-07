# Agent-owned state recording (v2)

Read [STATE-FIRST.md](./STATE-FIRST.md). The human wants **what state changed and
why**, not another debugger toolbar. Choose probes/values/views, drive the
scenario, record hundreds of samples, then explain the interesting differences.
The integration is files + VS Code commands/URI only: no MCP/network listener.

## Start with the working example

Open the repository's local Extension Development Host (see vscode/README.md),
then copy `docs/debugger/logical-time.puppet-show-session.json` to `.puppet-show/session.json`.
Run **puppet-show: Start Agent Session**. It plays every explainer step and goes back
once without clicks, recording frame/join/seek probes. The pane shows clock vs
logical time, box.x, thread Gantt, keyed node values and deck position.

`.puppet-show/` is gitignored. Canonical editor schema: `vscode/session.schema.json`;
validation/types: `vscode/src/session.ts`. Existing version-1 sessions still load
with default state views and maxStops=10000; prefer version 2 for new work.

```json
{
  "version": 2,
  "name": "How logical time keeps tweens exact",
  "launch": {
    "name": "Debug puppet-show-explained",
    "url": "http://localhost:5173/puppet-show-explained/?autoplay=0.05&back=1"
  },
  "maxStops": 10000,
  "breakpoints": [{
    "id": "frame", "file": "src/core/thread.ts",
    "match": "update(Math.max(0, (thread.runtime.now - start) / seconds));",
    "condition": "!globalThis.__puppetShow?.snapshot().seeking",
    "kind": "probe", "label": "Progress drives the next signal value",
    "note": "The clock advances on browser frames; logical boundaries remain exact."
  }],
  "collectors": ["puppet-show", {
    "id": "clock", "kind": "evaluate", "expr": "thread.runtime.now"
  }],
  "views": [{"id":"clock", "kind":"series", "select":"clock", "breakpoint":"frame"}],
  "redact": ["password", "/token/i", "secret"]
}
```

## Choose a scenario and anchors

Launch can be a launch.json config name, a full inline config, or v2 `{name,url}`
which resolves a named configuration then overrides only its URL (retaining its
preLaunchTask/source maps/webRoot). The dev-only deck driver accepts
`?autoplay=<pause-seconds>&back=<count>`; it has no production timer overhead.

Use unique executable code substrings in `match`, or `/regex/flags` strings
matched independently against each file line. Workspace-relative paths only.
A unique match resolves to a one-based line. Optional `line` falls back only
for missing matches, never ambiguity. Avoid anchoring comments/non-executable
lines because js-debug can bind them to another location.

Prefer `kind:"probe"`: collect, export, then continue. Conditions should be cheap
and pure; scope them so recordings are meaningful and not an unbounded flood.
Use rare `kind:"stop"` only for a deliberate look-at-this moment. Exceptions,
stepping, or colocated user/agent stop breakpoints never auto-continue.

The extension diff-applies only its own tagged breakpoint handles. User
breakpoints are never edited/removed. Saving session/source files re-resolves
anchors; invalid configuration removes only owned breakpoints and records errors
in status. Collector changes apply to subsequent stops. Start a new run after
changing declared views or maxStops (existing series/retention stay stable).

## Declare values and views

Collectors default to puppet-show/source; an explicit list replaces the default. For
state recordings omit source unless needed: VS Code already shows source.
`puppet-show` snapshots pure runtime state. `{id,kind:"evaluate",expr}` evaluates a JSON
value in the top frame. Undefined is missing, errors/timeouts become collector
results. Each collector has a 1500ms timeout, independently isolated. Expressions
execute debuggee code: choose pure, cheap, observational expressions only.

Selects address `stop.data`: scalar evaluate values by id (`clock`), structured
values through `.value` (`puppet-show.value.nodes`). Missing paths show ·. Available
views: value, series, table, tree, events, puppet-show:threads. Common fields are id,
kind, label, select, breakpoint; series can use multiple `lines:[{select,label}]`.
Table uses key/columns, tree uses key/children, events uses template. See the
shipped v2 session for concrete declarations.

The host computes numeric series, aligning one value per retained stop; excluded
breakpoints/missing/non-finite samples are null. The pane receives compact
index/series in <=20Hz batches and fetches full stops only for the cursor.

## Observe, narrate, iterate

```sh
npm run session -- start
npm run session -- start docs/debugger/logical-time.puppet-show-session.json
npm run session -- status
npm run session -- stop
```

Start/stop call `code --open-url` for
`vscode://puppet-show-local.puppet-show-debugger/start?session=<relative-path>` or `/stop`.
They are asynchronous requests: read status/errors to confirm. `PUPPET_SHOW_CODE`
overrides the CLI. The URI must reach the Development Host running this local,
unpublished extension; if the OS chooses another window, use the command there.
Direct extension API: `puppet-show.startSession(path?)`, `puppet-show.stopSession`. Stop only
terminates agent-owned sessions, not unrelated debugger sessions.

Every managed Stop appends `.puppet-show/traces/<run-id>.jsonl`, with run sessionId,
DAP debugSessionId, seq, frames, data and agent metadata. Sequence numbers are
per DAP session: `(debugSessionId,seq)` is the unique key. Atomic
`.puppet-show/status.json` gives state/head, last summary, errors, resolved breakpoints
and trace path. Trace retains all stops; host memory retains newest maxStops
(default10000, maximum1000000). Values can be large: select a conservative limit.

The human scrubs using the canvas: arrows move one stop, Shift+arrows stay in the
same probe, Home/End or L return to endpoints/live. No execution controls live
in the pane. The changed line compares the previous retained stop of the same
breakpoint (not an unrelated interleaved event). Evicted comparisons are null.

Write live narration in `.puppet-show/notes.json`:

```json
{
  "frame": "Progress drives the next value while the logical end remains exact.",
  "frame:812": "Notice *this* boundary: the late clock does not accumulate drift."
}
```

`id:seq` overrides id-only text; breakpoint note is the fallback. `*` is the
session-wide fallback. Backticks/asterisks are escaped caption markup. Keep it
short (two lines). Edits update the pane without rewriting previous trace lines.
Notes should explain state, not ask the human to click through mechanics.

## Data exports and redaction

**Traces contain real program values/source. Treat them as data exports.**
Configure `redact` before starting. Plain patterns are case-insensitive key
substrings; `/regex/flags` patterns are regular expressions. The extension
recursively replaces matching keys' values with `[REDACTED]` before retained
history, rendering and trace/status writes (including nested arrays/objects).
Trace files are mode0600; status uses atomic temporary-file rename.

This is not secret detection: credentials embedded inside strings, source,
notes, errors, captions, or JSON-returned-as-a-string cannot be key-redacted.
Return structured values, omit sensitive collectors and never collect
PHI/customer data. Changed patterns cannot retract data already exported.
Do not commit/share `.puppet-show` files without reviewing them. Multiple VS Code
windows must not concurrently own the same `.puppet-show` output directory.
