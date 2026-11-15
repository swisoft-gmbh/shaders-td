# Research: Pigment Census

## The question and selected mechanism

Turn an original grainy, layered landscape into broader pigment patches. Compare variance-selected quadrants with ordinary box averaging on a controlled edge and constant image.

For each texel, calculate four quadrant means and channel variances, then use the mean from the least-variable quadrant. A separate box filter exposes the effect of selection.

## Read the source and its experiment together

The primary article is [on-crafting-painterly-shaders](https://blog.maximeheckel.com/posts/on-crafting-painterly-shaders/), lines 62–196 of the preserved MDX. The matching decoded scene is `on-crafting-painterly-shaders::scene1`. Its authored module is `PainterlyShaders/basic.ts`. [Source records](sources.json) preserve hashes and locations; the bundled corpus is the reference authority for these archived versions.

The article begins with a local kernel visualizer, then shows the whole-image result. Its basic module calculates the first and second moments and chooses the minimum-variance sector. This study adopts the mechanism with explicit native texel addressing.

The reusable teaching sequence is to make the hidden signal visible, isolate a control, predict its effect, and then inspect the native outcome. [The experiment list](experiments.json) implements this sequence with fixed conditions. This is a synthesis of observable published practice, not a transcript of private reasoning.

## Compare implementation routes

An anisotropic tensor pipeline is available in the archive but would obscure the first statistical mechanism. Uniform box blur is cheaper to explain but mixes across every edge. A neural style filter would not test the archived kernel reasoning.

Start with four inclusive (radius+1)^2 quadrants, clamp integer fetches at boundaries, clamp tiny negative roundoff in variance, and make zero radius a valid identity case.

Strong edges can be preserved while fine grain is averaged. Axis-aligned patches and switching artifacts remain visible limitations; this is not the Papari or anisotropic extension. The selected weighted channel variance is not the same as variance of scalar luminance.

## Transfer into TouchDesigner

The native route is **Multi-pass image filtering**. [The recipe](study.json) names each operator, parameter reference, shader DAT, uniform and wire. Source files use native GLSL TOP/MAT contracts instead of archived Three.js/TSL wrappers. The native version under test is 2025.33230 on macOS; other hosts require their own checks. The article and archived code are preserved unchanged; all native shader files and the new composition are authored for this test.

The implementation has no external runtime assets. Shader inputs, diagnostic fixtures and figures are bundled or procedural. The full upstream website, videos and dependency trees are not needed to run it.

## What evidence can settle the question?

Constant field; radius-zero identity; binary edge versus box filter; grain reduction against a clean procedural reference.

The build may compile without satisfying these properties. Native measurements, mathematical fixtures, visible captures and tutorial alignment are therefore recorded separately. See [review](review.md) and [validation](validation.json); those records distinguish completed checks from pending acceptance or performance work.
