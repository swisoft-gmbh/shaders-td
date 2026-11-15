# Small records, useful evidence

Use records to keep code, tutorial and testing aligned, not to force bureaucracy.

If the host or organisation already requires its own documents, for example
one `SPEC.md` and one plan, those stay in charge. `brief.md` can then be the
spec's section for this study rather than a second spec, and the dossier keeps
only what those documents do not: the recipe, the sources and the evidence.

| File | Meaning |
|---|---|
| `study.json` | Nodes, wires, previous-frame references, shader files, uniforms, controls, output and assumptions. |
| `build.py`, `builder.py`, `native.py` | The entry point to run in TouchDesigner, the network builder it calls, and the in-host helpers. The study checker expects all three by these names. |
| `brief.md` | Desired experience and observable success criteria. |
| `sources.json` | Actual source IDs/URLs/lines, borrowed idea/code, changes and credit. |
| `decisions.json` | Goal, alternatives, evidence, choice and consequence. |
| `experiments.json` | Named presets, fixed conditions, changed variable, predicted relation, observed result and capture. |
| `validation.json` | Static, native compile, render, controls, export/reopen, performance and acceptance as separate fields. |
| `article-plan.json` | Each semantic section's question, code excerpts, native experiment and figure. |
| `article.source.md` | Authored explanation with source markers. |
| `article.md` | Generated exact excerpts alongside the explanation. |
| `co-design.json` | Supplied/delegated/inferred preferences, feedback, open questions and separate acceptances. |

Use `pending`, `passed`, `failed`, `not-applicable` with an evidence path, method
and date where meaningful. “Passed” requires evidence for the exact claim.
Never convert a static parse into “native compiled”, a capture into “all
controls work”, or user praise into a performance benchmark.

## Pending native checks

When nothing ran natively, write each pending native check into
`validation.json` as a recipe someone can run, because a bare "pending" does
not say what to do or what counts as a pass:

- A target: TouchDesigner 2025.x, OS and hardware.
- An empty record (`build`, `os`, `gpu`, `info_dat`) with `how_to_record`:
  run `inspect()`, and copy the GPU by hand.
- A list of checks, each with an `id` and a `how`: exact steps and settings,
  what to look at, and what the preview measured.

A unit test keeps the record empty while the status is pending, and requires
every field before any other status. For the first native session, build the
base first (compile info, the Render Pass TOP route, the back-face pass), then
the members. List the pending items that members share once, in the family
overview.

Example: `native_checks_pending` and `family_close.native_run` in the
preview-only core example's
[validation.json](../../../examples/liquid-glass/validation.json), guarded by
`test_native_family_list_waits_for_a_recorded_run`.
