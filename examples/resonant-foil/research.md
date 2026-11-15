# Research: Resonant Foil

## The question and selected mechanism

Deform an actual sphere mesh into moving foil folds. Keep displacement, normal correction and lighting independently inspectable, including a deliberately uncorrected comparison.

A separable sine/cosine function moves vertices vertically. Its Jacobian gives the inverse-transpose normal correction before native world-space transforms and lighting.

## Read the source and its experiment together

The primary article is [the-study-of-shaders-with-react-three-fiber](https://blog.maximeheckel.com/posts/the-study-of-shaders-with-react-three-fiber/), lines 471–505 of the preserved MDX. The matching decoded scene is `the-study-of-shaders-with-react-three-fiber::scene6`. Its authored module is `ShaderReactThreeFiber/blob.ts`. [Source records](sources.json) preserve hashes and locations; the bundled corpus is the reference authority for these archived versions.

The archived blob displaces geometry and sends a displacement varying to its fragment shader. The explicit Jacobian and corrected-normal comparison here are new engineering additions, not a claim that the archived blob taught this derivation.

The reusable teaching sequence is to make the hidden signal visible, isolate a control, predict its effect, and then inspect the native outcome. [The experiment list](experiments.json) implements this sequence with fixed conditions. This is a synthesis of observable published practice, not a transcript of private reasoning.

## Compare implementation routes

Changing color alone would leave the silhouette intact. A fragment normal map would add apparent detail but not move geometry. Screen derivatives give faceted geometric normals; an analytic correction provides a smooth, testable result for this specific map.

Use F(x,y,z)=(x,y+g(x,z),z), transform n to (nx-gx*ny,ny,nz-gz*ny), normalize and then use TDDeformNorm. At zero amplitude keep n exactly.

The surface and its lighting agree under object rotation and nonuniform scale. Sampling the map on a finite sphere mesh still limits detail, and this Jacobian formula only applies to this displacement map.

## Transfer into TouchDesigner

The native route is **Displaced GLSL MAT**. [The recipe](study.json) names each operator, parameter reference, shader DAT, uniform and wire. Source files use native GLSL TOP/MAT contracts instead of archived Three.js/TSL wrappers. The native version under test is 2025.33230 on macOS; other hosts require their own checks. The article and archived code are preserved unchanged; all native shader files and the new composition are authored for this test.

The implementation has no external runtime assets. Shader inputs, diagnostic fixtures and figures are bundled or procedural. The full upstream website, videos and dependency trees are not needed to run it.

## What evidence can settle the question?

Actual alpha/silhouette change; corrected/uncorrected lighting at fixed geometry; zero-amplitude identity; finite-difference tangent comparison; native transformed-normal view.

The build may compile without satisfying these properties. Native measurements, mathematical fixtures, visible captures and tutorial alignment are therefore recorded separately. See [review](review.md) and [validation](validation.json); those records distinguish completed checks from pending acceptance or performance work.
