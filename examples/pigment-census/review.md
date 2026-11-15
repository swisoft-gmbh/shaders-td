# Review: Pigment Census

This is the build session’s own review, not an independent reviewer report.

## Research and coverage

The primary article and matching source module are retained with hashes in `sources.json`. The native adaptation and alternatives are explained in `research.md`. The broader archive recheck found no unbundled custom-shader source under its stated scan criteria; external papers/media and native host APIs remain distinct coverage categories.

## Actual checks

| Check | Result |
|---|---|
| Constant RGB survives a maximum-radius filter | Passed |
| Zero-radius filtering is identity | Passed |
| Variance selection preserves an edge better than box blur | Passed |
| Filtering reduces grain in a controlled sky region | Passed |
| Final native diagnostics have no reported errors | Passed |

[Native measurements and conditions](../../validation/five-mechanisms/mechanism-tests.json). Structural validation and tutorial source/section checks also passed. Five native teaching captures correspond to the five presets.

## Findings and corrections

Native visual inspection found that the procedural hill layer order hid earlier bands. Reversing the source composition order revealed them. The filter mechanism was unchanged.

## Human visual check

The user reported: “All five visible; no obvious problems.” This concerns the animated sample viewers. It is not recorded as approval of tutorial depth or performance.

## Delivery and limitations

A fresh source build was exported through TouchDesigner and reopened under a different parent. Embedded source, tutorial and experiment DATs match the delivered files; native parameter references resolve correctly. Fixed-condition output matched exactly. For Tidal Ink the comparison explicitly resets both components to the seed; evolving history is tested separately. See `validation.json` for the receipts. Native tests use the installed macOS 2025.33230 build. No other OS/build, live camera/audio input or sustained GPU frame-rate target was tested. Recorded cook-call wall times, where present, are not GPU execution times. Art direction and article acceptance remain separate from this engineering review.
