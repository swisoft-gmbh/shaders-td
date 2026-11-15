# Technique field guide

Each card names an article, a progression, implementation evidence, and design
consequences. The “checks” and “new experiment” suggestions are toolkit guidance.
Use [source-map.md](source-map.md) for exact lines and embedded scene selectors.
Code paths below are relative to `corpus/blog/core/components/MDX/Widgets/`.
Read originals before adapting; this guide does not replace them.

## Contents

- [Route by the input you need](#route-by-the-input-you-need)
- [01 · Scene decomposition and time](#01--scene-decomposition-and-time)
- [02 · Vertex/fragment foundations](#02--vertexfragment-foundations)
- [03 · Particle data and GPU updates](#03--particle-data-and-gpu-updates)
- [04 · Render targets as composable data](#04--render-targets-as-composable-data)
- [05 · Refraction and dispersion](#05--refraction-and-dispersion)
- [06 · Surface raymarching](#06--surface-raymarching)
- [07 · Volumetric clouds and density](#07--volumetric-clouds-and-density)
- [08 · Caustic projection](#08--caustic-projection)
- [09 · Outlines and stylized lighting](#09--outlines-and-stylized-lighting)
- [10 · Painterly filtering](#10--painterly-filtering)
- [11 · Dithering, quantization, and CRT](#11--dithering-quantization-and-crt)
- [12 · Sculpting pixels into new media](#12--sculpting-pixels-into-new-media)
- [13 · Volumetric lighting in a raster scene](#13--volumetric-lighting-in-a-raster-scene)
- [14 · TSL and WebGPU compute](#14--tsl-and-webgpu-compute)
- [15 · Halftone and neighborhood-aware marks](#15--halftone-and-neighborhood-aware-marks)
- [16 · Motion as a shader input](#16--motion-as-a-shader-input)
- [17 · Atmospheres and LUT decomposition](#17--atmospheres-and-lut-decomposition)

## Route by the input you need

| Need | Start here | Add only if justified |
|---|---|---|
| A material changes shape/color | Shader study | Displaced normals, TSL nodes |
| A scene becomes an image or a mask | Render targets | Refraction, custom post-processing |
| Thousands of independent elements | Particles | FBO simulation or WebGPU compute |
| Procedural 3D without meshes | Surface raymarching | Domain repetition, noise derivatives |
| Light inside a medium | Cloudscapes / Shaping light | Phase functions, shadows, LUTs |
| Whole-scene art direction | Moebius / Painterly | Depth/normal/tensor guidance |
| A new sampling or printing language | Retro / Pixel craft / Halftone | Neighborhoods, dynamics |
| Previous frames affect current output | Shading motion | Flow, blob data, velocity maps |
| Atmosphere at planetary scale | Sky | LUT decomposition and invalidation |

## 01 · Scene decomposition and time

**Read:** [Vaporwave](corpus/articles/vaporwave-3d-scene-with-threejs.mdx).
**Code:** `VaporwaveThreejs/Sandpack.tsx` and its scene modules.

Progression: scene/camera/renderer → grid texture → displaced terrain → animated
repeating planes → RGB shift → lighting. The article studies a visual reference
by separating the components that produce its appearance. It also distinguishes
elapsed-time animation from adding a fixed amount each frame.

Use this route when the concept is primarily a composed 3D scene. A texture and
ordinary material may already explain much of the look. Do not introduce custom
shader math without a visible reason. Material changes affect whether lights
are required; post-processing affects color output.

Checks: compare motion at different frame rates; test seamless repetition;
verify tone/color handling after adding passes. New experiment: change the
topology, interaction, or lighting narrative rather than recoloring the original
terrain.

## 02 · Vertex/fragment foundations

**Read:** [The Study of Shaders](corpus/articles/the-study-of-shaders-with-react-three-fiber.mdx).
**Code:** `ShaderReactThreeFiber/`, including its fragment visualizer and Sandpack.

Progression: vertex displacement and fragment color → uniforms → varyings →
noise-driven blob/gradient → material layering. Uniforms communicate shared
host data; attributes distinguish vertices; varyings carry interpolated data
between stages. A simple sine displacement makes the relationship tangible.

Choose a mesh shader for effects attached to a surface. Choose a full-screen
fragment study for fields that do not need mesh lighting. Keep coordinate
visualization as a debug stage and expose frequency, amplitude, and time
separately. A blob's geometry needs sufficient subdivisions; moving vertices
without updating normals can break lighting.

Checks: stable uniform references, defined ranges, resizing/aspect ratio, and
meaningful interpolation. The Lamina section is historical context, not a
requirement to introduce that dependency into every new project.

## 03 · Particle data and GPU updates

**Read:** [Particles](corpus/articles/the-magical-world-of-particles-with-react-three-fiber-and-shaders.mdx).
**Code:** `ParticlesReactThreeFiber/`.

Progression: attribute arrays → points/BufferGeometry → CPU attribute update →
vertex animation → point shape/size → FBO position data. The article makes the
data layout explicit: positions occupy triples, UVs pairs. Its FBO route stores
positions in a texture, then samples that texture in the particle vertex stage.

Use direct vertex animation for a function of initial state and time; persistent
simulation needs explicitly managed previous state. Do not call a stateless
noise animation a physics simulation. The texture resolution and particle UVs
must agree; simulation data should not undergo display color conversion.

Checks: count/itemSize, `needsUpdate` for CPU changes, point-size behavior,
camera-distance attenuation, blending, and FBO filtering. New experiment:
particles sample a novel field or respond to local interaction; preserve a
data/debug view to explain the result.

## 04 · Render targets as composable data

**Read:** [Render targets](corpus/articles/beautiful-and-mind-bending-effects-with-webgl-render-targets.mdx).
**Code:** `RenderTargetsReactThreeFiber/basic.ts`, `portal.ts`,
`screenCoordinates.ts`, `postprocessing.ts`, `transition.ts`.

Progression: capture scene to texture → offscreen scene with createPortal →
custom sampling → screen coordinates → material/geometry changes → pass chain →
scene transition. The choice of UV versus screen coordinates changes whether
the whole captured scene fits the surface or the surface reveals an aligned
portion of another scene.

Design each pass as a producer/consumer contract. State the scene/camera,
resolution, texture format, clear behavior, and output. Keep renderer state
restoration explicit. Never sample the same attachment being written.

Checks: exclude the refractor/receiver when needed; correct drawing-buffer
dimensions, target resize, feedback avoidance, and final screen target.
New experiment: combine a spatial reveal with a procedural transition mask,
not a direct copy of an archived portal.

## 05 · Refraction and dispersion

**Read:** [Refraction and dispersion](corpus/articles/refraction-dispersion-and-other-shader-light-effects.mdx).
**Code:** `RefractionDispersionReactThreeFiber/`.

Progression: background FBO → refraction offsets → color-channel separation →
multiple samples → expanded channel treatment → diffuse/specular/Fresnel →
backside rendering. The article acknowledges both the smoother appearance and
the sample-loop cost. It makes an aesthetic approximation, not a complete
spectral path tracer.

Specify incident-vector and normal spaces, IOR ratio, sample coordinates, and
which side is rendered in each pass. Layering front/back captures can create
more depth but also introduces state/order requirements.

Checks: total internal reflection behavior if relevant, offscreen UV handling,
normal orientation, sample-loop bounds, and background capture visibility.
For a TouchDesigner material, read
[glass notes](../../build/references/glass-refraction.md). They project the
bend through the camera, separate bend strength from colour split, and map the
preview-only liquid-glass examples. Caveats on the final scene are in
[source formats](source-formats.md#known-differences-and-adaptation-cautions).
New experiment: use a changing thickness field or interaction-driven dispersion,
while keeping optical approximations explicit in the article.

## 06 · Surface raymarching

**Read:** [Painting with Math](corpus/articles/painting-with-math-a-gentle-study-of-raymarching.mdx).
**Code:** `Raymarching/firstRaymarchedScene.ts`, `diffuseLighting.ts`,
`combiningSDF.ts`, `smoothmin.ts`, `infinitySpheres.ts`, `noiseDerivatives.ts`,
`martianLandscape.ts`.

Progression: ray and distance field → first sphere → gradient normal/light →
boolean/smooth operations → domain transforms/repetition → fBm and derivatives.
Transform sample points and adjust distance bounds for scale. Smooth unions
change the field near joins. A noisy implicit field is not automatically a
safe exact distance function.

Checks: normalized rays, hit epsilon, maximum travel/steps, no-hit output,
camera-inside behavior, distance bounds after distortion, and normal epsilon.
Do not conflate marching to a surface with integrating through a volume.
New experiment: compose a new topology with an interaction that alters the
field, then expose the distance or step-count view.

## 07 · Volumetric clouds and density

**Read:** [Cloudscapes](corpus/articles/real-time-cloudscapes-with-volumetric-raymarching.mdx).
**Code:** `Raymarching/volumetric.ts`, `volumetricNoise.ts`,
`directionalDerivative.ts`, `bluenoiseDithering.ts`, `bicubicFiltering.ts`,
`beersLaw.ts`, `lightTransmittance.ts`, `phase.ts`.

Progression: constant-step density sampling → noisy cloud → cheap directional
lighting → morphing → jitter/reconstruction → attenuation/light march/phase.
The article changes the interpretation of the field and no longer advances by
the SDF distance inside the medium.

Start with a cheap lighting approximation when exploring shape. Introduce
Beer–Lambert attenuation and light sampling if the visual target warrants the
cost. Keep density, extinction, step length, accumulated radiance, and
transmittance distinct; changing step count should not accidentally change
material density.

Checks: empty volume, opacity at step extremes, bounded march interval, early
exit, jitter stability, and upscaling loss. New experiment: use a bounded density
volume shaped by a novel control signal rather than recreating a cloudscape.

## 08 · Caustic projection

**Read:** [Caustics](corpus/articles/caustics-in-webgl.mdx).
**Code:** `Caustics/normalProjection.ts`, `simpleCaustics.ts`,
`beautifulCaustics.ts`, `causticsPlane.ts`, `dynamicCaustics.ts`.

Progression: light-view normal capture → refracted displacement → derivative
area ratio → intermediate target → blur/color separation → fit receiving plane →
animated surface with recomputed normals. The article explicitly chooses a
tractable approximation over full raytracing.

The area comparison models concentration or spreading of light. Separate the
normal field, caustic field, and final receiving surface so each can be checked.
Position/scale the receiving plane from projected bounds as light moves.

Checks: camera up vector, projection singularities, nearly zero area
denominators, receiver cropping, and matching animated geometry in the normal
pass. New experiment: drive surface curvature from a new procedural field and
show how it changes the projected energy pattern.

## 09 · Outlines and stylized lighting

**Read:** [Moebius-style post-processing](corpus/articles/moebius-style-post-processing.mdx).
**Code:** `Moebius/depth.ts`, `normal.ts`, `sobel.ts`, `handdrawn.ts`,
`shadows.ts`, `tonal.ts`, `light.ts`, `final.ts`.

Progression: custom pass → depth and normal buffers → Sobel edges → perturbed
outlines → luminance/shadow patterns → stylized lighting. Scene-wide
post-processing is selected because the visual treatment should apply to the
scene as a whole.

Depth must be decoded according to the actual buffer and projection. A normal
override can lose displacement information; the article encounters that exact
failure in its final terrain scene. Pattern shading may also affect background
pixels unless depth masks exclude them.

Checks: edges at silhouettes versus internal normal changes, depth thresholds
across camera ranges, background masking, and displacement parity across
passes. New experiment: derive your own line/mark language from the same
signals rather than copying the final illustrated scene.

## 10 · Painterly filtering

**Read:** [On Crafting Painterly Shaders](corpus/articles/on-crafting-painterly-shaders.mdx).
**Code:** `PainterlyShaders/basic.ts`, `circular.ts`, `weights.ts`, `tensor.ts`,
`final.ts`, plus kernel/Kuwahara visualizers.

Progression: quadrant means/variance → circular sectors → weighted contributions →
polynomial weights → structure tensor → oriented anisotropic kernel.
Large kernels strengthen abstraction and artifacts. Gaussian weighting costs
more inside nested loops; the polynomial alternative is motivated by that cost.

Choose the simplest variant that produces the intended strokes. The conclusion
explicitly finds the Papari extension with polynomial weighting sufficient in
many cases. The article's anisotropy tuning is empirical and scene-dependent,
not a universal parameter default.

Checks: texture sample count, finite variance, nonzero normalization weights,
zero-gradient/eigenvector degeneracy, edge preservation, and temporal stability
under motion. Compare intermediate outputs on the same frame. New experiment:
guide strokes with a different meaningful field, document why it differs from
image-gradient guidance, and show the tradeoff.

## 11 · Dithering, quantization, and CRT

**Read:** [Dithering and Retro Shading](corpus/articles/the-art-of-dithering-and-retro-shading-web.mdx).
**Code:** `Retro/ordered.ts`, `blueNoise.ts`, `grayscale.ts`, `palette.ts`,
`hue.ts`, `pixel.ts`, `rgb.ts`, `curve.ts`, `final.ts`.

Progression: thresholding → ordered Bayer/blue noise → quantization/palette →
pixelation → RGB cells → curvature → scanline/distortion composition.
Quantization selects representable colors; dithering distributes selection
spatially. Pixel-cell coordinates differ from image UVs.

Decide whether the pattern is tied to display pixels, downsampled cells, or the
object. Name the color space for palette distance and output. More distortion
does not automatically make the result more readable.

Checks: palette endpoints, stable pixel size across DPR, cell alignment,
out-of-range curved UVs, brightness after RGB masks, and pattern aliasing.
New experiment: build a new encoding or display metaphor, then compare its
tone preservation to the baseline quantizer.

## 12 · Sculpting pixels into new media

**Read:** [Post-processing as a Creative Medium](corpus/articles/post-processing-as-a-creative-medium.mdx).
**Code:** `PostProcessing/dots.ts`, `ascii.ts`, `led.ts`, `crochet.ts`,
`lego.ts`, `fluted-glass.ts`, `depixelation.ts`, `mouse-trail.ts`.

Progression: normalized pixel size → sample grid → local cell shape → complex
patterns/atlases → material illusions → interactive sampling.
Keep three domains explicit: screen UV, cell index/sample location, and local
coordinates inside a cell. This separation is the basis for transfer to new
visual media.

The crochet/LED variants demonstrate offsets and staggering; a glass variant
changes sampling rather than simply drawing a texture. A trail requires a
defined update/fade model.

Checks: square cells at non-square aspect ratios, sample centers, atlas bounds,
edge filtering, input mapping, and reset of persistent state. New experiment:
invent a cell geometry or optical illusion that reads input luminance in a new
way, with controls that expose the construction.

## 13 · Volumetric lighting in a raster scene

**Read:** [On Shaping Light](corpus/articles/shaping-light-volumetric-lighting-with-post-processing-and-raymarching.mdx).
**Code:** `VolumetricLighting/lightray.ts`, `depthstop.ts`, `sdf.ts`,
`shadows.ts`, `scattering.ts`, `performance.ts`, `multiLight.ts`, `cubeCam.ts`.

Progression: reconstruct world-space rays → march light → stop at scene depth →
shape beam → light-space shadow map → phase/noise → jitter and composition.
Camera depth prevents light behind visible geometry from leaking through walls;
light-space visibility answers a different question: can the light reach this
sample?

Use common coordinates for every comparison. Handle inverse projection and
perspective divide explicitly. A view-dependent trick can be a useful art
direction choice, but explain its limits. The archive describes cubemap-depth
workarounds and unfinished multi-light limitations.

Checks: near/far changes, moving cameras/lights, occluders entering the beam,
shadow bias, banding, and sample cost per light. New experiment: shape the beam
or its density with a new field and compare occlusion with/without shadow data.

## 14 · TSL and WebGPU compute

**Read:** [Field Guide to TSL and WebGPU](corpus/articles/field-guide-to-tsl-and-webgpu.mdx).
**Code:** `TSLWebGPU/fallback.ts`, `blob.ts`, `glassblob.ts`,
`computeInstance.ts`, `particleInit.ts`, `attractor.ts`, `postprocessing.ts`,
`outline.ts`, `common/`.

Progression: distinguish API/language → node graph → async renderer → displaced
material/normals → texture access → storage/compute → particle update →
post-processing. TSL is an abstraction/node system; WebGPU is a graphics API.
Native WGSL chunks still need correct node integration in these examples.

Checks: renderer readiness, node caching/uniform lifetime, texture binding type,
buffer stride, bounds checks when dispatch rounds up, compute ordering,
read/write hazards, and unsupported-device behavior. Query actual device limits;
the article's workgroup statement should not be elevated into an invariant.
Do not silently treat a compute shader as WebGL-compatible.

New experiment: make a stateful process that benefits from compute, not a
stateless effect moved to compute merely for its label.

## 15 · Halftone and neighborhood-aware marks

**Read:** [Shades of Halftone](corpus/articles/shades-of-halftone.mdx).
**Code:** `Halftone/halftone.ts`, `cmyk.ts`, `gooey.ts`, `jittered.ts`,
`MoireDemo.tsx`, `ColorBlending.tsx`.

Progression: repeated dots → tone-driven size → alternate shapes → rotated
channel grids → additive/subtractive blending → CMYK → cross-cell neighborhoods
→ merging/displacement. A cell-local implementation clips marks at its walls;
neighbor sampling allows overlap at an increased cost.

Separate luma-to-coverage mapping from distance-to-shape evaluation. Dot area
depends on squared radius, so explain whichever transfer function the actual
shader uses. Color-channel angle choices affect moiré; RGB addition and
subtractive ink simulation are different models.

Checks: black/white endpoint behavior, derivative-based edge smoothing,
grid/sample rotation consistency, neighborhood radius versus displacement,
and aliasing at small cells. New experiment: a new mark shape or nonuniform
packing driven by a meaningful signal, with isolated coverage comparisons.

## 16 · Motion as a shader input

**Read:** [Shading Motion](corpus/articles/shading-motion.mdx).
**Code:** `ShadingMotion/asciiMotionMaskCompute.ts`, `blobTrackingCompute.ts`,
`opticalFlowCompute.ts`, `velocityMapScene.ts`, `objectSmearScene.ts`.

Progression: current/previous frame luminance difference → threshold → decaying
history → stylization → blob slots → approximate optical flow → object velocity
and motion blur. A difference mask measures image change, not semantic object
motion. Illumination and camera movement can trigger it.

Define initialization, ping-pong roles, history decay, detection resolution,
and reset behavior. Flow estimation and known object velocity are distinct
inputs. The article's small blob-buffer CPU readback is a scoped choice, not
permission to read full-frame textures to CPU every frame.

Checks: first frame, static input, camera cut, resize, zero-gradient regions,
history persistence at differing rates, buffer bounds, and readback stalls.
New experiment: a new visual response to motion or memory, with raw mask/flow
views and an explicit account of false positives.

## 17 · Atmospheres and LUT decomposition

**Read:** [Sky, Sunsets, and Planets](corpus/articles/on-rendering-the-sky-sunsets-and-planets.mdx).
**Code:** `AtmosphericScattering/skyDome.ts`, `planet.ts`, `eclipse.ts`,
`lut.ts`; separately pinned historical `lut.ts` is under `corpus/historical/`.

Progression: height density and Rayleigh scattering → Mie/ozone → light
transmittance → depth-aware planet atmosphere → eclipses → alternate atmospheres
→ transmittance/sky-view/aerial-perspective LUT composition.

Keep units, radii, altitude, view segment, light segment, scattering, and
absorption explicit. Bound the view ray by atmosphere, planet, and scene depth.
The archived LUT implementation omits multiple scattering and uses a
view-dependent 2D aerial-perspective target rather than the paper's 3D volume.
Its invalidation/update requirements follow from those choices.

Checks: observer inside/outside atmosphere, tangential rays, ground occlusion,
sun below horizon, changing parameters, and LUT staleness. New experiment:
compose a new atmosphere/lighting scenario while documenting which properties
are physically motivated and which are chosen for appearance.
