# Forking one study into a family

Read when: deriving several studies, variants or members from one base.

Evidence: measured in the preview-only liquid-glass family (one core, four
members; [status](../../review/references/host-free-checks.md#status-of-the-liquid-glass-evidence)) and in `git diff` of the repository history.

## Contents

- [Harden the base before you fork](#harden-the-base-before-you-fork)
- [Guard every copied stage](#guard-every-copied-stage)
- [Write the names table at fork time](#write-the-names-table-at-fork-time)
- [Share code instead of hand-copying](#share-code-instead-of-hand-copying)

## Harden the base before you fork

Finish the base's reviews and fixes before you fork it, because every copy
inherits the defects that exist on the day of the fork.

- Four members forked the core at one commit while the core was still
  changing. One later core commit changed 251 lines of its pixel shader
  (`git diff --stat a6f95c6 dd05f1f`).
- Each member re-fixed some base defects and kept others: a raw
  `absTime.seconds` times speed, reversed `smoothstep` edges, an Over TOP
  composite and a 16-bit back-face pass. Integration fixes found in members
  were missing from the base. Repairing that took a two-way sync of all five
  studies.
- If you must fork early, fork from a pinned commit and plan the sync from
  the start.

Evidence: Flow's `decisions.json` records the fork commit and the later
rebase ("Family sync: rebase") in
[liquid-glass-flow](../../../examples/liquid-glass-flow/README.md).

## Guard every copied stage

Guard each copied shader stage with three tests, because a silent copy drifts:

1. A byte-identical copy of the base in `checks/core_reference`, with a
   sha256 test against the sibling folder (`test_core_reference_is_the_current_core`).
2. A line-diff test that allows only the documented additions
   (`EXPECTED_PIXEL_DIFF`).
3. A render test showing that the member equals the base at its neutral
   setting (`amplitude0_matches_core`, at most 0/255).

- The guards couple merges: merging the base alone turned a member's suite
  red. Merge them together and say so in the merge risk.
- A test that reads a sibling must skip when the sibling is absent, so a
  single-study ZIP passes on its own.

Example: `checks/test_study.py` and `checks/preview_tests.cjs` in
[liquid-glass-flow](../../../examples/liquid-glass-flow/README.md).

## Write the names table at fork time

Fix one name per control, helper, unit and meaning when you fork, because
names drift fast across copies.

- Names drifted: `Fitglass`, `Fitflow` and `Fitsize`; `fit_glass`, `fit_flow`
  and `fit_object_size`; `Backdrop` and `Demobackdrop`.
- Meanings drifted too. On the same torus scaled 3 by its COMP, Fit gave 3.0
  in the core and Lit, 3.44 in Prism (reference radius about 1.265 instead of
  1.45) and 1.45 in Flow (SOP units). In Blobs a typed Object size meant a
  1.45 times smaller object.

Practice:

- Put a "Names across the family" table in the base README: control name,
  label, helper, unit and meaning.
- Add a test that the docs use the family names (`FamilyNames`,
  `test_docs_use_the_family_names`).
- Keep old names as documented aliases until users have moved (Flow keeps
  `fit_flow = fit_glass`).

Evidence: Unit test; the Fit measurements are recorded in the core's
`decisions.json` (family critic) and the rule in Lit's `decisions.json`
(`family_rule`). Example:
[Names across the family](../../../examples/liquid-glass/README.md#names-across-the-family).

## Share code instead of hand-copying

One shared DAT pulled in with `#include`, or a builder that concatenates one
shared source, prevents the drift above. The facts, and the unverified export
case, are in
[native API notes](../../research/references/native-api.md#more-glsl-mat-and-python-facts).
