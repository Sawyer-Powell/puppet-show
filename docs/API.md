# puppet-show API reference

Everything is imported from `src/index.ts` (in examples: `../../../src/index.ts`).
Types are exact; when in doubt the source has doc comments on every export.
Runnable recipes for most of this live in `recipes/gallery/scenes/`.

## Writes, tweens, chains: the one rule

A signal is a function. The number of arguments decides what it does:

```ts
x()                     // read (tracked inside effects / reactive props)
x(10)                   // write now; returns void
x(10, 0.4)              // returns a Task (tween). Nothing happens until it is run:
yield* x(10, 0.4);      //   run it here and wait
yield x(10, 0.4);       //   fork it and continue immediately
x(10, 0.4).to(0, 0.3)   // .to() exists on the *returned tween*, never on the signal
```

Inside step lists (`narrate`, `all`, `chain`, `sequence`) a plain callback is an
instant step: `() => node.flag("ps-ok")(true)` (persistent committed state).
A callback may also return a Task, which runs when that step is reached (not
when the step list is constructed):
`narrate(caption, t.set(rows), () => fly(a, t.row("101")!, "x"))`.

## Core

| export | signature | notes |
| --- | --- | --- |
| `signal` | `signal<T>(initial: T \| (() => T), { interp?, ease? }?)` | numbers lerp, hex colours blend, other strings retype, number arrays lerp |
| `effect` | `effect(fn: () => void): dispose` | re-runs when signals read in `fn` change; batched per frame |
| `waitFor` | `waitFor(seconds): Task` | |
| `tween` | `tween(seconds, (t: 0..1) => void): Task` | low-level; last call is exactly `t = 1` |
| `waitUntil` | `waitUntil(() => boolean): Task` | checked once per frame |
| `all` / `any` | `all(...steps): Task` | parallel; finish at the last / first |
| `chain` | `chain(...steps): Task` | sequential |
| `sequence` | `sequence(stagger, ...steps): Task` | start each `stagger` s after the previous |
| `delay` | `delay(seconds, step): Task` | |
| `loop` | `loop(count, (i) => step \| void): Task` | |
| `beat` | `beat(name?): Task` | ends a step; only at top level of a scene |
| `ease` | `ease.linear, inOutCubic (default), outCubic, snap, outBack, steps(n), …` | `bezier(x1, y1, x2, y2)` for custom |

`Step = Task | (() => void | Task)`.

### Low-level runtime

For adapters, tooling and tests (the debugger, `verify`). Scenes rarely need these.

| export | signature | notes |
| --- | --- | --- |
| `flush` | `flush(): void` | run pending effects now instead of at the next frame |
| `afterFlush` | `afterFlush(fn): dispose` | hook run after each effect flush |
| `hold` / `release` | `hold(): void` | defer effect flushes until the matching `release()` |
| `untrack` | `untrack(() => T): T` | read signals without subscribing |
| `onCleanup` | `onCleanup(fn): void` | run `fn` when the current owner (effect, `Root`, scene) is disposed |
| `Root` | `new Root()` | ownership scope; `.run(fn)` collects effects, `.dispose()` tears them down |
| `isSignal` | `isSignal(v): v is Signal` | |
| `fork` / `join` | `fork(task): Thread`, `join(threads, "all" \| "any"?): Task` | background thread on the current timeline; `join` waits for them |
| `useThread` / `useNow` | `useThread(): Thread`, `useNow(): number` | current thread and its logical time; throw outside a task |
| `Runtime` / `Thread` | classes | the logical-time scheduler under `Player` |
| `Player` | `new Player(() => scene)` | `step`, `playing`, `time`, `speed`, `lastSeek`, `error` signals; `play(i)`, `next()`, `prev()`, `seek(i)`, `replay()`, `progress()`, `dispose()`; the deck owns one per chapter |
| `isSeeking` | `isSeeking(): boolean` | true while a seek is fast-forwarding; layout helpers skip geometry then |
| `interpolatorFor` | `interpolatorFor(sample, target?)` | the interpolator `signal()` picks for a value type |
| `useView` | `useView(): View` | current scene view; throws outside a scene |
| `highlightShell` / `highlightDiff` | `(line: string) => string` | per-line HTML highlighters used by `code()` for `lang: "shell"` / `"diff"`; `highlight` is the TS one |

## Nodes

```ts
el(spec: "tag.class#id", props?: Props, ...children: Child[]): Node
```

- `Props`: `x, y, scale, rotate, opacity` (initial numbers or functions),
  `class` (string or function), `style: { prop: value | () => value }`
  (camelCase or kebab-case; numbers get `px` except unitless and `--custom`),
  `attrs: { name: value | () => value }`, `on: { click: (e) => … }`, `html` (trusted).
