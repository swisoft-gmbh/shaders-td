# Refraction and reflection glass

Read when: building or porting a refractive, dispersive or reflective
material (glass, liquid, crystal, lens).

Evidence: the preview-only liquid-glass examples ([status](../../review/references/host-free-checks.md#status-of-the-liquid-glass-evidence))
and Heckel's refraction article in the corpus.

## Contents

- [Start from the liquid-glass examples](#start-from-the-liquid-glass-examples)
- [Project the bend through the camera](#project-the-bend-through-the-camera)
- [Separate bend strength from colour split](#separate-bend-strength-from-colour-split)
- [Blur and disperse without dithering](#blur-and-disperse-without-dithering)
- [Conserve energy and absorb along the chord](#conserve-energy-and-absorb-along-the-chord)

## Start from the liquid-glass examples

Five GLSL MAT studies of refraction glass for any mesh live in
`../../../examples/liquid-glass*`. Know their status before you reuse them:

- They are preview-only: glslang compiles against TouchDesigner stand-ins,
  WebGL2 previews of the same GLSL and Python unit tests. Nothing in them ran
  in TouchDesigner, and they have no `.tox`.
- `scaffold.py --example` does not offer them, so copy a folder
  instead. Flow's and Lit's tests that read the sibling core skip when it is
  absent.
- If `../../../examples/` is missing (skills copied without the plugin),
  continue without them.

Read the core first. Read a member only for what it adds.

| Study | Read when | What to open |
| --- | --- | --- |
| [liquid-glass](../../../examples/liquid-glass/README.md) (core) | First, for any glass material. | The bend projected through the camera, spectral dispersion with one texture read per sample, mipmap frost, presets with an A/B morph and a CPU clock (`advance()` in `presets.py`), the Render Pass TOP route, the back-face data pass, Fit to Glass geometry, the picking, colour-buffer and fog hooks, and the host-free check harness in `checks/`. Its `article.md` is the tutorial for TouchDesigner users new to GLSL. |
| [liquid-glass-flow](../../../examples/liquid-glass-flow/README.md) | The vertices must move. | Crack-free displacement, finite-difference normals, a float64 time reference (`checks/flow_reference.cjs`), and fork guards (`checks/core_reference` and `EXPECTED_PIXEL_DIFF` in `checks/test_study.py`). |
| [liquid-glass-prism](../../../examples/liquid-glass-prism/README.md) | You want cut-crystal optics. | Per-wavelength exit normals (one shared exit normal falsely trapped violet light on 20,952 pixels), exact unpolarised Fresnel and total internal reflection at the exit, a secant exit estimate, a ball-lens caustic glow, and image tests against an independent ray trace over a backdrop that stores its own screen position. |
| [liquid-glass-lit](../../../examples/liquid-glass-lit/README.md) | The glass must take scene Light COMPs and an Environment Light COMP. | The light-count compile matrix with negative tests in `checks/compile_glsl.py`. |
| [liquid-glass-blobs](../../../examples/liquid-glass-blobs/README.md) | The glass itself is a raymarched distance field that must sort with the scene. | The proxy box that writes depth, blob data from a Table DAT or CHOP, and look decision packets in `co-design.json`. |

For the user-facing choice, point to
[Which one to use](../../../examples/LIQUID-GLASS.md#which-one-to-use).

## Project the bend through the camera

Convert the refracted ray's sideways shift to screen UV through the camera's
projection, because a fixed UV offset ignores distance, size, aspect ratio
and focal length.

Heckel's article adds `refractVec.xy` straight to the screen UV
(`skills/research/references/corpus/articles/refraction-dispersion-and-other-shader-light-effects.mdx`,
line 312, `uv + refractVec.xy`; Maxime Heckel,
[Refraction, dispersion, and other shader light effects](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/)).
His deployed [/refraction demo](https://r3f.maximeheckel.com/refraction)
(read 3 November 2026) offsets the UV by the normal. Neither goes through the
projection. So a far or small object shifts as many UV units as a near or
large one; on 16:9 a horizontal shift covers 1.78 times the pixels of a
vertical one; and nothing follows focal length.

- **Core method:** refract the view ray in world space. Take the sideways
  shift in camera space, times thickness. Convert it to UV with
  `0.5 * abs(vec2(proj[0][0], proj[1][1])) / depth`, which includes the
  aspect ratio. Scale thickness by Object size
  ([world scale](material-integration.md#follow-the-objects-world-scale)).
- **Prism method:** project the exit and travel points with the camera's
  view-projection matrix. Pull any point behind or near the camera to at
  least half the reference clip w; before this, 8% to 28% of lookups landed
  behind the camera at large depth.
- **Check:** render one preset at two distances and at two scales.

Limits:

- Only what is on screen refracts.
- Objects in front of the glass appear bent inside it unless the background
  render leaves them out.
- It needs Render Mode 2D and one camera per render. Multi-camera, stereo,
  cube-map and fisheye renders (Docs:
  [Render TOP](https://docs.derivative.ca/Render_TOP)) still read one
  background image, so they refract one camera's view. This consequence is
  inferred, not run.

Evidence: Preview. Example: `bendOffset()` and `unitsToUV()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag);
`projectOffset()` in
[liquid_prism.frag](../../../examples/liquid-glass-prism/liquid_prism.frag).

## Separate bend strength from colour split

Give refraction strength and colour split separate controls, because users
tune them separately. In the source, one factor scales both: the article's
`uChromaticAberration` and the deployed demo's `uTransparent` multiply the
same offset. The article says so itself (line 446 of the same `.mdx` file).

- Centre the spectral spread of IOR (index of refraction: how strongly the
  glass bends light) on the base IOR:
  `ior_i = base + spread * (w_i - 0.5)`, with `w` from 0 (red) to 1 (violet).
- Loop over spectrum samples (a uniform from 1 to 32). Each sample does one
  texture read, weighted by a smooth RGB curve normalised per channel. The
  article's six-band final reads the texture 12 times per loop step, at only
  six distinct coordinates
  (`skills/research/references/corpus/blog/core/components/MDX/Widgets/RefractionDispersionReactThreeFiber/final.ts`,
  lines 60 to 86).
- To first order, Dispersion then widens the fringe while the average image
  stays at the base bend. This follows from the formula; no dedicated test
  measures it. Preview tests cover convergence
  (`dispersion_converges_with_samples`, `samples_invariant_without_dispersion`).
- Clamp each sample's IOR as in
  [Guard degenerate maths](td-glsl-pitfalls.md#guard-degenerate-maths).

Credit Heckel's article and the sample loop he credits to Junni's ukonpower
(`@ore_ukonpower`):
[Zenn article](https://zenn.dev/junni/articles/bb71f44c89cb77) and
[next.junni.co.jp](https://next.junni.co.jp/). Junni declares its source code
MIT; none of it is copied here. Example: `spectrum()` and `transmitted()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag).

## Blur and disperse without dithering

Build blur and rainbow fringes from many deterministic samples and mipmaps,
because per-pixel jitter only turns ghost copies into grain. A `fract(sin())`
hash, or the deployed demo's `random(uv)` term, is that jitter.

- Place frost samples on a disc with Martin Roberts'
  [R2 sequence](https://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/).
  Points that took angle and radius from one golden-ratio sequence all lay
  on one spiral arm with a non-zero mean, and shifted the image: average
  offset 0.057 of the disc radius, against 0.045 with R2 (Preview).
- Read a mipmap level matched to the gap between samples, with the sampler on
  Mipmap Linear.
- Spread spectral samples in IOR. The core spreads them linearly around the
  base IOR; Prism follows Cauchy's law, in which IOR rises toward violet
  (`sliceIor()` in `liquid_prism.frag`).
- If the brief bans dithering, enforce it with a lint: no `fract(sin())` hash,
  `gl_FragCoord` only in the screen-UV helper, no `TDDither()`, and the Render
  TOPs' Dither off (core tests `test_c4_shaders_never_dither` and
  `test_c4_renders_switch_dither_off`).
- Validate any mip-level or blur heuristic against a reference before
  adopting it ([tests that can fail](../../review/references/test-quality.md#choose-sampling-changes-against-a-reference)).

Example: `discPoint()` and `sampleBehind()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag).

## Conserve energy and absorb along the chord

Light the surface reflects should not also pass through it.

- Compute `keep = 1 - clamp(reflectance, 0, 1)` and multiply the see-through
  and body terms by it. Otherwise Mirror 1 lays a reflection over a
  full-strength see-through image. Offer it as a toggle (Energy conserving)
  when presets were tuned without it.
- Tint by Beer-Lambert absorption along the measured chord (the path through
  the glass). Clamp the glass colour to 0..1 inside the absorption term only,
  or the tint becomes gain.
- Measured thickness comes from [a data pass](material-recipes.md#render-a-data-pass).

Evidence: Preview (`energy_conserving_mirror_is_pure_reflection`). Example:
`absorption()` and the compose block of `main()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag).

Source caveats (specular signs, saturation inside the loop) are in
[adaptation cautions](../../research/references/source-formats.md#known-differences-and-adaptation-cautions),
and the deployed /refraction note is in
[deployed demo evidence](../../research/references/supplemental-sources.md#deployed-demo-evidence).
The world-locked or camera-locked key light is in
[material route](material-route.md).
