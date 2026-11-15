# Research: Lantern Fog

## The question and selected mechanism

Make two lit helical density ribbons suspended in a dark volume. Teach view transmission and light visibility as different quantities, and test step-size consistency with a homogeneous slab.

A bounded density function is integrated with midpoint view samples. Each segment removes a fraction of transmitted light and adds attenuated source radiance; a second short march estimates light visibility.

## Read the source and its experiment together

The primary article is [real-time-cloudscapes-with-volumetric-raymarching](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/), lines 622–785 of the preserved MDX. The matching decoded scene is `real-time-cloudscapes-with-volumetric-raymarching::scene18`. Its authored module is `Raymarching/lightTransmittance.ts`. [Source records](sources.json) preserve hashes and locations; the bundled corpus is the reference authority for these archived versions.

The article and corresponding module introduce Beer attenuation and then a light march. Their historical accumulation is not transferred verbatim: the new shader uses density times extinction times segment length and keeps view transmission distinct from light visibility.

The reusable teaching sequence is to make the hidden signal visible, isolate a control, predict its effect, and then inspect the native outcome. [The experiment list](experiments.json) implements this sequence with fixed conditions. This is a synthesis of observable published practice, not a transcript of private reasoning.

## Compare implementation routes

Summing density without a step-length factor makes brightness depend on sample count. Using the light-path transmission as the cumulative view transmission conflates two rays. A full multiple-scattering model would add complexity outside this fixture.

Use segmentT=exp(-sigma*rho*ds), accumulate T*(1-segmentT)*source, and then multiply T by segmentT. Treat the light result only as a factor of the source.

A constant slab has an analytic reference and should stay consistent as the view step count changes. The result is still an artistic single-scattering approximation with bounded light sampling, not a validated atmospheric renderer.

## Transfer into TouchDesigner

The native route is **Volumetric GLSL TOP**. [The recipe](study.json) names each operator, parameter reference, shader DAT, uniform and wire. Source files use native GLSL TOP/MAT contracts instead of archived Three.js/TSL wrappers. The native version under test is 2025.33230 on macOS; other hosts require their own checks. The article and archived code are preserved unchanged; all native shader files and the new composition are authored for this test.

The implementation has no external runtime assets. Shader inputs, diagnostic fixtures and figures are bundled or procedural. The full upstream website, videos and dependency trees are not needed to run it.

## What evidence can settle the question?

Slab at 16/64/128 steps; zero extinction; convergence toward 128 steps; independent light control; monotone transmission.

The build may compile without satisfying these properties. Native measurements, mathematical fixtures, visible captures and tutorial alignment are therefore recorded separately. See [review](review.md) and [validation](validation.json); those records distinguish completed checks from pending acceptance or performance work.
