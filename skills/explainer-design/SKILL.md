---
name: explainer-design
description: Design, author, or review a puppet-show explainer for learning rather than animation alone. Use to plan learning goals, misconceptions, predictions and contrasts; choose composable teaching patterns; review contact sheets; or evaluate what a learner can explain and transfer.
---

# Explainer design

puppet-show is a powerful, composable, unopinionated toolkit. Teaching decisions live
here, not in runtime rules. Choose patterns for this learner and this concept;
there is no required chapter count, quiz cadence, caption position, or sequence.
A worked example, comparison, guided investigation, or compact reference can all
be appropriate. Omit a pattern when its cost exceeds its learning benefit.

## Start with the contract

Read the repository's `AGENTS.md`, `docs/API.md`, and relevant recipes in
`recipes/gallery/scenes/` before authoring. Those own technical requirements,
exact signatures, determinism, tokens and verification. This skill is not an API
reference. If a named capability is not in API.md, it is not a callable export.
Use documented primitives to express the pattern or report the missing capability.
Do not impose pedagogy on `src/`, the deck shell, or AGENTS.md.

## Plan the learning, then the motion

1. **Name the learner and the performance.** What do they already know? Write
   one to three observable goals: “predict the next ACK and justify it,” not
   “understand TCP.” State scope and what this model deliberately leaves out.
2. **List the competing models.** For each likely misconception, identify an
   observable case where it predicts a different result. Use a brief pre-quiz
   when prior knowledge is uncertain; do not infer expertise from job title.
3. **Order concepts by dependency.** List every concept the explainer uses and
   what it depends on (e.g. value on screen → signal → tween → task → scene →
   player → replay). Introduce each one concretely (show it working, then name
   it) before anything uses it. Novices start with a worked example, not a
   question: they have no model yet to predict with.
4. **Choose prediction points.** A question may use only concepts already
   shown *and* named, in words already introduced; its point is to apply that
   model to a case not yet seen. Before a revealing transition, consider `ask`
   or a prompted `choice` plus an explanation request. Ask for a consequential
   prediction, not trivia. Decide what feedback will repair each wrong model,
   again only in introduced terms. If a learner could only guess, show a
   worked example first and ask afterwards about a new case.
5. **Choose contrasts.** Hold the system, scale and starting state fixed; vary
   one relevant feature. Consider `compare` or `stages`, or replay with a
   controlled input. Include a boundary or counterexample, not just successes.
6. **Choose a sequence and an attention budget.** Decide which terms need
   pretraining, which example needs guidance, and where support can fade.
   For each moment, name what changes, what remains visible, where the learner
   should look, and what can retire. Sketch the hardest 420px state early.
7. **Define evidence before implementation.** Draft a new-case transfer question
   and its scoring rubric. Separate “the page works” from “the learner learns.”

A small planning note can use this shape (adapt or omit columns):

| goal / misconception | prediction or task | visual evidence / contrast | feedback / transfer check |
| --- | --- | --- | --- |
| ACK means next missing byte, not last packet | predict ACK after out-of-order arrival | gap persists while later bytes buffer | explain why the ACK does not advance; solve a new gap |

## Choose patterns, not a template

Read [research and patterns](references/research-and-patterns.md) for each
principle's rationale, block mapping, small pattern, failure mode and trade-off.
Research supports design hypotheses, not a guarantee for every audience.

| learning need | candidate puppet-show vocabulary |
| --- | --- |
| retrieve, predict, explain | `ask`, `choice`, `until`, signals; feedback composed separately |
| attach meaning to evidence | `note`, `label`, `spotlight`, `dim`, `code.focus`, semantic flags |
| keep change inspectable | `ghost`, `trail`, `delta`, `history`, `timeline` |
| compare competing models | `compare`, `stages`, synchronized signals, `table` |
| learn terms and keep bearings | `term`, `glossary`, `minimap` |
| control density and guidance | `region`, `region.retire()`, `depth`, configurable deck chrome |
| make mechanisms visible | `fly`, `move`, `connect`, `collection`, `slots`, `seqDiagram` |

Capabilities do not determine teaching use. A slider can support a precise
experiment or idle fiddling; an `ask` can elicit a causal model or merely demand
a click. Keep the learning task explicit. `waitFor` is a timed wait, not a
learner-response gate. `ask` requires an outside-scene answer signal initialized
to `null`; `ask.wait()` and `until` skip waits during seek without fabricating
answers. Use `waitUntil` for simulation conditions that must run during seeking.
Feedback is composed explicitly; `explain` text is not correctness scoring.
Learner state must survive replay as the API specifies.

## Author around attention

- Put interpretation near its evidence. Use anchored `note`/`label` when a top
  caption would require searching; use a top caption when it genuinely orients
  the whole scene. Avoid restating it in every panel title.
- Show the thing claimed: change the actual item's value, not only an operation
  log. Keep source/destination and the relevant before-state inspectable.
- Prefer instant text for instructions that must be read before motion. If
  typing serves a purpose, separate reading from the critical transition.
- Keep only useful context. Retire completed regions rather than accumulating
  panels; preserve a compact invariant, ghost, or minimap if needed.
- Pair colour with labels, geometry or patterns; put the key beside its marks.
  Palette compliance alone does not make adjacent encodings distinguishable.
- Give inputs a task: “predict which row becomes visible; switch the snapshot;
  explain the difference.” Add constraints or worked guidance for novices.
- Let experienced learners skip redundant support (`depth`, optional terms or
  reference views). Do not hide essential causal evidence behind an “advanced”
  option. No pattern requires a deck or forces a particular shell.
- `compare`/`stages` supply areas, not separate simulations: drive their cases
  with shared signals/tasks. `minimap` orients but does not navigate; `glossary`
  lists terms constructed in the current scene run, not session-wide history.

## Review and evaluate

A mechanical pass cannot detect an empty explanation.

Prerequisite audit: for every question, caption and feedback line, list the
terms and concepts it relies on and the step where each was first shown and
named. Anything used before it is introduced is a defect: reorder, introduce it
concretely, or cut it. Read the first screen as a newcomer would: it must make
sense with no prior knowledge of the system.

1. Iterate by scene: `npm run scenes -- <name>` lists step addresses and
   `npm run shot -- <name> <chapter>` renders the scene's steps to full-size
   PNGs in ~1s (`npm run verify -- <name> --edit` re-renders just the changed
   steps, ~2-4s); look at the PNGs, fix, re-shoot. Full
   `npm run verify -- <name>` (~5s cold, ~0.5s unchanged) is the technical gate;
   `--quick` (typecheck + build, ~1s) only catches typos between visual passes.
2. Open the generated 720px, 420px and motion sheets. Compare adjacent states;
   inspect uncertain frames at full size and play critical transitions live.
   Exercise alternate input states, keyboard navigation and replay too.
3. Independently review meaning, attention, accessibility and every learning
   claim. Record concrete step-level findings; repair, rerun, and reinspect.
4. Use [learner evaluation](references/learner-evaluation.md): before/after quiz,
   new-case transfer and a learner agent restricted to the built HTML and/or
   screenshots. Treat agent results as formative evidence, not human validation.

Hand off: artifact path, intended learner/goals, selected patterns and important
trade-offs, technical verification, sheets actually inspected, semantic fixes,
learner evidence (or explicitly “not evaluated”), and remaining limitations.
Do not report “teaches successfully” merely because verification passed.
