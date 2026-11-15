# Research: Tidal Ink

## The question and selected mechanism

Transport two pigment concentrations into interleaved curls. Test real persistent state, periodic sampling, initialization, pause/reset and simulated-time decay, using a prescribed field rather than a full fluid solver.

The previous RG state is sampled along a backward midpoint characteristic, attenuated by a time-unit decay and replenished by two bounded sources. Display converts concentrations into an artistic absorption palette.

## Read the source and its experiment together

The primary article is [the-magical-world-of-particles-with-react-three-fiber-and-shaders](https://blog.maximeheckel.com/posts/the-magical-world-of-particles-with-react-three-fiber-and-shaders/), lines 588–605 of the preserved MDX. The matching decoded scene is `the-magical-world-of-particles-with-react-three-fiber-and-shaders::scene8`. Its authored module is `ParticlesReactThreeFiber/curlFBO.ts`. [Source records](sources.json) preserve hashes and locations; the bundled corpus is the reference authority for these archived versions.

The particle article separates a texture containing data from the pass that draws it. The curlFBO module illustrates offscreen simulation/render wiring; it is not evidence that this exact persistent advection algorithm exists in the archive. Shading Motion supplies explicit previous-state swapping and decay context.

The reusable teaching sequence is to make the hidden signal visible, isolate a control, predict its effect, and then inspect the native outcome. [The experiment list](experiments.json) implements this sequence with fixed conditions. This is a synthesis of observable published practice, not a transcript of private reasoning.

## Compare implementation routes

The earlier Phosphor Memory detects changes between input frames; it does not transport a stored signal. A full incompressible fluid solver would evolve velocity, solve pressure and impose boundary conditions. Here a prescribed divergence-free velocity isolates transport.

Keep RG as concentrations and A as validity, implement periodic bilinear sampling explicitly, backtrace with a midpoint step, and expose decay in inverse seconds and step in simulated seconds per cook.

Stable interpolation supports useful curls and controlled tests. It introduces numerical diffusion and does not exactly conserve pigment mass. The simulation advances per cook, so a fixed step is not wall-clock synchronization.

## Transfer into TouchDesigner

The native route is **Feedback advection**. [The recipe](study.json) names each operator, parameter reference, shader DAT, uniform and wire. Source files use native GLSL TOP/MAT contracts instead of archived Three.js/TSL wrappers. The native version under test is 2025.33230 on macOS; other hosts require their own checks. The article and archived code are preserved unchanged; all native shader files and the new composition are authored for this test.

The implementation has no external runtime assets. Shader inputs, diagnostic fixtures and figures are bundled or procedural. The full upstream website, videos and dependency trees are not needed to run it.

## What evidence can settle the question?

Flat-field invariance; 30/60-step decay; exact pause; reset/empty-state behavior; zero-velocity identity; transport, bounds and approximate mass retention.

The build may compile without satisfying these properties. Native measurements, mathematical fixtures, visible captures and tutorial alignment are therefore recorded separately. See [review](review.md) and [validation](validation.json); those records distinguish completed checks from pending acceptance or performance work.

## Supplemental algorithm reference

[Mark J. Harris, GPU Gems chapter 38](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu) explains backward advection and texture-based simulation. This is a separately consulted primary reference, not a missing Heckel article. The shader here uses a prescribed analytic velocity and midpoint backtrace; it omits velocity evolution and pressure projection.