- `Child`: `Node | DOM node | string | number | null | false | Child[] | () => …`.
  A function child is reactive; it may return text **or nodes/arrays of nodes**:
  `el("ul", () => items().map((i) => el("li", i)))` rebuilds when `items` changes.
- Signals on every node: `node.x`, `y`, `scale`, `rotate` (deg), `opacity`, `text`.
- `node.css(prop, initial)`: signal bound to a style property. **`initial` is
  required**: tweens start from it, not from the stylesheet. Colours must be hex
  (`palette.*`) to blend. Type widens, so `css("color", palette.red)` is `Signal<string>`.
- `node.attr(name, initial)`: `aria-*`/`data-*` booleans serialize as `"true"/"false"`;
  other `true` sets an empty attribute, `false`/`null` removes it.
- `node.flag(className, initial = false)`: boolean signal toggling a class.
  Semantic state classes work on any node (including table rows and plain text):
  `ps-hot` = yellow/current focus, `ps-live` = aqua/live or visible value,
  `ps-dim` = gray/inactive, ignored or invisible, `ps-bad` = red/error, cost or lost,
  `ps-ok` = green/done or committed. These are the colour-meaning vocabulary;
  `ps-dim` describes meaning, it does not hide the node. Choose one value state;
  `ps-hot` can temporarily override it for focus (clear the flag to restore it).
- `node.add(...children)`, `node.replace(...children)`, `node.remove()`, `node.el`.

## Motion that knows about layout

| export | signature | notes |
| --- | --- | --- |
| `fly` | `fly(from: Node, to: Node, label: Child, { duration = 0.6, ease, arc = 24, class?, land = false }): Task` | token through the overlay; `class: "ps-aqua" \| "ps-blue" \| "ps-purple"`; use `arc: 0` for vertical flights |
| `move` | `move(node, parent: Node, duration = 0.5, ease?, before?: Node): Task` | reparent with FLIP. Source and destination must reserve their size (use `slots`) or layout jumps |
| `connect` | `connect(from: Node, to: Node, { shape: "curve" \| "elbow" \| "straight", from/to: "auto" \| "top" \| …, arrow = true, dashed, color, draw = 1, opacity }): Edge` | edge that follows both nodes through any motion; `edge.draw`, `edge.color`, `edge.opacity` are signals. Start with `draw: 0` and tween to 1 to draw on |

All three validate node arguments before skipping geometry during seeking;
missing nodes throw actionable errors during analysis as well as playback.
`fly` and `move` still consume their duration while seeking.
`fly` re-measures both endpoints each frame, following moving/growing targets.
With `land: true`, the destination is hidden during flight, then cross-fades in
as the token fades out over the final fifth. Its original opacity is restored
on completion or cancellation. Keep the stage within the viewport at 720px;
flights must start and land on screen (`fly` never scrolls).

## Components

| export | signature |
| --- | --- |
| `panel` | `panel(title: Child, props?: Props, ...children): Node` — TUI frame |
| `box` | `box(label: Child, sub?: Child, props?: Props): Node` — diagram noun |
| `chip` | `chip(label: Child, props?: Props): Node` |
| `readout` | `readout(label: Child, value: () => unknown, props?: Props): Node` |
| `slider` | `slider({ label, value: Signal<number>, min, max, step?, format? }): Node` |
| `choice` | `choice({ label, value: Signal<T>, options: { value: NoInfer<T>, label: string, disabled?: boolean }[] }): Node` — segmented radio group |
| `slots` | `slots(count, { label?: (i) => string, width?: string /* default "7ch" */ }): Slots` — `.at(i)` content container, `.cell(i)` for `highlightNodes()` |
| `timeline` | `timeline({ domain: [a, b] \| () => …, ticks?, format?, labelWidth? }): Timeline` |
| `code` | `code(source, { lang: "ts" \| "shell" \| "diff" \| "text" }?): Code` — `yield* c.focus(3)`, `focus([2, 4], 7)`, `focus()` = all |
| `palette` | hex tokens: `bg bg1–bg4 gray fg fg0 fg2–fg4 red green yellow blue purple aqua orange` |

`choice` is a named radio group. Tab enters at the checked option (or first
non-disabled option when no value matches) and leaves the group in one stop.
ArrowRight/Down select and focus the next option; ArrowLeft/Up the previous,
wrapping and skipping `disabled` options. Home/End select and focus first/last.
Space (or Enter) selects the focused option. Directions follow option order,
including in RTL layouts; horizontal keys are not mirrored. Selection remains
signal-owned; external value changes update checked state and the tab stop.

`Timeline` methods (all positions accept numbers or functions):
`lane(label, ...marks): Node` (lane opacity also fades its label),
`bar(from, to, { hue?, pattern?: "solid" | "wait" | "gap", grow? }): Bar` (`bar.grow` 0..1 tween),
`dot(at, { ring?, hue? })`, `tick(at)`, `note(at, text, { hue? })`,
`marker(at, label?, { hue?, opacity? })`.

