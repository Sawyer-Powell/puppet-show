# Portable explainer authoring

Work in your own project, not inside the puppet-show source repository. The
installed package includes this guide, the API, design guidance, and recipes.

```sh
npx github:Sawyer-Powell/puppet-show init my-explainer
cd my-explainer
npx github:Sawyer-Powell/puppet-show check
npx github:Sawyer-Powell/puppet-show build
```

The scaffold contains `index.html`, `main.ts`, `style.css`, and two scene files
in `scenes/`. It demonstrates a signal, a tween, and a flight in four steps.
All data is synthetic. `init` accepts a new or empty directory and refuses to
overwrite existing content. A project imports the package, never its source tree:

```ts
import { beat, signal, type Task, type View } from "puppet-show";
import "puppet-show/style.css";

export function* scene(view: View): Task {
  const value = signal(0);
  // Mount components using view.add(...), then animate their signals.
  yield* value(3, 0.7);
  yield* beat("changed");
  yield* value(0, 0.4);
  // Scene end is implicit: no final beat needed.
}
```

Register scene functions as `deck(document.body, { chapters: [{ title, scene }] })`.
A scene receives a `View` and returns a generator `Task`, not a DOM node or an
async promise. A named `beat` ends the preceding step; the implicit final segment
is another step. Use meaningful chapter IDs and beat names for deep links.

## Read the installed references

```sh
npx github:Sawyer-Powell/puppet-show docs
npx github:Sawyer-Powell/puppet-show docs api
npx github:Sawyer-Powell/puppet-show docs design
npx github:Sawyer-Powell/puppet-show docs design/research-and-patterns
npx github:Sawyer-Powell/puppet-show docs design/learner-evaluation.md
npx github:Sawyer-Powell/puppet-show docs recipes
npx github:Sawyer-Powell/puppet-show docs recipes/01-diagram.ts
npx github:Sawyer-Powell/puppet-show docs all
```

References are resolved from the installed package, not your working directory.
`design/<ref>` accepts a packaged reference basename, with optional `.md`;
`recipes/<file>` accepts an exact packaged `.ts` basename. Paths and traversal
are not supported. Printed recipes use bare `puppet-show` imports. The API and
design references also describe contributor tooling: their repository `npm run
verify`/`shot` commands are not the portable project workflow below.

## Iterate, check, and inspect

- `npx github:Sawyer-Powell/puppet-show scenes` lists step addresses.
- `npx github:Sawyer-Powell/puppet-show shot <address>` captures a step or chapter.
- `npx github:Sawyer-Powell/puppet-show check` is the **default fast gate**.
- `npx github:Sawyer-Powell/puppet-show sheets` makes sheets for visual review.
- `npx github:Sawyer-Powell/puppet-show build` produces self-contained HTML.

No project install or development server is required. Open the built HTML locally.

Open the generated shots and sheets; a passing check cannot judge meaning.
Inspect 720px and phone-width states, labels, changed values, arrow endpoints,
clipped text, empty lanes, and whether the explanation still works when motion
is reduced. Fix errors and warnings before handing off. Use the CLI's help for
command-specific options and artifact paths.

`npx github:Sawyer-Powell/puppet-show check --deep` is **slow and rarely needed**. Use it only when
investigating user reports that check, shot, and sheets did not uncover. It is
not the default authoring loop or a routine handoff requirement.

## Deterministic scenes

- A signal is a function: `x()` reads, `x(3)` writes immediately, and
  `x(3, 0.7)` returns a tween task. `yield*` runs it and waits; `yield task`
  forks it. A tween does nothing until run. `all` runs tasks in parallel.
- Animate through signal tweens and documented helpers. No scene timers, CSS
  transitions, `requestAnimationFrame`, Web Animations, wall-clock reads, or
  `Math.random()`: seek reconstructs the scene by deterministic replay.
- Initial visual state belongs in props, such as `{ opacity: 0, y: 8 }`.
- Scene-owned signals reset on replay. Durable learner inputs (answers,
  sliders, toggles) belong at module scope and are read reactively. Never rely
  on DOM identity between step navigation or replay.
- Use `fly(from, to, label)` for data motion. Mount endpoints and reserve target
  space first. Flights never scroll; both endpoints must be on screen.
- Use `highlightNodes` for step-scoped focus; persistent `.flag("ps-ok")` etc.
  represent state. Prefer `slots`, `collection`, `table`, `timeline`, `code`,
  `connect`, and `seqDiagram` to hand-built equivalents.
- Keep data synthetic. Never include PHI, customer data, secrets, or real IDs.

## Design with the learner in mind

Read `docs design` before expanding the starter. Name the intended learner and
what they should be able to explain or predict. Introduce concepts before
asking about them. Preserve visible evidence of changes; animation alone is
not an explanation. Choose a worked example, contrast, prediction, or transfer
question when it serves that goal, not to satisfy a fixed chapter template.

Use the package's components and semantic CSS roles:
`--ps-text-default/muted/strong`, `--ps-surface-base/raised/sunken`,
`--ps-border-default/focus`, and `--ps-state-hot/live/dim/bad/ok`.
Use spacing, type, border, radius, duration, and focus tokens rather than new
colours, fonts, shadows, or radii. Keep project CSS unlayered with an `x-` prefix.
Colour means current focus (hot), live value (live), inactive (dim), error/cost
(bad), or committed/done (ok); pair it with labels. Keep code lines short enough
for half-width panels and plan the hardest phone-width state early.

At handoff, identify the HTML artifact, checks run, sheets actually inspected,
learner goals, and limitations. Do not claim learning success from mechanical
checks alone.
