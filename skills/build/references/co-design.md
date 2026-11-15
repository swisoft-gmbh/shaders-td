# Co-design: settle the choices, then build

Read when: the brief leaves creative or technical choices open, or a fix would
change a look the user has already seen.

This is the toolkit's way of working with a user, not a process Maxime Heckel
published.

## Ask before building

The host's or organisation's rules on asking come first: how many questions,
through which tool, and whether to ask at all
([hosts](../../research/references/chat-web.md#what-outranks-these-skills)).
Where they are silent, this is the default.

Start from what the user already said. Ask the open choices together, before
any code, through the host's question tool when it has one: two to four options
each, the recommended one first, each option saying what it looks like at rest,
in motion and under interaction, and what it costs. Do not treat silence,
elapsed time or a preselected option as an answer.

If the user cannot be reached, because they said so or the host cannot ask,
decide. Record each choice as a delegated default with its reason, and hand
over the list of questions with the choice made for each. Silence is still
not an answer: the list is how the user finds what to revisit.

For an open brief, settle the visual target first: subject or material, mood,
palette, movement, and what the user dislikes. Then only the constraints that
matter here: image effect or 3D surface; procedural, video, camera, audio or
data input; output size; target machine and build; reusable component or whole
project; who the tutorial is for. Do not ask a non-technical user to design the
node graph. A specific brief needs no interview.

## Deliver whole, then take feedback

Build the complete study from the answers and deliver it. The user's reaction
to the real output starts the next round: ask about what they saw (the trail
lasts too long, the contours hide the subject, the material ignores the light),
not about abstractions. Show a prototype part-way only when the user asked to
steer along the way.

Record each answer with one origin from a fixed set: user (with a quote),
workflow brief, project inspection, delegated default, inference or
measurement. An orchestrator's brief is not the user's words, and an inferred
preference is not acceptance. Check every inference against the requirements
the user gave; a count recorded as an inference once shipped 8 presets where
the brief asked for 12
([Blobs review](../../../examples/liquid-glass-blobs/review.md)).

Keep `co-design.json` for preferences, open questions and acceptance, and
`decisions.json` for fix-level choices. Shader and tutorial are accepted
separately: once the user approves the shader, a tutorial revision leaves it
alone. Once they ask to close the work, do not restart the interview.

## Hold back look changes until the user decides

If a fix changes a look the user has seen, measure the change against the
previous captures
([look-change tables](../../review/references/test-quality.md#capture-receipts-and-look-change-tables)).
Then ship the fix switched off, for example behind a toggle, or as a recorded
decision that waits for the user. A silent change throws away what the user
already judged.

Put each waiting decision in `co-design.json` under `look_decisions_for_user`:

- `id`, `question`, `what_changed` (measured numbers and evidence paths),
  `options` (each saying what it changes), `recommended` with its origin and
  reason, `not_an_option` (with the measurement that rules it out), `in_code`,
  `status` and `answer`.
- A unit test fails if the code drifts from `in_code` before the user answers.
- The overview lists every open question in one table.

The packet is the record. Put the questions to the user through the host's
question tool, one decision per question; only a host without one gets the
packet as text to answer by naming a decision and an option.

Example: `look_decisions_for_user` in the preview-only
[Flow example's co-design.json](../../../examples/liquid-glass-flow/co-design.json)
(test class `LookDecisions` in its `checks/test_study.py`), and "Open look
questions" in [LIQUID-GLASS.md](../../../examples/LIQUID-GLASS.md).
