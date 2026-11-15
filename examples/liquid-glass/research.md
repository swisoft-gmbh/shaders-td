# Liquid Glass: research

## Question

Can one shader give "liquid glass" to any 3D object in TouchDesigner, covering the range in the four references (clear and rainbow, tinted gel, magnifying drop, reflective glass over type), and which controls does that need?

## Sources retrieved

All archive sources verified with `skills/research/scripts/corpus.py verify` (393 files, no errors). Exact line ranges and adaptations are in [sources.json](sources.json).

| Source | Mechanism | Limitation for this brief |
| --- | --- | --- |
| Heckel, *Refraction, dispersion, and other shader light effects*, lines 98–320 | Render the scene behind the mesh into a texture; sample it at the pixel's screen position offset by `refract()` | Adds `refractVec.xy` straight to the screen coordinates without projecting it through the camera, so the shift does not follow camera distance, lens or orientation (the scene itself can be orbited) |
| Same article, lines 322–559 | Per-channel IORs, extra samples per loop, saturation, RGB to rygcbv split | Six bands cost 12 texture reads per sample in the archived code |
| Same article, lines 561–773 | Squared Blinn-Phong specular, fresnel glow, back faces rendered before front faces | Back-face pass is built into a React render loop |
| `RefractionDispersionReactThreeFiber/final.ts`, lines 1–129 | The exact final shaders (16 samples, six IORs) | Web three.js conventions (`gl_FragColor`, `modelMatrix`, `winResolution`) |
| Derivative docs: Write a GLSL MAT, GLSL MAT, Render TOP, Parameter Execute DAT, Page class, Torus SOP | Native API: `TDDeform`, `uTDMats`, `uTDGeneral.viewport`, `TDFrontFacing`, sampler and blending parameters | Read 2026-11-01; the user's installed build is authoritative |

Nothing in the archive is a native TouchDesigner liquid-glass project. Everything native here is a new adaptation.

## Routes compared

| Route | What the viewer sees | Cost | Fit |
| --- | --- | --- | --- |
| Environment map only (Phong/PBR-style) | Reflections and a fake tint; objects behind the glass do not bend | Cheap | Fails references 2 and 4 |
| Screen-space refraction from a TOP (Heckel's FBO idea) | Real bending of whatever is behind, dispersion, frost | One extra scene render, N texture reads per pixel | Chosen |
| Ray-traced or raymarched glass | Physically closer, multiple bounces | Needs the scene as SDFs or a ray tracer; not a material for "any object" | Rejected |
| Two-pass back-face refraction | Inner surfaces, measured thickness | A second render of the glass | Added as an option, off by default |

## What the references require

- Reference 1: strong dispersion along high-contrast edges and an oil-film sheen. Covered by Dispersion, Saturation, Iridescence.
- Reference 2: pale body, saturated rims, see-through. Covered by Glass colour, Tint density and Edge tint (Beer-Lambert absorption over a longer path at grazing angles), Translucency.
- Reference 3: magnification and cool rim light. Covered by IOR, Thickness, Rim colour.
- Reference 4: strong reflection with colour fringes over type. Covered by Mirror, Reflection, Dispersion.
- All four: a liquid feel. Covered by Wobble (animated normal ripples) and the film swirl.

## Answer

Yes, as a screen-space GLSL MAT with two TOP inputs. The look range comes from roughly 30 continuous controls grouped into glass body, optics, reflection, light and liquid, plus twelve presets. See [decisions.json](decisions.json) for each consequential choice and [the tutorial](article.md) for how each part works.

## Family sync (2026-11-02)

Four family members forked this study at commit a6f95c6: Liquid Glass Flow (moving silhouettes), Blobs (raymarched blobs), Prism (two-surface optics) and Lit (TouchDesigner lights). Each solved integration problems this core still had. The sync read each member's code and tests at commit 6a58487 and the relevant Derivative pages again (Write a GLSL MAT: picking, multiple render targets, TDFog, TDDither; Render TOP and Render Pass TOP: the `dither` parameter; SOP, Geometry COMP, Object COMP and Matrix classes: bounds and world transform). Which ideas came from where, and what changed in the adaptation, is in [sources.json](sources.json); each choice, including the rejected fan-gap dispersion level and the ideas left in the members, is in [decisions.json](decisions.json); the tests are in [review.md](review.md#family-sync).
