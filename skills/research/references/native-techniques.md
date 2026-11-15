# Mechanisms and native routes

These are toolkit adaptation recommendations, not native procedures published
by Heckel. Read the source article and corresponding widget/module before
implementing. Paths below refer to `corpus/articles/`.

| Family / source | What to preserve | Native route and debug stage | Decision / limitation |
|---|---|---|---|
| Foundations: `the-study-of-shaders-with-react-three-fiber` | Separate position, UV, time, signal and color. | GLSL TOP for image generation; GLSL MAT for geometry. UV/field view. | Three.js uniforms and varying declarations are host-specific. |
| Motion: `shading-motion`, 58–157 | Current/previous luma, threshold, persistent mask, style as a separate pass. | GLSL TOP state pass + Feedback TOP + display pass. R=luma, G=trail, B=raw mask, A=initialized. | A camera/exposure change can trigger the whole image. Reset on source/size changes. |
| Blob tracking: same, 312–637 | Reduction, labels, bounds and overlays are distinct stages. | Inspect current native blob operators, or explicit buffer/compute reductions. | Do not port browser readback per frame blindly; readback can dominate cost. Not included in the starter builders. |
| Direction: same, 648–745 | Expose representation, signed encoding and confidence. | GLSL TOP approximation or inspected native flow operator. Display hue/vector and magnitude separately. | Neighbor difference is not physical velocity; normalized flow loses speed and has aperture/brightness ambiguities. |
| Grids: `post-processing-as-a-creative-medium`, 47–441; `shades-of-halftone`, 36–284 | Cell coordinates, source sampling, threshold and shape. | TOP with input sampler; pixel-unit pitch and an AA debug comparison. | Source/detail sampling versus display resolution must be explicit. |
| Painterly: `on-crafting-painterly-shaders`, 62–425 | Variance-selected neighborhoods, then weighted sectors. | Multi-TOP kernel/variance experiments; bound loop size. | Larger kernels erase details and increase samples. Don't start with anisotropy when simpler weighting meets the target. |
| Anisotropy: same, 426–829 | Gradients → tensor → smoothed tensor → eigenfield → aligned kernel. | Separate TOPs and float textures; debug orientation/coherence. | Tensor is data, not display color. Degenerate eigenvectors need a fallback. |
| Dither: `the-art-of-dithering-and-retro-shading-web` | Quantization, threshold distribution, spatial structure. | GLSL TOP; fixed resolution and nearest sampling where intended. | Ordered/blue-noise thresholds have different temporal and spatial artifacts. |
| Refraction: `refraction-dispersion-and-other-shader-light-effects` | Background capture, offset, channel split, view-angle response. | Render the scene without the glass, feed it to a GLSL MAT sampler, and draw the glass with a Render Pass TOP on that render ([material integration](../../build/references/material-integration.md#draw-into-the-scene-with-a-render-pass-top)). Screen-space TOP for flat plates. | No self-sampling render target. Same-space normals/eye direction; approximate refraction doesn't prove thickness or energy conservation. See [glass notes](../../build/references/glass-refraction.md). |
| Caustics: `caustics-in-webgl` | Explicitly chosen approximation, projected light pattern. | Dedicated light-space render and receiver pass. | Requires scene/light transforms; a decorative texture is not a verified caustic solution. |
| SDFs: `painting-with-math-a-gentle-study-of-raymarching` | Distance bound, march, hit threshold, normal estimate, light. | GLSL TOP raymarcher. Iteration, distance and normal views. Or a GLSL MAT on a proxy box that writes depth, when the SDF must sort with a scene ([material recipes](../../build/references/material-recipes.md#raymarch-inside-a-proxy-box-that-writes-depth)). | Conservative steps, finite march interval; deformation can destroy a distance bound. |
| Volume: `real-time-cloudscapes-with-volumetric-raymarching` | Density, view integration, separate light visibility. | GLSL TOP with bounded loops and float targets; quality presets. | Integrate density × extinction × step length; avoid transferring historical integration defects. |
| Scene light: `shaping-light-volumetric-lighting-with-post-processing-and-raymarching` | Depth reconstruction, occlusion, light contribution. | Render TOP depth → GLSL TOP. Inspect target host's depth convention. | Never copy WebGL depth remapping or inverted projection unexamined. |
| Atmosphere: `on-rendering-the-sky-sunsets-and-planets` | Bounded atmosphere, optical depth, LUT decomposition. | Precomputed TOP LUTs plus view pass. | Record units and invalidation triggers; the source intentionally omits effects. |
| Particles: `the-magical-world-of-particles-with-react-three-fiber-and-shaders` | State update separate from particle draw. | TOP textures and instancing, or verified POPs. | Texture dimension, index addressing and initialization are part of the contract. |
| TSL/WebGPU: `field-guide-to-tsl-and-webgpu` | Data flow and algorithm, not JavaScript syntax. | Re-express in GLSL and native passes. | No automatic TSL→GLSL translation promise. |

## Original composition procedure

Write a combination of subject / signal / operator / representation / interaction.
Example: “tide charts / smooth procedural field / isoline threshold / copper
engraving / audio controls contour spacing.” The math vocabulary can be familiar;
the input relationship, visual structure, dynamics and teaching experiment must
be designed for the new brief. A title or palette change alone is insufficient.

Offer two materially different mechanisms when the brief is open. Explain the
visual tradeoff, not just API names. Keep a borrowed/new/changed record and state
how the resulting study differs from its selected references. Never assert
global novelty based on this archive alone.
