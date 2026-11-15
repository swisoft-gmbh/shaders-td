# Liquid Glass Prism: research

## Question

Can the family's universal glass material bend light at both surfaces, trap it past the critical angle and split it by wavelength through both surfaces, while still working on any object with no extra wiring? Which storage should an optional back-face pass use?

## Starting point

The core study (commit a6f95c6, read with `git show`) refracts once and slides the view by Thickness. Its limits section names what is missing: exit refraction, multiple bounces and total internal reflection. Its optional back-face pass stores colour and distance, not normals.

## Sources retrieved

Archive integrity: `python3 skills/research/scripts/corpus.py verify` reported 393 files checked, no errors (2026-11-01). Line ranges, hashes and adaptations are in [sources.json](sources.json).

| Source | Mechanism | Limitation for this brief |
| --- | --- | --- |
| Heckel, *Refraction, dispersion, and other shader light effects*, lines 226-320 | `refract()` of the eye vector, added to the screen position | One surface; `refractVec.xy` is added to the screen position without projecting it through the camera (his scenes can be orbited) |
| Same, lines 322-464 | Per-colour IORs and extra samples per loop | One surface; colours split once |
| Same, lines 696-773 | Backside rendering: back faces first, then front faces, same material; cites Codrops multiside refraction (line 698) | The back side is shaded, not used to bend light a second time |
| `RefractionDispersionReactThreeFiber/final.ts` (scene9, decoded with `demos.py export`), lines 1-129 and 233-273 | Six-IOR 16-sample loop (shader string); back FBO, then front FBO (useFrame) | Web render loop, six bands at 2-3 reads each |
| Heckel, *Shining a light on Caustics*, lines 45-81 | An explicit approximation instead of ray tracing; converging rays brighten | Needs a light-space render and a receiver plane |
| Same, lines 82-212 | Normals rendered into a render target with a swapped material (back side) | Normals packed as colour, light camera |
| Same, lines 223-411 | Caustic intensity = area before / area after refraction (screen derivatives), clamp and square | Derivatives are per 2x2 quad and per triangle |
| Same, lines 412-470 | Chromatic aberration smoothed with per-pixel random noise | Noise is dithering, which the brief excludes |
| Heckel, *render targets* article, lines 329-380 | Screen-coordinate sampling | Same as core |
| Codrops, Jesper Vos (2019), via Heckel | Back-face world normals in a texture, blended into the front normal | Read through search summaries (the page returned 403) |
| Wyman (SIGGRAPH 2005) | Two-surface image-space refraction with back-most depth and normal maps | Read through summaries, not full text |
| Derivative docs: Write a GLSL MAT (oldid 38399), Render TOP (oldid 36456), Render Select TOP (oldid 23988) | Multiple colour buffers (`fragColor[TD_NUM_COLOR_BUFFERS]`, `numcolorbufs`, `colorbufindex`); `format` `rgba32float`; `overridemat` | Read 2026-11-01; the installed build is authoritative |
| Derivative docs, family sync: Write a GLSL MAT (oldid 38399), Render TOP (oldid 36456), Render Pass TOP (oldid 32225) | Picking branch, `fragColor[TD_NUM_COLOR_BUFFERS]`, `TDFog()`, `TDDither()`; `dither`, `cleardepth`, `cleartocamcolor`, `overridemat` | Read 2026-11-02; the Dither default is not stated |
| Core Liquid Glass study after commit 6a58487; Liquid Glass Blobs (6a58487) | The family's later fixes and merge items (drift clock, Render Pass TOP route, covered alpha, R2 frost, Object size, ...) | Family code, not archive sources; see review.md (Family sync) |

Nothing in the archive is a native TouchDesigner refraction project. Everything native here is a new adaptation.

## Routes compared

| Route | What the viewer sees | Cost | Fit |
| --- | --- | --- | --- |
| Core single surface | Bent view, rainbow at one surface; no trapped light | N reads per pixel | Baseline; fails "both interfaces" |
| Two surfaces, analytic far side (ball + Exit tilt) | Both bends, TIR at rims, exact for balls | N reads + bounce | Default: no wiring |
| Two surfaces, measured far side (back-face pass) | Both bends at the real far wall, TIR where the real wall is steep | One extra render, up to 16 texel reads | Optional |
| Ray tracing or ray marching the object | Exact paths, many bounces | Needs the object as an SDF or BVH | Rejected: not a drop-in material |

