# Review: Orbital Relic

This is the build session’s own review, not an independent reviewer report.

## Research and coverage

The primary article and matching source module are retained with hashes in `sources.json`. The native adaptation and alternatives are explained in `research.md`. The broader archive recheck found no unbundled custom-shader source under its stated scan criteria; external papers/media and native host APIs remain distinct coverage categories.

## Actual checks

| Check | Result |
|---|---|
| SDF sphere silhouette agrees with analytic ray intersection | Passed |
| SDF normals agree with analytic sphere interior | Passed |
| A limited step budget does not invent hits | Passed |
| Smooth union changes the actual shape/shading | Passed |
| Fixed time changes rigid scene rotation | Passed |
| Wide render preserves a round sphere silhouette | Passed |
| Final native diagnostics have no reported errors | Passed |

[Native measurements and conditions](../../validation/five-mechanisms/mechanism-tests.json). Structural validation and tutorial source/section checks also passed. Five native teaching captures correspond to the five presets.

## Findings and corrections

No mechanism correction was required by the completed tests. The bounded step diagnostic is an intentional comparison, not a fabricated failure story.

## Human visual check

The user reported: “All five visible; no obvious problems.” This concerns the animated sample viewers. It is not recorded as approval of tutorial depth or performance.

## Delivery and limitations

A fresh source build was exported through TouchDesigner and reopened under a different parent. Embedded source, tutorial and experiment DATs match the delivered files; native parameter references resolve correctly. Fixed-condition output matched exactly. For Tidal Ink the comparison explicitly resets both components to the seed; evolving history is tested separately. See `validation.json` for the receipts. Native tests use the installed macOS 2025.33230 build. No other OS/build, live camera/audio input or sustained GPU frame-rate target was tested. Recorded cook-call wall times, where present, are not GPU execution times. Art direction and article acceptance remain separate from this engineering review.
