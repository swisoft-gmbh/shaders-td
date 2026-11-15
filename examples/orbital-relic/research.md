# Research: Orbital Relic

## The question and selected mechanism

Build a slowly rotating, fused ring-and-satellite sculpture. Reveal hit coverage, marching cost and normals separately. Test distance-based rendering rather than merely producing a shaded circle.

Distance functions combine a tilted torus with two satellite spheres. A bounded raymarch stops only on an explicit hit; central differences derive normals.

## Read the source and its experiment together

The primary article is [painting-with-math-a-gentle-study-of-raymarching](https://blog.maximeheckel.com/posts/painting-with-math-a-gentle-study-of-raymarching/), lines 245–451 of the preserved MDX. The matching decoded scene is `painting-with-math-a-gentle-study-of-raymarching::scene5`. Its authored module is `Raymarching/smoothmin.ts`. [Source records](sources.json) preserve hashes and locations; the bundled corpus is the reference authority for these archived versions.

The article develops a ray before a full scene, then compares union and smooth union. The matching smoothmin scene adds normal-based lighting. The native study preserves those teaching steps while replacing the composition and host.

The reusable teaching sequence is to make the hidden signal visible, isolate a control, predict its effect, and then inspect the native outcome. [The experiment list](experiments.json) implements this sequence with fixed conditions. This is a synthesis of observable published practice, not a transcript of private reasoning.

## Compare implementation routes

A rasterized mesh would make ordinary lighting straightforward, but it would not exercise distance composition. Adding procedural displacement was rejected here because it can invalidate the distance bound and obscure the property being tested.

Use exact primitive distances under rigid rotation, a polynomial smooth minimum with an explicit zero-width case, a conservative step multiplier and a separate hit flag.

The ring/satellite shape can blend continuously. The diagnostic can distinguish a real hit from a ray that merely exhausted its budget. Smooth union remains a distance-bound construction, not a proof that every possible user deformation is safe.

## Transfer into TouchDesigner

The native route is **SDF raymarching GLSL TOP**. [The recipe](study.json) names each operator, parameter reference, shader DAT, uniform and wire. Source files use native GLSL TOP/MAT contracts instead of archived Three.js/TSL wrappers. The native version under test is 2025.33230 on macOS; other hosts require their own checks. The article and archived code are preserved unchanged; all native shader files and the new composition are authored for this test.

The implementation has no external runtime assets. Shader inputs, diagnostic fixtures and figures are bundled or procedural. The full upstream website, videos and dependency trees are not needed to run it.

## What evidence can settle the question?

Analytic sphere silhouette and normal comparison; low/high budgets; blend/time changes; wide-aspect output.

The build may compile without satisfying these properties. Native measurements, mathematical fixtures, visible captures and tutorial alignment are therefore recorded separately. See [review](review.md) and [validation](validation.json); those records distinguish completed checks from pending acceptance or performance work.
