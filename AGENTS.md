# Authoring explainers with puppet-show

**Portable projects:** start with [`docs/authoring.md`](./docs/authoring.md), or
`npx github:Sawyer-Powell/puppet-show docs authoring` from an installed package.
Read `docs api` and `docs design` too. The default portable gate is fast
`npx github:Sawyer-Powell/puppet-show check`; slow
`check --deep` is rarely needed, only for user reports not found through check,
shot, or sheets. The workflow below is for this source repository's contributors.

Read this before writing or editing an explainer. It is the contract that keeps
explainers consistent and keeps you out of debugging loops. Signatures and
gotchas: [`docs/API.md`](./docs/API.md). Copyable recipes: `recipes/gallery/scenes/`.
Explainer design guidance lives in [`skills/explainer-design/SKILL.md`](./skills/explainer-design/SKILL.md), not in the runtime contract.

## Workflow

1. Copy `examples/puppet-show-explained/` to `examples/<name>/`; keep `index.html`,
   `main.ts`, `style.css`, `scenes/NN-topic.ts`. Examples are discovered by
   folder; no config edits needed. `recipes/gallery/` is the component
   catalogue (build/verify it by name like an example).
2. Inner loop by scene. `npm run scenes -- <name>` lists step addresses;
   `npm run shot -- <name> <chapter>` renders every step of that scene to
   full-size PNGs in ~1 s (one step ~0.6 s) with the cheap settled checks, and
   `--checks` adds the a11y audit. `npm run verify -- <name> --edit` does the
   same for exactly the steps whose scene changed, writes them where the gate
   expects them, reports a pixel diff per moved step, ~0.5 s when nothing
   changed and ~2-4 s after an edit. Both render by deep-link (cold seek), so
   durable module-scope input state is at its initial value; playback, flights,
   replay equality and 420px belong to the gate. `npm run verify -- <name>
   --quick` is only a typecheck/build smoke test. Call the scripts with `node
   scripts/shot.mjs` when even npm's ~0.2 s start-up matters.
   Gate: `npm run verify -- <name>` (note the `--`: npm swallows flags without it).
   A cold gate takes ~5 s because the 720 and 420 passes run concurrently
   and live playback runs on a fake clock (`--realtime` replays in wall time
   for timing debugging; the checks are identical). Results are cached per step
   against content hashes of the sources each step depends on
   (`shots/<name>/verify-cache.json`), so an unchanged deck re-gates in ~0.5 s
   without a browser and a one-scene edit re-verifies only that scene's steps
   (~4-7 s). Every re-captured step is printed under "Changed since the last
   verified run" with a percentage, a bounding box and a red-marked diff crop
   in `shots/<name>/diff/`. `--refresh` ignores the cache; edited shared sources
   (`src/`, CSS, `main.ts`) still invalidate the whole deck.
   It typechecks your example, builds `dist/examples/<name>/index.html`,
   screenshots every step at 720 px (Notion) and 420 px (phone), plays every
   step live with a mid-motion capture, checks that replaying a step lands on
   the same state as playing it, and writes contact sheets: 720 px sheets are
   per chapter at two columns so text stays readable; motion and 420 px sheets
   are deck-wide four-up grids. The viewport is
   900px high (fixed Notion block), even when PNGs are full-page. Live flights
   at each width must start/land on screen and keep document height/target
   geometry stable (4px tolerance). Settled checks reject text spilling into
   neighbours and highlighted content clipped by scroll ancestors; tall stages
   are reported, non-failing. Scene errors fail immediately; timeouts include
   deck state and page errors. Keep the stage within the viewport at 720px;
   flights must start and land on screen. Reserve target space before flight;
   `fly` never scrolls. Layout, spill and clipping checks run at every settled
   step and width; AA text contrast, names, radio state/roving tabindex,
   nested controls and duplicate ids are width-independent, so they run at the
   primary 720 px width only. First-step Tab navigation checks reachability
   and visible focus (roving radio/tab members intentionally share one Tab stop).
   `--no-a11y` is a debugging escape only, never valid for handoff.
   `npm run check` also gates design literals/token sync and public-export docs.
   Justified static-lint exceptions require `/* lint-design: allow <reason> */`
   on the offending line; do not use exceptions to hide missing semantic tokens.
3. Open the images it lists and look at them: the shot PNG while iterating, the
   contact sheets before handing off. Fix page errors, clipped
   text, layout jumps and replay mismatches before handing off. Verify cannot
   judge meaning: also check for blank lanes, arrows reaching the wrong place,
   and values that did not visibly change. Console errors and `puppet-show:` warnings fail.

## Scene rules

- A scene is `function* (view: View): Task`. `beat("name")` ends a step;
  the scene end is implicit. `narrate` and `say` are optional caption helpers.
  The deck is optional; blocks do not prescribe a step structure.
- Anything that animates is a signal tween or a puppet-show helper. Never use CSS
  transitions, `setTimeout`, `requestAnimationFrame` or Web Animations in a
  scene: they break seeking.