Every `hue` option accepts `Tone = Hue | (typeof palette)[Hue]`, where
`Hue = "bg" | "bg1" | "bg2" | "bg3" | "bg4" | "gray" | "fg" | "fg0" |
"fg2" | "fg3" | "fg4" | "red" | "green" | "yellow" | "blue" | "purple" |
"aqua" | "orange"`. Both `hue: "aqua"` and `hue: palette.aqua` resolve to
`var(--ps-aqua)`. Unknown values emit `console.error("puppet-show: unknown hue ...")`
and use visible red as a fallback; verify fails.

### Tokens and CSS layers

Foundations have three tiers: gruvbox **primitives** → **semantic roles** →
component tokens only when local tuning is useful (for example
`--ps-sequence-row-height`). `src/ui/tokens.ts` is canonical; tests check the
static CSS mirror and `palette` values. No runtime injection or extra asset is
needed: the single-file HTML build still inlines the stylesheet.

Authors use semantic roles in CSS, not raw palette colours:

| Purpose | Tokens (`--ps-` prefix) |
| --- | --- |
| Text | `text-strong`, `text-default`, `text-muted`, `text-subtle` |
| Surfaces | `surface-base`, `surface-raised`, `surface-sunken`, `surface-selected` |
| Borders | `border-default`, `border-strong`, `border-focus`; `border-decoration` for nonessential separators only |
| Emphasis | `accent`, `on-accent`, `prompt`, `value` |
| Content states | `state-hot`, `state-live`, `state-dim`, `state-bad`, `state-ok` |
| Diagram lanes | `lane-blue`, `lane-purple` (aqua/green use live/ok) |

All listed text/state/lane roles pass 4.5:1 on all four standard surfaces;
meaningful borders and focus pass 3:1. `on-accent` is dark text on accent/state
fills, **not** ordinary surface text. `bg4` and raw `gray` remain compatible
primitives but are not accessible small-text roles. Existing `--ps-bg*`,
`--ps-fg*`, hue variables and `palette.*` keys retain their values for drawings
and colour tweens; the older `text`, `strong`, `muted`, `line`, `frame` names
are semantic aliases. Semantic variants lighten low-contrast colours without
changing those public primitives. Theme by remapping semantic roles on the
`.ps-deck` (or the embedding root), maintaining these contrast contracts.

Scales: `space-1/2/3/4/5/6/7/8/10/12/14/16/18/20/22/26/30` (px),
`border-width` / `border-width-strong` / `border-width-accent`, `radius` /
`radius-s`, `font`, `size` / `size-s` / `size-l` / `size-code`,
`duration-fast/base/slow`, `ease`, `z-edge/content/tooltip/overlay`,
`focus-ring`, `focus-offset`, `shadow-float`. CSS motion uses the duration
tokens; `prefers-reduced-motion` sets all three near zero. Fonts use swap.
Viewport limits and one-off diagram geometry are not spacing-scale tokens.

**Emphasis and contrast.** De-emphasised content must stay readable:
`emphasis.dim` (`--ps-opacity-dim`, 0.84) is the lowest opacity at which every
text role still passes AA on base/raised/sunken surfaces, and `code.focus()`,
`dim()`, `spotlight()` and revealed `ask()` options use it. To mark something
inactive, change its colour to `state-dim` rather than fading it further. In JS,
`semantic["state-bad"]` etc. give the roles as hex for colour tweens; use them
over raw `palette.*` hues for text. `verify` checks settled text contrast; it
exempts natively `:disabled` controls, `ghost()` copies (`aria-hidden` +
`inert` duplicates), and elements with `data-contrast-exempt="<reason>"`, for
demos whose subject *is* low opacity.

| export | signature | notes |
| --- | --- | --- |
| `semantic` | `Record<TextRole, hex>` | `text-*`, `state-*`, `lane-*`, `accent`, `prompt`, `value` |
| `emphasis` | `{ dim: number }` | readable de-emphasis opacity |

Layer order is `puppet-show.reset, puppet-show.tokens, puppet-show.base, puppet-show.states,
puppet-show.components, puppet-show.utilities`. Generic content meaning classes
`.ps-hot/.ps-live/.ps-dim/.ps-bad/.ps-ok` (including `.flag(...)`) live **before**
components. Content components opt into them explicitly; controls declare their
own presentation and use ARIA selection (`aria-checked`, `aria-current`), so
meaning classes do not replace control state. Keep consumer `x-` CSS unlayered:
it overrides all library layers without specificity escalation or `!important`.
Importing the stylesheet alone does not reset the host document: html/body
reset rules require a directly hosted `.ps-deck`.

