# Research → design hypotheses → puppet-show patterns

Use this as a selection guide, not a checklist of mandatory features. Studies
vary in audience, material, outcome and setting; an effect in prose learning or
classroom instruction is not direct evidence that a particular DOM block works.
Evaluate the learning task, not the presence of the block. Exact APIs live in
`docs/API.md`.

## Retrieval and prediction

**Principle:** retrieve a relevant model before showing the answer.
**Why:** effortful retrieval can strengthen later retention more than repeated
study. Prediction also exposes a competing model, but prediction about something
not yet learned is not the same intervention as retrieval practice.
**Blocks:** `ask`, `choice`, `until`, durable signals; separately composed
feedback via `note`, `label` or an evidence region.
**Pattern:** before a read, ask “80 or 95, and why?” Commit a response, then run
the read, link the visible row to the returned value, and explain why the
alternative fails. Later ask about a new schedule without the hint.
**Prevents:** recognition masquerading as recall; watching an obvious reveal.
**Trade-off:** constant gates interrupt inspection. Use questions at genuine
model forks; allow a considered “not sure.” Do not reveal correctness merely
because seeking crosses an unanswered prompt; respect `ask`'s replay contract.

Source: Roediger, H. L., & Karpicke, J. D. (2006). *Test-enhanced learning:
Taking memory tests improves long-term retention.* Psychological Science,
17, 249–255. https://doi.org/10.1111/j.1467-9280.2006.01693.x

## Self-explanation

**Principle:** ask learners to explain a causal step, not just name an outcome.
**Why:** generating an explanation can connect a worked step with underlying
principles and expose missing inferences.
**Blocks:** `ask` with input, `note`, `code.focus`, `connect`.
**Pattern:** focus the stopping condition of a probe, ask why an empty bucket
ends the search, then connect that condition to the visible bucket. Offer a
model explanation after the attempt, not while it is being composed.
**Prevents:** correct guesses and fluent paraphrases hiding a wrong mechanism.
**Trade-off:** novices may generate plausible errors; use targeted prompts and
corrective evidence, not an unbounded “explain everything.”

Source: Chi, M. T. H., de Leeuw, N., Chiu, M.-H., & LaVancher, C. (1994).
*Eliciting self-explanations improves understanding.* Cognitive Science,
18, 439–477. https://doi.org/10.1207/s15516709cog1803_3

## Animation and transient information

**Principle:** animate a relationship that matters, and preserve evidence needed
to compare states.
**Why:** animation is not inherently better than a clear static diagram. Salient
motion can attract attention to the wrong feature, and disappeared states force
mental reconstruction. Tversky and colleagues emphasize apprehension and
congruence; Lowe shows that learners may select perceptually salient rather
than conceptually important animation information.
**Blocks:** `ghost`, `trail`, `delta`, `history`, `timeline`, `spotlight`, `dim`,
`fly`, `connect`; replay/step controls.
**Pattern:** ghost the old window edge, animate the ACK advancing it, show a
`delta` beside the edge, then clear the ghost once comparison is complete. Use a
trail only when route history is meaningful, not as decoration.
**Prevents:** “something moved” without knowing what changed or why.
**Trade-off:** retained traces can become clutter. Choose a static before/after
or a single highlighted difference when motion adds no causal evidence. Inspect
reduced-motion endpoints as an explanation in their own right.

Sources:
- Tversky, B., Morrison, J. B., & Betrancourt, M. (2002). *Animation: can it
  facilitate?* International Journal of Human-Computer Studies, 57, 247–262.
  https://doi.org/10.1006/ijhc.2002.1017
- Lowe, R. K. (2003). *Animation and learning: selective processing of
  information in dynamic graphics.* Learning and Instruction, 13, 157–176.
  https://doi.org/10.1016/S0959-4752(02)00018-X

## Contiguity, signaling and coherence

