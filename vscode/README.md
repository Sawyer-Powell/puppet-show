# puppet-show debugger — state first (local)

The pane shows **state and what changed**, not debugger mechanics. VS Code owns
source and execution controls. Agents record mostly probes; humans scrub the
resulting history in a pinned secondary-side-bar pane.

## Demo: press play once, then scrub

1. Open this repository in VS Code 1.132+. Run `npm install` and
   `npm --prefix vscode install` once.
2. Run and Debug → **Run puppet-show extension** → play. The build task builds the
   extension/browser assets and opens the Development Host on this workspace.
3. In its terminal:
   ```sh
   mkdir -p .puppet-show
   cp docs/debugger/logical-time.puppet-show-session.json .puppet-show/session.json
   ```
4. Command Palette → **puppet-show: Start Agent Session**. Vite starts on port 5173,
   Chrome loads `puppet-show-explained/?autoplay=0.05&back=1`, and the explainer drives
   itself. No clicks or stop breakpoints are needed. Close another Vite server
   using 5173 first.
5. Widen the secondary side bar to about 400px. Watch clock vs logical time,
   box.x, thread time, node rows and deck position. The frame/join/seek lanes
   explain different state transitions, not different call-stack locations.
6. Click/drag the canvas scrubber. `←/→` moves one stop, `Shift+←/→` moves one
   stop of the same probe, Home/End and L return to endpoints/live. The note
   explains the selected state; **changed** compares the previous stop of the
   same breakpoint. Browsing never resumes execution.
7. Read `.puppet-show/status.json` and its JSONL trace path. An agent can refine
   anchors, conditions and collectors or edit live `.puppet-show/notes.json` narration.
   Use **puppet-show: Stop Agent Session** when done; exported history remains on disk.

The new demo records frame updates, exact joins and seek replay with probes.
`puppet-show-explained.puppet-show-session.json` remains a v1 compatibility/manual-debug example,
not the primary demo. Agent setup/schema/privacy: [AGENT.md](../docs/debugger/AGENT.md).

Terminal requests: `npm run session -- start [relative-session-path]`, `stop`,
`status`. Start/stop wrap `code --open-url`; the URI must reach the Development
Host running this unpublished local extension. If OS routing picks a normal
window, use the command in the Development Host instead.

## Bounded, demand-driven transport

`maxStops` defaults to 10000 retained full stops per DAP session. The trace keeps
all stops. Host append/get/previous-same-probe lookup are O(views)/O(1); sequence
numbers stay absolute after eviction. The webview keeps compact index/series
numbers plus the current stop/previous comparison, not full-stop history.

Index/series/status/notes and latest stop replies are coalesced into <=20Hz post
batches. A fast scrub fetches only its latest requested stop. `status.first`
marks retention eviction; views discard older compact samples. Missing selectors
render as ·. No continue/step/pause/control messages exist in protocol v2.

`views` declares value/series/table/tree/events/puppet-show:threads views. Select paths
start at a collector id: `clock` addresses scalar evaluate results;
`puppet-show.value.nodes` selects a structured value. Series arrays are precomputed by
the host, with optional breakpoint filtering. v1 sessions load default state
views and bounded retention. Starting a new run applies changed view/retention
configuration; breakpoint/collector/notes edits apply during recording.

## Pane/focus settings

Default `puppet-show.location:"sidebar"` is a retained WebviewView in a dedicated
secondary-side-bar container (supported by the installed VS Code 1.132
contribution schema). Auto-reveal preserves focus and source reveals cannot
replace it. `puppet-show.location:"editor"` opens beside and locks that editor group;
its built-in lock command briefly focuses only the panel, then restores the
previous group. Close the old editor tab manually when switching locations.

The extension does not modify global debugger settings. For a calmer demo,
consider workspace settings:

```json
{
  "debug.focusEditorOnBreak": false,
  "debug.focusWindowOnBreak": false,
  "debug.openDebug": "neverOpen"
}
```

These suppress optional debugger focus, not data collection. API references:
https://code.visualstudio.com/api/references/contribution-points#contributes.viewsContainers
and https://code.visualstudio.com/api/references/vscode-api#WebviewView .

## Implementation and tests

- `src/session.ts`: versioned schema, anchors, owned-only breakpoint diffs,
  recursive key redaction, ordered JSONL/atomic status writes.
- `src/model.ts`: bounded absolute-seq history, same-probe prev links and series.
- `src/batch.ts`: <=20Hz coalescing, append merge, latest-get wins.
- `src/agent-session.ts`: watches, launch ownership, notes and probe continuation.
- `src/tracker.ts`: stopped → threads → stack → isolated concurrent collectors.
- `src/pane.ts` / `media/bootstrap.js`: retained strict-CSP pane, external mount,
  batched transport; persists only small metadata, not O(N) history per scrub.

Reusable collectors remain self-contained files exporting a `Collector`
(`id,timeoutMs,collect({session,frame,readFile})`) registered in collectors/index.
Agent-specific evaluate collectors need no source edits. Return structured JSON;
all evaluation must be observational because expressions execute real code.

```sh
npm --prefix vscode run build
npm --prefix vscode test
npm run check
npm run build:webview
npm --prefix vscode run test:e2e
npm run verify -- debugger-fixture
```

Electron e2e uses installed VS Code/Chrome and free port 5173, starts the new
scenario via command, records >500 autonomous probes, checks redaction/exports
and actual compact index/series delivery. Throughput and 5k-stop memory evidence
are in [VERIFICATION.md](./VERIFICATION.md); the standalone benchmark takes a
synthetic e2e trace path:

```sh
cd vscode
node --expose-gc --experimental-strip-types test/bench-history.mjs ../.puppet-show/traces/<id>.jsonl
```

Traces are **data exports**. Key redaction cannot sanitize secrets embedded in
strings/source. `.puppet-show/` is ignored, not automatically safe to share. Multiple
VS Code windows must not write the same `.puppet-show` output directory concurrently.