Layout classes: `.ps-grid.ps-cols-2` (two columns, stacks below 680 px),
`.ps-row` (flex row), `row(props, ...)`, `grid(columns, props, ...)` (no collapse).

## Keyed collections and tables

```ts
collection<T>({
  key: (item: T) => string,
  render: (item: Signal<T>, key: string) => Node,
  layout?: "row" | "column" | "wrap", gap?: string | number,
  update?: (node: Node, next: T, prev: T) => Task,
}) // Node with .set(items, durationOrOptions?): Task and .node(key)
// CollectionSetOptions = { duration?: number, enter?: (node: Node, key: string) => Task }
// .set(items, 0.8) and .set(items, { duration: 0.8 }) are equivalent.
```

The collection starts empty. `yield* list.set(items)` reconciles by unique key;
repeat keys fail loudly. Each render gets a stable item signal which updates on
set, so use reactive children (`chip(() => item().label)`). Surviving nodes keep
their identity **within the run**. Exits fade and collapse over the first 20%;
then entries grow into their natural size while survivors reorder via FLIP over
the remaining 80%. Columns/tables animate height; rows/wrap animate width
(wrap line breaks are discrete). Gaps open/collapse with the items. Temporary
inline sizing is restored afterwards so responsive reflow remains natural.
`update` animates survivors alongside growth. `enter(node, key)` replaces the
default entering fade; its node is already mounted/addressable via `.node(key)`
or `.row(key)` and its slot is growing. Both hooks run during seek too; longer
hooks extend playback and seeking equally. A zero-duration set skips hooks.
Default layout is column with a `0.5em` gap.
While seeking the final structure is applied instantly, but the task still
consumes its duration. Do not keep physical references across deck navigation.
Use module-scope, key-owned signals for durable state (see Deck below).
Recipe: `recipes/gallery/scenes/04-collections.ts`.

```ts
table<T>({
  columns: { key: string, label: Child, width?: string,
             align?: "left" | "center" | "right" }[],
  rows: T[] | (() => T[]),
  key: (row: T) => string,
  cell?: (row: T, column: TableColumn) => Child,
  rowClass?: (row: T) => string,
}) // Node with .set(rows, durationOrOptions?): Task and .row(key)
```

Rows and cells react to data. The default cell reads the column key from the row.
Use `yield* t.set(nextRows)` for animated keyed updates and reorders;
`yield* chain(highlightNodes(t.row("B")!))` focuses a row until the next beat. A reactive `rows` source updates
immediately (no automatic animation in an effect). Keep labels and values short:
compact cells fit a half panel at 720px; at 420px, oversized data scrolls
horizontally **inside the table wrapper**, never the page. Shared column sizing
uses CSS subgrid (modern browsers), with a column gap. A column `width` is a
**minimum CSS breadth**, not an exact track: `minmax(width, max-content)` lets
nowrap headers and values grow without spilling into neighbours. Omit it for
content-sized tracks sharing spare space. Legacy `minmax(...)`/`fit-content(...)`
track strings remain accepted; cells retain intrinsic max-content minima.
Plain scrollable tables are allowed; keep highlighted rows and all their cells
visible without scrolling.
See the collection recipe for a linked choice → timeline → table inspector.

### Insert into a table

No `set(rows, 0)` + hidden row + reveal workaround is needed. The entering row
itself is the flight target. Match the flight to the growth phase (80% of the
set duration), and let `land` reveal it:

```ts
yield* t.set([...rows, { id: "7", value: "Elm" }], {
  duration: 1,
  enter: row => fly(source, row, "id 7", {
    duration: 0.8, land: true,
  }),
});
```

Any mounted Node can be a moving flight target, not just a table row.

## Byte windows

`slots.mark(className: string, predicate: (i: number) => boolean): void` installs
a reactive flag on each cell. It reserves all cells and does not change layout:

```ts
const start = signal(1); // inside the scene: replayable motion
const bytes = slots(8, { width: "3ch" });
bytes.mark("ps-live", i => i >= start() && i < start() + 3); // [start, end)
yield* start(4, 1);
```

Use `Math.round(start())` in the predicate for discrete byte boundaries during a
tween. `width` is the minimum cell width including padding; cells wrap as needed.
Recipe: `recipes/gallery/scenes/06-window.ts`.

## Sequence diagrams

```ts
seqDiagram({ hosts: { id: string, label: Child }[], rows: number })
diagram.message(fromId, toId, label, {
  at: number, lost?: boolean, tone?: Tone, draw?: number,
}) // Edge-like: .draw, .color and .opacity signals
```