**Principle:** place essential explanation near the evidence, coordinate its
timing, signal the relevant relation, and remove competing nonessential material.
**Why:** integrating separated sources consumes working-memory resources;
coherence and signaling help selection and organization. Mayer's multimedia
principles are not “add more media”: words and pictures should complement one
another. A top caption is not inherently wrong; costly integration is the issue.
**Blocks:** anchored `note`, `label`, `spotlight`/`dim`, `region.retire()`,
`code.focus`, configurable caption position and instant `say`.
**Pattern:** label “next missing byte” at the ACK value while highlighting the
gap, not at a distant legend. Present the instruction before the critical
motion. Retire the handshake panel when explaining recovery, retaining only
needed host identities.
**Prevents:** split attention, racing typed text, decorative motion, panel piles.
**Trade-off:** too many callouts obscure the object. A stable nearby paragraph
can be better for sustained reading. Do not apply narration/redundancy findings
as a blanket ban on accessible text or captions in a silent HTML explainer.

Sources:
- Mayer, R. E. (2021). *Multimedia Learning* (3rd ed.). Cambridge University
  Press. https://doi.org/10.1017/9781316941355
- Chandler, P., & Sweller, J. (1991). *Cognitive load theory and the format of
  instruction.* Cognition and Instruction, 8, 293–332.
  https://doi.org/10.1207/s1532690xci0804_2 (split-attention work).

## Contrasting cases and variation

**Principle:** make the relevant difference discernible against stable context.
**Why:** contrasting cases can prepare learners to notice important dimensions
and benefit from later explanation. Variation theory emphasizes discerning
critical aspects through variation and invariance; neither implies that every
pair should differ in exactly one variable in all phases of learning.
**Blocks:** `compare` or `stages`, shared signals, `delta`, `table`, `choice`.
**Pattern:** synchronize two schedules with identical transactions and scales;
change only commit order, predict the read, then highlight what changes and what
stays invariant. Later vary both snapshot and order to test generalization.
**Prevents:** attributing an outcome to incidental differences or memorizing one
example as the rule.
**Trade-off:** side-by-side views consume width. Sequential controlled replay or
stacked aligned cases may work better at 420px. Explain the comparison after
learners have a chance to inspect it; contrast alone may not teach the principle.

Sources:
- Schwartz, D. L., & Bransford, J. D. (1998). *A time for telling.* Cognition
  and Instruction, 16, 475–522. https://doi.org/10.1207/s1532690xci1604_4
- Marton, F., & Tsui, A. B. M. (2004). *Classroom Discourse and the Space of
  Learning.* Lawrence Erlbaum Associates. (Variation and discernment.)

## Prior knowledge, organizers and pretraining

**Principle:** establish the few entities and relations needed to interpret the
mechanism before demanding simultaneous integration.
**Why:** an organizer can connect new material to relevant prior knowledge;
Mayer's pretraining principle addresses knowing component names and properties.
These are related tools, not the same intervention.
**Blocks:** `term`, `glossary`, `minimap`, `label`, `region`, optional `depth`.
**Pattern:** introduce “snapshot,” “creator,” and “superseder” on the actual row;
keep an optional glossary and a compact system map with a current-location
signal as the read travels through the system.
**Prevents:** decoding unfamiliar vocabulary while missing the mechanism.
**Trade-off:** a vocabulary chapter can become a prerequisite wall. Introduce
only necessary terms, reuse them immediately, and let knowledgeable readers skip
support. A glossary is a lookup aid, not proof that a term was learned.

Sources:
- Ausubel, D. P. (1960). *The use of advance organizers in the learning and
  retention of meaningful verbal material.* Journal of Educational Psychology,
  51, 267–272. https://doi.org/10.1037/h0046669
- Mayer (2021), above, pretraining principle.

## Concreteness fading