## Back-face storage

| Option | For | Against |
| --- | --- | --- |
| Multiple render targets (`fragColor[TD_NUM_COLOR_BUFFERS]`, Render TOP `numcolorbufs` = 2, Render Select TOP `colorbufindex`) | Could also keep the core's shaded back colour | The shared shader must match each Render TOP's buffer count; the docs warn that writing past it can corrupt or crash the GPU; an extra node; the Render Select page is from 2021 and does not state the index base |
| One RGBA float target (rgb = outward normal, alpha = minus the eye distance, so any non-negative background is empty) | One buffer, no extra node, same file for both passes, signed values need no encoding | No back colour (not needed: inner reflections come from the front pass); 16 bytes per pixel |
| Depth TOP + colour pass | Native depth | Depth convention and linearisation are build-specific; still needs a normal pass |

Chosen: one RGBA 32-bit float target. See [decisions.json](decisions.json).

## What the references require

- Reference 1 (clear, dense rainbow): wide, ordered fringes from two-surface dispersion with a Cauchy-shaped spread; bright bands from trapped light. Spectral Prism, Diamond Fire.
- Reference 4 (reflective glass bending bold type): a magnifying two-surface lens with thin fringes and strong reflections. Type Lens.
- Reference 2 (lavender gel): core tint and edge tint plus inner reflections. Lavender Prism, Violet Gel.
- Reference 3 (blue-violet magnifying drop): core Sapphire Drop values with two-surface optics.

## Answer

Yes. One GLSL MAT traces each spectrum slice through both surfaces, with exact Fresnel at the exit, a one-bounce lookup for trapped light, and a closed-form caustic glow. The far side is guessed (ball plus Exit tilt) by default and measured by an optional pass that stores normal and distance in one float image. Native behaviour is pending.

An independent review found that the first property tests read diagnostic stages, not the image: 9 of 12 deliberately broken shader copies passed them. Tests now also read the rendered image over a backdrop that stores its own screen position, against independent traces; see [review.md](review.md#independent-review). The review also showed a difference from Heckel's method that matters: his article offsets the lookup by the refracted vector in screen space, `uv + refractVec.xy * power` (refraction article lines 430-432), which stays bounded. This study projects a 3D point instead, which can land near or behind the camera and can squeeze a large part of the scene into a few pixels. The shader now keeps projected points at least half as far from the camera as the surface, and reads a mip level as wide as each lookup's footprint.

## Family sync (2026-11-02)

The study was brought up to the core study's later state (its audit rounds 2 and 3 and the merge items C1 to C9). Two questions needed this study's own measurements, because its optics differ from the core's:

- **Fan-gap dispersion level (C3).** Against 64 slices at Samples 16 (round-2 B7 method), the fan gap made the rainbow worse in 9 of 10 cases with changed pixels (Spectral Prism torus: 1.47 to 5.89/255 mean error, 0 to 19 pixels over 32). Rejected, as in the core. The blobs study later adopted a quarter of the gap, so the verifier round measured that too, on the final shader (960 x 540, refraction stage): it changes no pixel on Clear Crystal or Prism Chrome, and on Spectral Prism lowers the mean error from 2.167 to 2.154/255 (21 to 17 pixels over 32). Not adopted: it does not help two of the three presets, and the small gain on the third does not pay for two extra exit traces per pixel. The whole gap on the final shader: 1.547 / 1.315 / 4.791, with 3 / 1 / 1,510 pixels over 32.
- **This study's own footprint level.** Against a 4 x 4 supersampled render, the full footprint level was worse than no level in all 8 cases at the presets' Scene depth; the same level 2 steps lower was within -0.57 to +0.16/255 of no level there and the best variant at Scene depth 20. The shifted level is kept (decisions.json).

The screen orientation that originated here (C6) was measured against the core's later form: the derivative sign was wrong on one silhouette pixel per render, the position comparison on none, so this study now uses the comparison. A verifier then found two gaps. The flat-image reflection offsets by a camera-space direction, so unlike the bends it also needs the projection's own sign, as in the core. And on the centre line of an odd-sized render the comparison has nothing to compare (both values are 0); there the derivative sign now decides, unless the surface is nearly edge-on (decisions.json, C6).