Hosts have lifelines over a shared downward-time row grid. A message goes from
row `at` to row `at + 1`; `lost: true` stops midway with a red ×, never at the
receiver. IDs and row indices are checked loudly; self-messages are rejected
(loop geometry is not supported). Reserve rows upfront, add the
diagram to the view, and animate `yield* m.draw(1, 0.4)` after `draw: 0`.
`tone` accepts the same exact `Tone` union as timeline hues. `.color` tweens use
hex starts/targets, like `connect`. Geometry follows layout and resizes at both
720px and 420px. Recipe: `recipes/gallery/scenes/05-sequence.ts`.

## Composable blocks

Blocks are optional capabilities, not a scene structure. They work with the
current `View` and ordinary signals/tasks; the deck shell is not required.
For a custom shell, create `new View(host)` and call `setView(view)` in the
player's mount callback; own each run with the player's cleanup scope.
Recipes: `recipes/gallery/scenes/07-blocks.ts` and `08-temporal.ts`.

### Quiet text motion

```ts
textMotion(node: Node, options?: TextMotionOptions): TextMotion
// .in(): Task; .out(): Task; .swap(next: string): Task
countText(node: Node, options: CountTextOptions): { to(value: number): Task }
```

`TextMotionOptions`: `text?: Source<string>` (default `node.text`),
`split?: "words" | "characters" | "lines"` (words),
`mode?: "rise" | "type"` (rise), `markup?: boolean` (false),
`reserve?: readonly string[]`, `duration?: number` (0.3 s per unit),
`stagger?: number` (0.05 s). Rise is 4 px with `outCubic`; swap is an
`inOutCubic` cross-fade. Type reveals graphemes with a non-blinking caret only
while typing. Lines mean explicit newlines, not measured/wrapped browser lines.

Use word rise for a short heading, characters sparingly for a short label, and
terminal type for a command. No blur, bounce or scramble: legibility comes first.
Create the controller before the first yield to reserve the full text immediately.
Every unit stays in flow, even when hidden. Supply **all** future strings in
`reserve` for swaps and reactive source updates; unknown strings throw rather than
silently changing layout. Reserved phrases share a grid cell (maximum size).
`swap` changes the presentation, not the caller's source signal. A subsequent
source update takes precedence. Do not concurrently update a source and swap it.

The helper owns children of any text-only Node; do not use it on controls or
nodes containing interactive children, or combine it with reactive child/HTML
bindings. To animate reactive text, pass `text: () => value()` (or update
`node.text`); changes update instantly unless explicitly animated. `markup: true`
preserves caption `code` and *emphasis* syntax; existing DOM inline markup should
be supplied as caption markup instead. The container exposes full plain text via
`aria-label`; visual layers are `aria-hidden`. There is no per-character live
region announcement. Reduced motion settles instantly. Tasks are seek/replay-safe.

`CountTextOptions`: `width: number` (required reserved `ch` capacity),
`from?: number` (0), `format?: (number) => string` (rounded integer),
`duration?: number` (0.9 s, `inOutCubic`). Tabular digits and a fixed width keep
neighbours still; reserve enough for signs, units and every formatted intermediate
value. Targets exceeding width throw. Accessible text updates once at completion.

**Do/don't:** animate text in once per step; don't animate body captions.
Recipe: `recipes/gallery/scenes/09-text.ts`.

### Input

```ts
ask<T extends string>({
  prompt: string,
  answer: Signal<T | null>, // module scope; null = unanswered
  options?: readonly { value: T, label: string, disabled?: boolean }[],
  input?: { placeholder?: string, label?: string },
  explain?: (answer: T) => string,
  kind?: string,      // heading, default "question" ("predict", "check", …)
  required?: boolean, // default false
  correct?: T | T[],  // used only by reveal(); nothing is graded before it
  feedback?: (answer: T | null) => string, // shown in place by reveal(); caption markup
}): Ask<T>
// ask.reveal(duration = 0.35): Task — mark picked ✓/✗ and the expected option,
//   lock the options, fade in feedback. ask.revealed: Signal<boolean> (scene state).
pendingAsk(): Ask<string> | null // first unanswered question on screen (reactive)
until(source: Signal<T> | (() => T), predicate: (value: T) => boolean): Task
```

Supply exactly one of `options` or `input`. `Ask` is a Node exposing `.answer`,
`.answered(): boolean`, and `.wait(): Task`. Options are controlled radios;
free text commits on form submission. `explain` is optional reactive text,
not a correctness check. Answers must be caller-owned signals declared outside
scenes to survive reconstruction. Waiting skips while seeking without writing an
answer or displaying fabricated feedback. This also lets the player's analysis
find subsequent beats. `until` has the same seek-skipping behavior; use core
`waitUntil` for simulation conditions that must run during seeking.

