# Review: Tidal Ink

This is the build session’s own review, not an independent reviewer report.

## Research and coverage

The primary article and matching source module are retained with hashes in `sources.json`. The native adaptation and alternatives are explained in `research.md`. The broader archive recheck found no unbundled custom-shader source under its stated scan criteria; external papers/media and native host APIs remain distinct coverage categories.

## Actual checks

| Check | Result |
|---|---|
| Initialized state has valid alpha and deterministic flat pigment | Passed |
| Periodic advection preserves a uniform field | Passed |
| One simulated second of decay at 60 steps | Passed |
| One simulated second of decay at 30 steps | Passed |
| Pause holds the state exactly | Passed |
| Reset replaces the previous history with the selected seed | Passed |
| No injection creates no pigment from an empty field | Passed |
| Zero velocity/decay/source preserves the pattern | Passed |
| Nonzero flow transports the seeded pattern | Passed |
| Finite bounded pigment with approximate mass retention | Passed |
| Final source/decay run remains finite and bounded | Passed |

[Native measurements and conditions](../../validation/five-mechanisms/tidal-tests.json). Structural validation and tutorial source/section checks also passed. Five native teaching captures correspond to the five presets.

## Findings and corrections

The first zero-velocity test measured a 2.9802e-5 drift after 20 updates because of coordinate conversion and interpolation. The state shader now directly reuses the previous texel when Speed is zero. The complete temporal test was rerun and passed.

## Human visual check

The user reported: “All five visible; no obvious problems.” This concerns the animated sample viewers. It is not recorded as approval of tutorial depth or performance.

## Delivery and limitations

A fresh source build was exported through TouchDesigner and reopened under a different parent. Embedded source, tutorial and experiment DATs match the delivered files; native parameter references resolve correctly. Fixed-condition output matched exactly. For Tidal Ink the comparison explicitly resets both components to the seed; evolving history is tested separately. See `validation.json` for the receipts. Native tests use the installed macOS 2025.33230 build. No other OS/build, live camera/audio input or sustained GPU frame-rate target was tested. Recorded cook-call wall times, where present, are not GPU execution times. Art direction and article acceptance remain separate from this engineering review.

This is transport in a prescribed field. The 30/60-step comparison establishes simulated-time decay on a flat field, not wall-clock synchronization or exact step-invariant advection. Periodic interpolation is numerically diffusive; the mass check permits a stated bounded error.
