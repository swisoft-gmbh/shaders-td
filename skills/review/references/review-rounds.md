# Review rounds with several agents

Read when: several reviewers, fixers or studies work in parallel. A
single-agent review can skip this file.

Evidence: the review and fix rounds of the preview-only liquid-glass examples
(records in each study's `review.md`, 2026-11-02;
[status](host-free-checks.md#status-of-the-liquid-glass-evidence)).

These rounds use several agents at once and cost accordingly. Run them only
when the user asks for a multi-agent review; a host or organisation that works
with one agent at a time does the same checks in sequence.

## Lenses, verifiers and a critic

Split a large review by lens, then check every finding and every fix with a
separate agent. Each step below caught something the step before it missed.

1. **Audit by lens.** Give each auditor one remit:
   - TouchDesigner Python API and the recipe;
   - GLSL maths and MAT conventions;
   - runtime and the render pipeline;
   - truth of the docs, the tutorial and the tests.

   For each member of a family, add a TouchDesigner integrator and a
   maths-and-tests reviewer who runs mutants
   ([mutation runs](test-quality.md#bounds-from-measurements-proven-by-mutants)).
2. **Verify each finding.** A skeptical verifier per lens reproduces each
   finding and marks it confirmed, plausible risk or refuted, with
   measurements. In the core's audit, 47 of 49 findings were kept: one was
   refuted by measurement and one by the plugin's own contour-material build
   in TouchDesigner (Native; core `review.md`, "Refuted findings").
3. **Fix after reproducing.** The fixer reproduces each finding first, and may
   choose a different fix after measuring. A fix that changes the look ships
   switched off
   ([hold back look changes](../../build/references/co-design.md#hold-back-look-changes-until-the-user-decides)).
4. **Verify every fix round.** An independent verifier runs after each fix
   round. After the family sync's fixes, the verifiers found 3 to 8 issues per
   study; after the close's fixes, 3 to 5.
5. **Close with a family critic.** A read-only critic reviews the whole family
   at the end. It found 12 cross-study gaps after the sync and 9 after the
   close.

Give every agent the exact skill files to read, and ask it to list the steps it
applied. For per-agent folders and ports, see
[run the harness safely](host-free-checks.md#run-the-harness-safely).

## Route each cross-study finding to one owner

Findings were lost twice:

- the critic's free-text study field was split on commas into wrong agent
  labels, such as "lit diverges)", so some gaps went to the wrong agents;
- agents limited to one folder, or read-only, left notes about other studies
  instead of fixes.

Practice:

- The critic returns the affected studies as a list, not as prose.
- Each gap goes to one agent whose write scope covers every listed folder.
- A finding about a family rule is fixed in every member in the same round,
  with one shared test (for example `FitThreshold` in the core, Flow and Lit
  `test_study.py`).

## Judge routes with roles, a rubric and one backdrop

When the user must choose between several studies or routes, use judges with
different roles. For example: a TouchDesigner integrator, an art director and
a real-time engineer. Weight the rubric by the user's stated priority. The
liquid-glass family used universality 0.4, reference match 0.25, robustness
0.2 and cost 0.15. The judges' notes also found the drift between forked
members that led to the two-way sync.

- Compare looks on one shared backdrop. Prism's type-on-black backdrop
  flattered the rainbow references, while the core's grey checker washed them
  out. A Type backdrop was then added to every member.
- Label scores taken before later fix rounds as such
  ([LIQUID-GLASS.md](../../../examples/LIQUID-GLASS.md#how-they-were-judged)).
- Say what the judges reran. Here one reran the unit tests and compiles, and
  none reran the preview suites, so the scores rest on recorded results.

## Batch low-severity findings and stop

After the closing round, each low-severity finding became its own round: a
tutorial pointer, a stale count, a loose threshold, a helper name. Each round
meant reproducing, a red run, docs, records and a full check run in up to five
studies. The four orchestration workflows used 78 agents and about 29 million
tokens in all.

- Batch every low-severity finding for a study into one pass with one check
  run.
- Stop the review loop when a round returns only low-severity docs findings.
  List the rest in `review.md` as known issues. This stop rule is an
  inference from cost, not a measured quality threshold.