Deck integration (no scene code needed): while an unanswered question is on
screen and the step is paused, the primary button reads `answer ↓`. The first
next press (button, →, space) scrolls to the question and flashes it instead of
advancing; the button then reads `skip →` and a second press continues. With
`required: true` the button reads `answer first ↓` and never skips. Number keys
`1–9` pick options of the pending question. Options are `button[role=radio]`
with `aria-checked`; the question root has `.ps-waiting` / `.ps-done`, and after
`reveal()` `.ps-revealed` plus `.ps-right` / `.ps-wrong` / `.ps-unanswered`.
The named answer radio group uses the same single Tab stop, wrapping arrows,
Home/End, Space/Enter, and disabled-option skipping as `choice`. Arrows **select
as well as focus** (APG radio behaviour): an answer is committed immediately,
just like a click or number key, but remains editable until `reveal()`. This
avoids a separate uncommitted keyboard-only answer state. After reveal, options
announce `aria-disabled="true"`; the checked option (else first enabled option)
remains the Tab stop and arrows can still focus options for review, but clicks,
Space/Enter, arrows and `.pick()` cannot change the answer. Statically disabled
options are always skipped. The shared behaviour module is internal, not an
author API; both public controls retain their options-object conventions.

A revealed question is no longer pending. Keep the question on screen through
the reveal so the outcome sits next to the choice that produced it.

### Attention and annotation

| export | signature / capability |
| --- | --- |
| `note` | `note(target: Node, text: Child, { side?: "top" \| "bottom" \| "left" \| "right", tone?: Tone, gap?: number }?): Node` — automatically attached overlay annotation, follows target layout |
| `label` | `label(target: Node, text: Child): Node` — compact top annotation |
| `highlightNodes` | `highlightNodes(...nodes: Node[]): Step` or `highlightNodes({ tone?: "hot" \| "ok" \| "bad" \| "live" }, ...nodes): Step` — default hot; restores prior flags at the next beat |
| `dim` | `dim(...nodes: Node[]): FocusTask` — fade only these nodes over 0.3 s |
| `spotlight` | `spotlight(...nodes: Node[]): FocusTask` — fade sibling branches, preserving targets and their ancestors |
| `term` | `term(word: string, definition: string): Node` — inline focusable hover/focus definition |
| `glossary` | `glossary(): Node` — reactive list of terms constructed in this scene run |

Use `highlightNodes()` for "what to look at now", including table rows/cells:
`yield* chain(highlightNodes(row), waitFor(0.4));`. It sets emphasis when the Step
executes and restores it when execution reaches the next explicit `beat()`.
Replay/seek reconstruct this run-local state. Use `.flag("ps-hot")` only for
state that should persist. The name avoids the existing code `highlight()` export.

Run a focus task with `yield* focus`; restore with
`yield* focus.restore(duration = 0.3)`. `dim` preserves the original opacity;
`spotlight` composes with existing CSS filters. Selection is captured at task
creation; create the task after mounting the target nodes. Notes/labels expose
normal opacity/motion signals and automatically reset with the view. Annotation
text is also exposed to assistive technology at the target. Overlay annotations
do not reserve space: leave room for them in the layout. Glossary vocabulary is
run-local, deduplicated by word; build terms before or after the glossary block.

### Temporal checkpoints

| export | signature / capability |
| --- | --- |
| `ghost` | `ghost(source: Node): Ghost` — faded inert snapshot in a grid anchor preserving the source's original cell; source must already be mounted |
| `trail` | `trail(source: Node): Trail` — path strip of logical `x`/`y` transform offsets, not measured layout positions |
| `delta` | `delta<T>(source: Signal<T>, {format?: (value:T)=>string}?): Delta<T>`; Node overload reads rendered text and returns `Delta<string>` |
| `history` | `history(source: Signal<number>): History` — numeric sparkline of explicit checkpoints |

All four expose `.capture(): Task` and synchronous `.clear(): void`.
Ghost captures once immediately; the other blocks start without samples (delta
starts with the current baseline). Add trail, delta and history wherever they
belong in the layout. Ghost inserts its anchor automatically at the source.

```ts
const past = ghost(node); // after mounting node
const changes = delta(value);
const samples = history(value);
view.add(changes, samples);
yield* value(7, 0.8);
yield* changes.capture(); // old → new
yield* samples.capture(); // append 7
```

Sampling is explicit rather than per-frame: invoke captures after selected
changes or at step boundaries. This produces the same samples at different
frame rates and when seeking with effects held. Ghost materializes reactive
text/styles before cloning; no layout is measured. Clones are inert, aria-hidden
and ID-free. Inherited ancestor styles remain inherited, not computed/frozen.