- Never read `Date.now()`/`performance.now()` in a scene. Scenes must be
  deterministic so replay reproduces the same state.
- Set initial visual state through props (`{ opacity: 0, y: 8 }`); tween
  signals for animation. Reserve layout space when motion requires stable bounds.
- State that must survive replays (sliders, toggles) is a signal declared at
  module scope; read it inside `effect()` or reactive props. Deck step navigation
  reconstructs the scene: DOM identity holds only within a run. Key durable
  per-item signals by item key at module scope.
- Never use `Math.random()`; use a deterministic hash of an index (see
  `recipes/gallery/scenes/02-inputs.ts`). `verify` catches replay mismatches.
  The only exception is deliberately live data (timings, session counters):
  mark that element `attrs: { "data-verify-ignore": true }` and nothing else.
- Use `fly(from, to, label)` to show data moving, `move()` to reparent into
  `slots()`, `connect(a, b)` for edges that follow motion, `timeline()` for
  anything over an axis, `code(src, { lang })` + `focus()` to walk through
  code, shell or diffs, `highlightNodes()` for step-scoped focus, `choice()` for
  discrete inputs and `slider()` for continuous ones. Use `collection()` for
  keyed enter/update/exit/reorder, `table()` for reactive keyed rows,
  `slots.mark(className, predicate)` for byte windows, and `seqDiagram()` for
  time-ordered host messages (including lost messages).
- Composable blocks (`src/blocks/`): `ask` / `until` for seek-aware input,
  `note` / `label` for anchors, `spotlight` / `dim` for reversible focus,
  `term` / `glossary`, `ghost` / `trail` / `delta` / `history`,
  `stages` / `compare`, `region`, and `minimap`. Signatures and lifecycle
  details: [API blocks](./docs/API.md#composable-blocks).
- Use `highlightNodes(...nodes)` for "what to look at now"; it clears at the next
  beat. Reserve `.flag("ps-hot")` for state that should persist across steps.
- Deck chrome and caption typing are configurable. Captions are instant by
  default; `say(text, { typed: true })` opts into typing. Default tween ease
  is `inOutCubic`.

## Design rules

- Use semantic `var(--ps-*)` roles in CSS: `--ps-text-strong/default/muted/subtle`,
  `--ps-surface-base/raised/sunken/selected`, `--ps-border-default/strong/focus`,
  `--ps-accent`, `--ps-on-accent`, and `--ps-state-hot/live/dim/bad/ok`.
  Primitive gruvbox values (`palette.*` in JS) are for drawing/tweens, not
  general text. `bg4` is decoration only. No new colours, fonts, shadows,
  gradients or radii. Foundations live in `src/ui/tokens.ts`; the static CSS
  mirror and allowed AA text/surface pairs are checked by `test/tokens.test.ts`.
- Use the spacing (`--ps-space-*`), border-width, radius, type (`--ps-size*`),
  duration (`--ps-duration-fast/base/slow`), easing (`--ps-ease`), z-index and
  focus-ring scales. CSS motion must use duration tokens (reduced motion
  overrides them); deterministic scene motion still uses signal tweens.
- Layer order is `puppet-show.reset, puppet-show.tokens, puppet-show.base, puppet-show.states,
  puppet-show.components, puppet-show.utilities`. Meaning classes precede components;
  controls use ARIA state, not meaning classes. Content components explicitly
  opt into `.ps-hot/.ps-live/.ps-dim/.ps-bad/.ps-ok`. Consumer `x-` CSS stays
  unlayered and overrides the library without `!important`. Theme by remapping
  semantic roles, not primitive palette values.
- Building blocks: `panel`, `box`, `chip`, `readout`, `slider`, `choice`,
  `slots`, `timeline`, `connect`, `code`, `.ps-grid.ps-cols-2` (collapses below
  680 px). Prefer these over new CSS. Example-specific CSS goes in the example's `style.css` with an
  `x-` prefix.
- Colour means something: `ps-hot` = yellow/current focus, `ps-live` = aqua/live
  or visible, `ps-dim` = gray/inactive or ignored, `ps-bad` = red/error, cost or lost,
  `ps-ok` = green/done or committed. Apply via `.flag()` on any node, including
  table rows and plain text. Distinguish lanes with blue/purple/aqua/green.
  Hue options accept token names or exact palette hex values (`Tone`); unknown
  values are errors. For automation, choice options are buttons with role=radio;
  sliders are input[type=range].
- Caption markup supports `code` in backticks and `*emphasis*`.
- Text inside code panels must fit a half-width panel at 720 px: keep lines
  under ~32 characters including indentation, with short trailing comments.
- Colour tweens need a hex start value: `node.css("color", palette.fg4)`, then
  `(palette.yellow, 0.3)`. Starting from a CSS variable or empty value retypes
  the string instead of blending (puppet-show warns in the console).
- Keep data synthetic. Do not put PHI or customer data in explainers.
