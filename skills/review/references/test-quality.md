# Tests that can fail

Read when: adding tests, setting pass bounds, or judging claims about tests.

Evidence: practices proven in the preview-only liquid-glass examples
(2026-11-02; [status](host-free-checks.md#status-of-the-liquid-glass-evidence));
no number below comes from TouchDesigner.

To reuse an example's checks (preview-only, no `.tox`), see
[start from the liquid-glass examples](../../build/references/glass-refraction.md#start-from-the-liquid-glass-examples).

## Contents

- [Red runs](#red-runs)
- [Bounds from measurements, proven by mutants](#bounds-from-measurements-proven-by-mutants)
- [Choose sampling changes against a reference](#choose-sampling-changes-against-a-reference)
- [Capture receipts and look-change tables](#capture-receipts-and-look-change-tables)
- [Claims that match their tests](#claims-that-match-their-tests)
- [One place for test counts](#one-place-for-test-counts)

## Red runs

A red run (the new tests run against the old code) shows that a test can
fail. Every new or changed test fails on the code before the change and passes
after it.

- **Keep the old code at hand.** Keep the previous commit's files in
  `checks/reference/`, or write `git show COMMIT:path` into a scratch copy. Do
  not use `git checkout`, because it changes the working tree other agents and
  the user rely on.
- **Run and record.** Run the suite against the old code (the preview's
  `--reference` flag draws the material in `checks/reference/`). Save each
  test's outcome in `checks/results/red-run-ROUND.json`.
- **Fail for the right reason.** A red result counts only if the test fails on
  its assertion, not on a missing helper or import. In Lit, a test "failed" on
  the old code only because `look_defaults()` did not exist yet (Lit
  `review.md`, row V4). Blobs' records claimed red runs for two guards that
  pass on the old code (Blobs `review.md`, row CV4).
- **Name guards and new behaviour.** In `review.md`, say which tests are guards
  (they pass before and after) and which test new behaviour.
- **One revert per fix.** In a hardening round, make one scratch copy per fix
  that undoes only that fix. In the core, each of 24 single-fix reverts failed
  exactly the guard for its item (Unit test).

Example: the `red-run-*.json` files in
[liquid-glass/checks/results/](../../../examples/liquid-glass/checks/results/)
(preview-only).

## Bounds from measurements, proven by mutants

A loose bound lets a real slip pass. Set each bound from a measurement, then
prove it catches a small slip.

- **Record the evidence.** Store each check as
  `check(name, ok, evidence, claim)`, as every example's `preview_tests.cjs`
  does, so a reader sees the measured value next to the claim.
- **Measure, then add one step.** Set the bound at the measurement plus one
  rounding step: 2/255 when 1/255 was measured. Report the maximum per channel,
  the 99th percentile (p99) or the mean, and the pixels over 8/255, at a fixed
  resolution against a named reference.
- **Prove it with a deliberate slip.** Break a scratch copy slightly and run
  the test. A Fit test allowed 50 pixels over 8/255. With a `worldScale()`
  exponent of 0.3333 instead of 1/3, the core's preview suite still passed 35
  of 35; only an added bound of at most 2/255 at every pixel caught it
  (Preview; core `review.md`, "Family critic: the COMP-scale test's
  threshold").
- **Run a mutation pass per study.** Make 12 to 18 broken copies (mutants),
  each re-creating a reviewer's defect or undoing a fix. Before the fixes, 8 of
  Flow's shader mutants survived, and 9 of Prism's 12 passed every test. After
  them, Flow caught 16 of 16 and Prism 18 of 18 (Preview, Unit test;
  [mutation-run.json](../../../examples/liquid-glass-prism/checks/results/mutation-run.json)).
  Note any mutant that only one test catches.

Watch for tests that cannot fail:

- a readback that returns zeros before the first draw (Flow, row M6);
- a "no jitter" lint that cannot see dithering (Prism, `test_no_random_jitter`,
  row M4);
- a roughness test that cannot tell blur from dimming (Lit, row M2);
- a test of a stand-in instead of the delivered code (core, row D8);
- a test name that claims more than it checks, such as a test named "every
  render" that checked only the component's own renders (Blobs, row G1).

## Choose sampling changes against a reference

Compare level-of-detail (mip level: which pre-shrunk copy of a texture to read)
and blur choices with a supersampled or many-sample reference, not by eye.

- A footprint mip level for refraction raised the mean error on the changed
  pixels from 11.0 to 16.8/255 against a 4x4 supersampled render, because the
  rim compression depends on direction (core, finding B7; Preview).
- A fan-gap mip level for dispersion had a mean error 2.4 to 2.8 times that of
  mip 0 against 64- and 128-sample references. A quarter of the gap changed
  little in the other members (Lit at Thickness 2.5: mean 1.831 to 1.758/255;
  Prism's Spectral Prism: 2.167 to 2.154/255). Only Blobs, where the rainbow
  spreads much wider, adopted it after its own measurement (Lit
  `decisions.json`, C3; Preview).
- Record each rejected option with its numbers in `decisions.json`, so later
  rounds do not propose it again.

The rule for the shader itself:
[blur and disperse without dithering](../../build/references/glass-refraction.md#blur-and-disperse-without-dithering).

## Capture receipts and look-change tables

- **Receipts.** Give every capture a JSON receipt with its draw options (the
  core's `captures/*.png.json`), so any round can re-render every capture and
  compare it with the previous commit.
- **Look-change table.** Each fix round reports, per capture, "unchanged (max
  0)" or the maximum per channel, the pixels over 8/255 and the mean on the
  changed pixels. Keep the committed image when the maximum difference is 0.
- **Isolate causes.** Render one change at a time. In Blobs, a 1/128 rounding
  of the wave speeds alone changed 20,251 pixels by more than 8/255 (Preview;
  Blobs `decisions.json`).

The table feeds
[hold back look changes until the user decides](../../build/references/co-design.md#hold-back-look-changes-until-the-user-decides).

## Claims that match their tests

Docs drift ahead of tests. These overclaims recurred in the examples:

- every `smoothstep` edge called ordered while one study had reversed edges
  (Lit `review.md`, "Numerics");
- normals under non-uniform scale called tested when only depth was (Blobs,
  row M3);
- "ten times as many film bands" called verified when the test measured 7.56
  times against a requirement of 4 (Blobs, row CV2);
- dispersion convergence stated without its thickness condition (core,
  "Fixes after the independent check", row V3);
- orthographic support and a fallback for geometry without normals claimed
  before any test (core, row D10).

Practice:

- Every sentence that states a behaviour names its test or measurement.
- Untested behaviour uses "should".
- A docs reviewer checks each claim against its test.
- A claim that keeps drifting gets a test that reads the doc.

## One place for test counts

Stated counts drift. The core's README said 67, its Checks table 68, and the
suite had 71 (core `review.md`, "Counts corrected"). Lit's table said 34
preview and 70 unit tests after both suites had grown (the `DocumentedCounts`
docstring).

- State counts in one table (the Checks table in `review.md`) and link to it.
- Or guard every stated count with a test. Lit's `DocumentedCounts` reads the
  counts from the test loader, `preview_tests.cjs` and `compile.json`
  ([test_study.py](../../../examples/liquid-glass-lit/checks/test_study.py)).
- Keep that table to the current state, and use one section order in every
  study.