`Trail.points` and `History.values` return readonly snapshots. Trail ignores
layout/ancestor movement; it visualizes the node's own transform offsets.
`Delta.previous` / `.current` expose successive checkpoints; unchanged values
show only one value. `delta.clear()` resets its comparison baseline; the other
clear methods remove samples/copies without removing the block. History requires
finite numeric samples; trail requires finite coordinates.
Recipe: `recipes/gallery/scenes/08-temporal.ts`.

### Composition and orientation

| export | signature / capability |
| --- | --- |
| `region` | `region(name: string): Region` — named section, no imposed layout |
| `stages` | `stages(count: number): Stages` — independent surfaces in one scene |
| `compare` | `compare({left: Child, right: Child, vary?: Child}): Stages` — two-surface shorthand; `vary` is an optional descriptive label |
| `minimap` | `minimap(parts: readonly {id: string, label: string}[], active?: Signal<string>): Minimap` — persistent-in-the-scene map, `.active` drives its highlight |

`Region` exposes `.fill(...children)` (replace and restore visibility), `.clear()`
(remove contents but retain the region), `.collapse(value = true)`,
`.collapsed: Signal<boolean>`, and `.retire(duration = 0.3): Task` (fade, then
collapse and release layout space). Retirement is reversible by `fill`.

`Stages` exposes `.areas: readonly Node[]` and `.at(index): Node`. A positive
integer count is required and out-of-range access throws. Shared signals and
parallel tasks synchronize areas: no extra scene clocks or players are created.
Surfaces wrap responsively. Minimap IDs must be unique; the map does not navigate
or dictate a step model. Supply a module-scope active signal if its value is
learner-controlled and must persist across replay.

## Deck

```ts
deck(host, {
  path?, start?, chapters: { title, id?, scene: (view) => Task }[],
  hash?: boolean | "push", // default true; false leaves app routing alone
  caption?: "top" | "bottom" | "none", // default top
  captionMotion?: "rise" | "type" | "none", // default "rise"
  captionTyped?: boolean, // legacy: same as captionMotion: "type"
  tabs?: boolean, meter?: boolean, // default true
  footer?: string | false, // false omits entire footer
  depth?: boolean, // false suppresses the optional depth toggle
}): Deck
yield* narrate(caption, ...steps)   // set caption while steps run, wait for both
yield* say(caption, { motion?, typed?, duration? }) // word rise by default
useDeck()                           // current deck: .players, .seeks, .chapter, …
```

Captions rise in by default: words fade and lift 4px left to right, the whole
caption settling in 0.2–0.45s, so reading is never held up and line breaks never
change. `captionMotion: "type"` (or legacy `captionTyped: true`) types with a
cursor; `"none"` is instant. Per call: `say(text, { motion: "none" })`,
`say(text, {typed: true, duration: 0.6})`; `say(text, {typed: false})` is always
instant. Reduced motion is always instant. The legacy numeric overload
`say(text, 0.6)` still types. `narrate` honors the deck default. Set caption to
`none` and compose `note` for anchored captions; narration tasks still run.
Tabs, meter and footer can be omitted independently; keyboard navigation remains.

`depth: Signal<Depth>` is a module-scope learner preference, where
`Depth = "intro" | "standard" | "deep"` (default standard). A scene reads
`depth()` directly in its generator to include/skip content or beats. The deck
shows its toggle only when such a read is detected, unless `depth: false`.
Deferred callback/effect-only reads do not declare structural depth usage.
Changing depth reconstructs/reanalyzes all chapters in an opted-in deck,
updates their step counts, and seeks to the same uniquely named step (or the
clamped current index when unnamed/missing). It then rewrites the hash. Learner-owned
signals remain unchanged. This is a capability, not a required level model.

### Step deep links

By default one deck per document owns `#<chapter>/<step>`. A chapter uses its
explicit `id`, or a lowercase title slug (non-alphanumerics become `-`, trimmed;
collisions get `-2`, `-3`, including collisions with explicit ids). An empty slug
becomes `chapter`. Explicit ids must be nonempty, nonnumeric and unique.
The step uses its unique, nonempty **ending beat's name**: narration followed by
`beat("hash-collision")` names that narration's step, not the following step.
Unnamed/duplicate beats and the implicit final segment use 1-based positions.
Components are percent-encoded, so names may contain spaces or `/`.

