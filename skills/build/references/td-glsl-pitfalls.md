# GLSL in TouchDesigner: the contract and the pitfalls

Read when: before writing or reviewing GLSL for any GLSL TOP or GLSL MAT. The
first section applies to every shader. The later ones matter when the shader
animates, branches, stores data or shades a surface.

Evidence: the basic contract follows Derivative's GLSL pages (checked 20
October and 3 November 2026) and holds in the eight native examples
(TouchDesigner 2025.33230, macOS). Lines marked "Derivative's skill" come from
its `td-glsl-shaders` skill, read 13 November 2026, and were not run here. The
pitfalls were found and fixed in the preview-only liquid-glass examples
([status](../../review/references/host-free-checks.md#status-of-the-liquid-glass-evidence)).

## Contents

- [The basic contract](#the-basic-contract)
- [Integrate animation time on the CPU](#integrate-animation-time-on-the-cpu)
- [Take derivatives before any discard or branch](#take-derivatives-before-any-discard-or-branch)
- [Guard degenerate maths](#guard-degenerate-maths)
- [Respect half-float limits](#respect-half-float-limits)
- [Set sampler filter and extend per role](#set-sampler-filter-and-extend-per-role)
- [Face the normal to the camera before refract or reflect](#face-the-normal-to-the-camera-before-refract-or-reflect)

## The basic contract

A shader that breaks one of these compiles to an error, or worse, renders
black without one.

1. **No `#version` line.** TouchDesigner adds it.
2. **Declare the output and swizzle it.** `layout(location = 0) out vec4
   fragColor;` and `fragColor = TDOutputSwizzle(color);` on every path.
   `gl_FragColor` and `texture2D()` do not exist; use `texture()`.
3. **Inputs and UVs are supplied.** Wired inputs are `sTD2DInputs[i]` and the
   UV is `vUV.st`. Do not redeclare them.
4. **Declare what you bind, bind what you declare.** TouchDesigner takes a
   uniform's type from its declaration, and a bound name with no declaration
   reads zero without an error. Numbers go on the Vectors page (`vec0name`,
   `vec0valuex`), colours on the Colors page (`color0name`, `color0rgbr`,
   `color0alpha`), named textures on the Samplers page (Derivative's skill for
   the last two).
5. **Sizes come from the texture info.** `uTDOutputInfo.res` and
   `uTD2DInfos[i].res` hold `(1/width, 1/height, width, height)`: `.xy` is one
   texel, `.zw` the size in pixels. Offset a lookup by the info of the input
   you read, which may differ from the output.
6. **Keep shapes round.** Multiply x by `res.z / res.w` before measuring a
   distance, or a circle stretches with the output's aspect.
7. **Close a feedback loop on the right node.** The Feedback TOP's `top`
   parameter names the TOP at the end of the loop, whose previous frame you
   want, not a display branch after it. Give the loop a seed for the first
   frame and a reset.
8. **Pick the pixel format for the job.** 8-bit fixed clamps to 0..1, bands in
   slow decays and stalls a multiplicative decay above zero, because the
   product rounds back to the value it started from. Use 16-bit float for
   trails and 32-bit float for data.
9. **Own the clock.** Send time as a uniform with a pause and a fixed value,
   so a tutorial can freeze a frame. For a feedback loop, choose the step and
   say which you chose: a fixed step (for example 1/60) makes every run
   repeat, which teaching and tests need and the bundled examples use; the
   measured step, `absTime.stepSeconds` (Derivative's skill), keeps a decay
   tied to real seconds when a live input's frame rate varies
   ([feedback loops](feedback.md)).
10. **GLSL TOP or GLSL Multi TOP.** Derivative's skill prefers `glslmultiTOP`
    (more than three inputs, more than one output). The bundled builder
    handles both; the eight native examples use `glslTOP`.
11. **Read the Info DAT.** `errors()` only says that the compile failed; the
    Info DAT has the line and the message.

Where a test harness exists, write each invariant as a test first and watch it
fail on a deliberately broken shader, then write the shader. A test that never
failed proves nothing ([tests that can fail](../../review/references/test-quality.md)).

## Integrate animation time on the CPU

For any shader whose motion has a speed control, keep the motion phase in
Python and send it as a uniform. Do not multiply a speed by
`absTime.seconds`, because that value counts every second since
TouchDesigner started (Docs: [AbsTime Class](https://docs.derivative.ca/AbsTime_Class)).
The eight native examples predate this rule and bind `absTime.seconds`
directly; do not carry that binding into a study that runs for hours.
It fails in two ways:

- **Precision.** A float32 uniform loses precision as uptime grows. In Flow,
  a 1e-3 finite-difference step drowned in the time offset: rebuilt normals
  were 0.62 degrees off after 1 hour and 10.1 degrees off after 24 hours
  (Preview, against a float64 reference).
- **Jumps.** `speed * absTime.seconds` jumps by the change in speed times the
  whole uptime whenever the speed changes. After 1 hour, one Morph frame
  changed the core example's image by up to 226/255 (Preview).

Fix pattern:

1. Keep one phase per component in Python doubles, in a module dict keyed by
   component path and name.
2. Each frame, add the rate times the seconds since the previous frame.
3. Wrap the phase to the noise period. Wrap the noise lattice index too
   (`c & 255`), so the wrap cannot be seen.
4. While Paused, use rate x Fixed time, so experiments repeat exactly.
5. At rate 0, do not read `absTime`, so a still look does not recook every
   frame.
6. Return the same value to every caller within a frame, so two materials
   that share the phase agree.

Example: `advance()` and `phase()` in
[presets.py](../../../examples/liquid-glass/presets.py); `latticeHash()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag).
Unverified: the frame-by-frame behaviour in TouchDesigner. That module globals
last until the DAT's text changes comes from a Derivative forum post, not the
docs. To test the pattern, see
[long-uptime tests](../../review/references/host-free-checks.md#test-time-at-long-uptime).

## Take derivatives before any discard or branch

`dFdx`, `dFdy`, `fwidth` and `texture()` with an implicit mipmap level are
undefined when the pixels of a 2x2 quad (the block of four pixels the GPU
shades together to measure derivatives) take different branches, or when one
of them is discarded. The GLSL specification says so. Unverified: on some
GPUs the results may differ between the pixels of a quad; not reproduced here.

- Compute every derivative at the top of `main()`: before `TDCheckDiscard()`,
  before any branch and before any early loop exit. Store the results.
- Call `TDCheckDiscard()` right after, because Derivative advises calling it
  early (Docs: [Write a GLSL MAT](https://docs.derivative.ca/Write_a_GLSL_MAT)).
- This covers faceted-normal fallbacks, screen-orientation measurement and
  footprint mip levels. A mipmap is a chain of pre-shrunk copies of a
  texture; a footprint mip level picks the copy that matches a pixel's size.
- Add a source-order unit test. In the core example,
  `test_r5_pixel_stage_hygiene` in `checks/test_study.py` fails if a
  derivative call follows `TDCheckDiscard()`.

Evidence: GLSL specification (the rule); Unit test (source order,
`test_r5_pixel_stage_hygiene`). The preview cannot show the defect: in it, all
pixels of a quad take the same branch
([Prism review](../../../examples/liquid-glass-prism/review.md), T6).
Example: `main()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag).

## Guard degenerate maths

Guard each operation that is undefined at an edge value, because the GPU
returns NaN or infinity there and that spreads into blur and mipmaps. Each
guard below fixed a measured defect (Preview or Unit test):

- `safeNormalize(v, fallback)` instead of `normalize()` of a zero vector.
- An `azimuth()` helper instead of `atan(0, 0)`.
- `1 - smoothstep(lo, hi, x)` instead of reversed edges. The rule already
  stood in research's
  [adaptation cautions](../../research/references/source-formats.md#known-differences-and-adaptation-cautions),
  yet a reversed edge shipped and four studies inherited it. A lint that
  parses every `smoothstep` call catches it (`test_r5_smoothstep_edges_increase`).
- GGX highlights. GGX is a common formula for the shape of a highlight. N·H
  says how closely the normal lines up with the half vector between the light
  and eye directions. Clamp N·H to 1 (float32 gives 1.0000002) and keep the
  denominator at or above 1e-8. Before the fix the denominator was zero or
  negative in 262,984 of 2,000,000 near-peak samples (numpy float32
  emulation). See `ggx()` in
  [liquid_glass_lit.frag](../../../examples/liquid-glass-lit/liquid_glass_lit.frag).
- `r0 * r0` instead of `pow(r0, 2.0)`: `pow()` is undefined for a negative base.
- Clamp each colour sample's IOR (index of refraction: how strongly the glass
  bends light) to at least 1. Below 1, red samples snapped at the critical
  angle, where `refract()` stops returning a ray
  ([core review](../../../examples/liquid-glass/review.md), B10).
- Decide what a zero vertex normal means before `TDDeformNorm()`.
- `dot(n, n) > 1e-8` also rejects NaN, because every comparison with NaN is false.

Make thresholds relative to the data's own scale, because absolute epsilons
broke at extremes:

- A 1e-12 test for faceted normals failed on small objects. The core's
  `facingNormal()` compares against `dot(dPdx, dPdx) * dot(dPdy, dPdy)`.
- At Geometry COMP scale 20,000, Blobs' `safeDirection()` threshold turned
  the normals of 19,638 of 43,020 pixels to exactly +Y. Its fix, `movedDirection()`, falls
  back only on an exact zero.
- In Flow, an absolute 1e-12 fallback kept the rest normal on 194 of 8,385
  valid, squeezed vertices, up to 46 degrees off. `flowNormal()` compares
  against the rest area instead.

On Metal through MoltenVK, fast math may treat `isnan()` as always false.
MoltenVK documents `MVK_CONFIG_FAST_MATH_ENABLED = 2` by default: fast math
unless a shader asks to preserve NaN and Inf
([Blobs review](../../../examples/liquid-glass-blobs/review.md), T12,
2026-11-01; not re-checked). TouchDesigner's setting is unknown. Testing the
exponent bits with `floatBitsToUint` is less likely to be removed this way
(`notFinite()` in [blobs.frag](../../../examples/liquid-glass-blobs/blobs.frag)).
The native positive control is pending (`native_finite_check_macos` in Blobs'
`validation.json`).

Examples: `safeNormalize()`, `azimuth()` and `faceCamera()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag);
`safeDirection()` and `movedDirection()` in
[blobs.frag](../../../examples/liquid-glass-blobs/blobs.frag).

## Respect half-float limits

A 16-bit float render (`rgba16float`) keeps about 11 significant bits, and
its largest value is 65,504. Choose the format by what the render stores:

- **Data** (distance, depth, position): use 32-bit float RGBA. The core's
  back-face thickness stepped visibly at 50 units in 16-bit.
- **Colour:** tight specular highlights overflow to infinity, and infinity
  poisons blur and mipmaps. Clamp with `min(rgb, vec3(1024.0))` just before
  `TDOutputSwizzle()`. Clamp rgb only, never data or alpha.

Evidence: Preview. Lit's lights stage reached 74,399, and the core had 7,680
non-finite pixels before the cap. Unverified: which format a user's Render TOP
uses. Example: the end of `main()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag).

## Set sampler filter and extend per role

The GLSL MAT's sampler defaults are not documented, so set filter and extend
in the recipe for each sampler and warn when setting them fails.

- **Panorama:** Mipmap Linear, Extend U Repeat, Extend V Hold. Otherwise
  blurred reflections show a seam where the panorama wraps.
- **Screen-space scene:** Mipmap Linear and Mirror, so a bent lookup past the
  frame folds back instead of smearing the edge pixel.
- **Data buffers:** Nearest, read with `texelFetch()`.

The seam-hiding panorama helper is in
[native API notes](../../research/references/native-api.md#more-glsl-mat-and-python-facts).
Evidence: Unit test of the recipe (`test_r9_sampler_extend_modes_and_menu_uniforms`).
Example: [Using the shader files by hand](../../../examples/liquid-glass/README.md#using-the-shader-files-by-hand),
step 2.

## Face the normal to the camera before refract or reflect

`refract(I, N, eta)` assumes `dot(N, I) < 0`. Near silhouettes, a perturbed
or interpolated normal can tilt away from the camera, and `refract()` then
returns the mirror reflection, even at IOR 1.

- After any normal perturbation, if `dot(n, eye) > -0.01`, remove that
  component and renormalise.
- Invariant test: with IOR 1 the glass is invisible, with the perturbation on.

Evidence: Preview. The core's invisible-glass test went to at most 1/255;
at IOR 1.55, Blobs' shortest rim chord went from 0.003 to 0.846 (the
shortest physical chord is 0.917). Example: `faceCamera()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag).