**Principle:** connect concrete instances to an abstract structure, then remove
incidental detail while preserving the mapping.
**Why:** concrete support can aid initial interpretation but can bind learning
to surface features. Fading is promising, not automatically superior in every
domain; learners must see what each representation corresponds to.
**Blocks:** `label`, `connect`, `compare`/`stages`, `region`, `code`, `table`.
**Pattern:** show named keys in buckets, label their indices, then align the
same probe with `i = (i + 1) % n`; fade names while retaining indices and arrows.
Ask the learner to map the code back to a new key.
**Prevents:** an engaging analogy with no bridge to the real model or notation.
**Trade-off:** unnecessary realism distracts; some expert audiences can start
with the abstraction. Never let a metaphor imply a false mechanism.

Source: Fyfe, E. R., McNeil, N. M., Son, J. Y., & Goldstone, R. L. (2014).
*Concreteness fading in mathematics and science instruction: a systematic
review.* Educational Psychology Review, 26, 9–25.
https://doi.org/10.1007/s10648-014-9249-3

## Expertise reversal

**Principle:** adjust support to demonstrated prior knowledge, not one universal
“best” amount of guidance.
**Why:** guidance useful to novices can become redundant and burdensome for
experts who already possess a schema.
**Blocks:** `depth` signal, optional `term` definitions/`glossary`, retireable
regions, composable deck chrome.
**Pattern:** offer an introductory worked trace and a concise direct comparison;
use a short diagnostic to recommend a path, while allowing the learner to change
it. Both paths retain the core evidence and transfer question.
**Prevents:** forcing experts through redundant labels or abandoning novices.
**Trade-off:** branching creates testing and orientation costs. A short explainer
may need only optional definitions rather than several complete tracks.

Source: Kalyuga, S., Ayres, P., Chandler, P., & Sweller, J. (2003).
*The expertise reversal effect.* Educational Psychologist, 38, 23–31.
https://doi.org/10.1207/S15326985EP3801_4

## Worked-example fading

**Principle:** move from an explained solution to completion tasks to an
independent case as the learner becomes ready.
**Why:** examples reduce unproductive search initially; gradually omitting
solution steps can bridge to solving rather than merely watching.
**Blocks:** `code.focus`, `note`, `ask`, `region`, `depth`.
**Pattern:** fully trace one insertion; in the next, leave the next bucket for
the learner; in the last, request the full probe path and reason for stopping.
Keep corrective explanation available after each attempt.
**Prevents:** a successful demonstration mistaken for independent capability.
**Trade-off:** fade support based on errors/readiness, not an arbitrary step
number. Very short reference material may not need practice at all.

Source: Renkl, A., & Atkinson, R. K. (2003). *Structuring the transition from
example study to problem solving in cognitive skill acquisition: a cognitive
load perspective.* Educational Psychologist, 38, 15–22.
https://doi.org/10.1207/S15326985EP3801_3

## Guided rather than unguided discovery

**Principle:** give exploration a question, constrained variables, relevant
observations and feedback, especially for novices.
**Why:** searching an unfamiliar problem space can exhaust resources before a
useful schema develops. This is not an argument against interaction or every
form of inquiry; distinguish unsupported discovery from scaffolded investigation.
**Blocks:** `slider`, `choice`, `ask`, `until`, `note`, `readout`, `compare`.
**Pattern:** “Keep capacity fixed. Predict whether doubling the delay removes
collisions; change only delay; inspect alignment; explain the result. Now test
jitter.” Show aligned time scales and feedback linked to the observation.
**Prevents:** “try the controls” with no interpretable result or learning task.
**Trade-off:** over-constraining can remove productive hypothesis generation;
relax constraints once the learner can explain the baseline.

Source: Kirschner, P. A., Sweller, J., & Clark, R. E. (2006). *Why minimal
guidance during instruction does not work: an analysis of the failure of
constructivist, discovery, problem-based, experiential, and inquiry-based
teaching.* Educational Psychologist, 41, 75–86.
https://doi.org/10.1207/s15326985ep4102_1