Readers also accept `#3` (chapter 3's start), `#3/2`, `#chapter-slug` and
`#chapter-slug/2`. Numeric tokens are reserved for 1-based positional aliases:
**numeric beat names use positional fallback**, numeric-only title slugs get a
`chapter-` prefix, and numeric explicit ids are rejected. This disambiguation is
necessary to keep every generated link round-trippable alongside numeric aliases.

On construction the fragment overrides the zero-based `start` chapter option.
An invalid/unknown fragment silently falls back to `start` and is canonicalized.
Landing plays the step from its start, just like a meter click; reduced motion
settles at its end. Deep links and meter clicks can both bypass unanswered required
questions (only Next gates on them). Location is read only on construction or URL
navigation, never during a scene/replay.

Navigation replaces history without scrolling. `hash: "push"` instead pushes
changed steps so Back/Forward navigates them; initial/invalid-link canonicalization
always replaces. Editing the fragment or clicking an in-content anchor navigates
the deck. `hash: false` disables both reading and writing for app-owned routing.
Only the first hash-enabled deck binds; later ones warn to pass `hash: false`.
History writes are guarded for `file://` and sandboxed/opaque-origin iframes;
if disallowed, navigation still works but the URL cannot be updated. In a Notion
HTML block, the fragment belongs to the iframe, not the outer Notion page URL.

`deck.href(chapter, step = 0)` builds a fragment. Numbers are zero-based indices;
strings are chapter ids/derived slugs and step names (or positional tokens for
unnamed steps). Named forward links work even during scene analysis; names are
not validated by the helper. Numeric steps use their canonical names when analyzed,
otherwise positional aliases. Unknown chapters and invalid numeric indices throw.
For in-content links use
`el("a", { attrs: { href: useDeck().href(0, "hash-collision") } }, "Collision")`.
Caption markup: `` `code` `` and `*emphasis*` only; Markdown links are not supported.
Keys: `←/→ space enter` step, `r` replay, `s` slow-mo, `Home`. Keys typed into
inputs, buttons or radio groups belong to that control.
Next/`→` while a step is playing finishes that step first; it does not start
the following step. Rapid presses therefore settle each step rather than skipping
several, preserving a chance to see each resulting state.
Chapter tabs use a single-line horizontal scroller and a roving tab stop;
Left/Right and Home/End select chapters without scrolling the page vertically.
The footer's `1–9 answer` hint appears only in decks containing `ask()`.
The caption cursor exists only during typed captions, never at settled endpoints.
For automation, `choice` options are **button elements with `role="radio"`**
inside a `radiogroup` (query by radio, not button role). `slider` is an
`input[type="range"]` with an accessible label.

`data-verify-ignore` on an element excludes its subtree from `verify`'s
replay-equality check. Use it only for deliberately live values (timings).

Navigation to a deck step reconstructs the scene from scratch. Physical DOM
identity is guaranteed only within a live run, not between paused deck steps,
chapters or replay. Durable per-item state belongs in module-scope signals keyed
by item key, e.g. `const local = new Map([["B", signal(0)]]);` outside the scene.
Bind those signals in the item's render function; never rely on uncontrolled DOM
state to survive navigation.

**Verify cannot judge meaning.** Contact-sheet review is mandatory: look for
blank lanes, arrows reaching the wrong place, values that did not visibly change,
clipped text, overflow and layout jumps. `--quick` is only an inner loop;
full `npm run verify -- <name>` is the gate. Console errors and `puppet-show:` warnings
fail full verification. Verification uses a fixed **900px viewport height**
(the Notion block height), at 720px and 420px widths by default; full-page PNGs do
not imply below-the-fold content is visible. Settled checks reject text spilling
out of its own box (>1px) and highlighted content/cells clipped by auto/scroll
ancestors (>1px); ordinary unhighlighted scrollable tables remain valid. Tall
stages (height >900px or bottom below the viewport after deck chrome) are listed
per step/width in the summary and results.json, non-failing.
Live playback at each width observes overlay `.ps-fly` tokens: off-screen start
or landing centers (>1px tolerance) fail, as do document-height or inferred
target-rectangle shifts >4px during a flight. Target names are inferred from the
nearest pre-flight node center (within 16px), since tokens carry no target ID.
State waits stop immediately on scene errors; errors/timeouts include chapter,
step, deck state and collected page/console errors.

### Scene errors

`Player.error` is a `Signal<SceneError | null>`, where `SceneError` contains
`{ message: string, chapterStep: number, cause: unknown }`. `chapterStep` is
zero-based. Exceptions during analysis, seek or live play stop playback and set
this signal; starting a new run clears it. The optional `PlayerOptions.onError` callback
runs synchronously once per occurrence, including constructor-time analysis errors;
this lets shells report failures without losing batched signal updates.
Analysis retains the steps before the
failure plus the failing step, so other chapters remain navigable.

The deck shows a `ps-bad` error panel with the message and 1-based chapter/step,
sets `data-state="error"` and `data-error="<message>"`, and disables Next (including
keyboard Next). Previous and chapter navigation remain available; navigating back
reconstructs the scene normally. Each failure occurrence logs once:
`puppet-show: scene error in chapter N "Title" step K: <message>` (N/K are 1-based).

Automation hooks on `.ps-deck`: `data-state="playing|paused|error"`, `data-error` (only on failure), `data-chapter`,
`data-step`, `data-index` (global step), `data-total`.
