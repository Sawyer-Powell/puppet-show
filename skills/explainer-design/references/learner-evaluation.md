# Learner evaluation recipe

Goal: find out which model the learner can use, not whether they enjoyed the
animation or can quote its caption. This is formative evaluation, not a claim
of experimental efficacy. Keep technical, semantic and learning evidence separate.

## 1. Prepare the assessment before polishing

For each learning goal, write:
- a brief prerequisite/diagnostic question;
- an outcome prediction plus a request for its causal justification;
- a new-case transfer question with different values, order or surface context;
- where useful, a boundary question (“when would this explanation not apply?”).

Use parallel before/after forms rather than simply repeating the same numbers.
Keep their difficulty and tested mechanism comparable. Do not put the answer in
an option's wording or reward the longest explanation. Precommit the rubric and
acceptable alternatives; score prediction and explanation separately.

Example goal: distinguish cumulative ACK from “ACK the latest packet.”

- **Before:** byte 103 is missing, but 104–106 have arrived. What ACK does the
  receiver send next, and why?
- **After/transfer:** bytes through 205 are contiguous, 206 is missing, and
  207–209 arrive. Predict the next ACK and what arrival lets it advance.
- **Boundary:** does an ACK alone tell you whether data reached the application?

Adapt questions to the actual model's conventions. These numbers are not a
substitute for checking the explainer's ACK definitions and assumptions.

A compact rubric per item:

| dimension | 0 | 1 | 2 |
| --- | --- | --- | --- |
| prediction | wrong/absent | partly correct | correct under stated assumptions |
| mechanism | wrong model/absent | relevant rule, missing link | causal explanation tied to evidence |
| transfer (separate item) | cannot apply | succeeds with hint | independently handles new case |

Record uncertainty (“not sure”) and the learner's stated reason, not just total
points. A correct choice with a wrong mechanism remains a teaching problem.

## 2. Run a human formative session when possible

1. Ask the pre-quiz without teaching or correcting yet. Explain that the
   artifact, not the person, is under test. Note prior familiarity.
2. Give only the built explainer and its ordinary instructions. Let the learner
   navigate and replay naturally. Record where they search, pause, ask for a
   definition or misinterpret a control. Avoid coaching the target inference.
3. Give the parallel post-quiz and a transfer item without opening captions as
   an answer key. Ask for reasoning and confidence, not confidence alone.
4. Ask which visual evidence supported their answer, and what remains unclear.
5. If retention matters, repeat a fresh equivalent item after a stated delay.
   Immediate performance is not delayed retention.

A pre-quiz can itself cue attention and aid learning. Improvement in a small
before/after session cannot isolate the effect of animation, retrieval, or the
explainer from testing effects and prior knowledge. Strong causal claims need a
suitable comparison condition, balanced forms and a more rigorous study.

## 3. Run a restricted learner-agent check

Use a fresh agent/session, not the author or a worker that has seen the source.
Give it only `dist/examples/<name>/index.html` in a browser-capable environment
and/or exported screenshots, plus the assessment prompts. Do not expose source,
FRICTION logs, design notes, answer keys, expected outcomes, or this skill's
worked answers. If tooling cannot isolate repository access, stage just the
allowed artifacts in an isolated directory/environment and report the limitation.
Do not describe a merely requested restriction as enforced isolation.

Use two phases so answers are not leaked through evaluation instructions:

**Before artifact access:**

> You are evaluating a learning artifact. Answer these diagnostic questions
> using your present knowledge; give reasoning and mark uncertainty. Do not
> browse or consult other resources. [Insert pre-quiz, without solutions.]

Record the response before granting artifact access. Then:

> Inspect only the supplied built HTML [or: these ordered screenshots]. Do not
> read implementation files, author notes, web resources or other agents'
> answers. Use normal page navigation and controls if browser tools allow it.
> Report unavailable capabilities rather than inventing observations. After
> inspection, answer these new-case questions with reasoning, uncertainty and
> the visible evidence that informed you. Also identify an unresolved ambiguity.
> [Insert parallel post-quiz and transfer questions, without solutions.]

A screenshot-only agent can assess visible clarity and solve from static
states. It cannot establish animation timing, keyboard behavior, feedback after
an unshown response, or interactive discoverability; explicitly mark those
untested. Give ordered frames and step identifiers, not a narrated solution.
A built-HTML agent should exercise the supplied tasks before reporting controls
as effective. If it lacks a browser, do not equate reading HTML source with
experiencing the artifact; fall back to screenshots and narrow the claims.

Have a separate evaluator apply the prewritten rubric after the learner answers
are frozen. The evaluator may access the answer key; the learner may not. Ask
for evidence-supported observations such as “step 6 implies ACK means latest
packet,” not an ungrounded quality score. Do not let the author silently repair
answers during scoring.

## 4. Interpret conservatively and revise

Agents may already know the subject, infer an answer without using the artifact,
or be sensitive to prompt phrasing. A high pre-score creates a ceiling: it does
not show that novices learn. Different claimed personas do not create a sample
of human novices. Use agent checks to locate ambiguity, missing evidence and
possible misconception triggers; validate important learning claims with humans.

Map each error back to a design choice:
- wrong prediction + coherent wrong rule → introduce a diagnostic contrast;
- right result + no mechanism → self-explanation and explicit causal link;
- remembers demonstrated case, fails transfer → vary surface details and fade support;
- searches distant panels → local labels/notes, clearer orientation, retire clutter;
- misses a transient event → persistent before/after evidence or slower staging;
- cannot interpret a control → a constrained task and visible consequence.

Re-test with a fresh equivalent case (and preferably a fresh learner). Do not
keep rehearsing the same question until it is memorized.

## Report template

- Artifact/build identifier and learner goals; audience and prior knowledge.
- Human or agent, number of sessions, allowed artifacts/tools, enforced access
  limits, and whether motion/interaction or only static frames were inspected.
- Pre/post/transfer questions, fixed rubric, responses and per-dimension scores.
- Observed changes in reasoning, remaining misconceptions and evidence cited.
- Changes made, follow-up results, delayed check if any, and limitations.
- Separate technical verification and visual review evidence.

If evaluation was not run, say so. “All steps passed verify” is not a learner
result, and “agent answered correctly” is not evidence of human learning.
