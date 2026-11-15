# Liquid Glass Blobs: research

## Question

How can liquid-glass blobs that merge and split be drawn in TouchDesigner so they work in any 3D scene, with any camera and correct depth, and still carry the family's glass look?

## Sources retrieved

All archive sources were read with `skills/research/scripts/corpus.py` (`article`, `read`, `search`) and `demos.py` (`list`, `show`, `export` to scratch). `corpus.py verify` reported 393 files, no errors. Line ranges, hashes and adaptations are in [sources.json](sources.json).

| Source | Mechanism | Limitation for this brief |
| --- | --- | --- |
| Heckel, *Painting with Math: A Gentle Study of Raymarching*, lines 56–134 and 245–295 | March along a ray by the distance to the nearest surface; sphere SDF; MAX_STEPS, MAX_DIST, SURFACE_DIST | Fixed camera at `vec3(0, 0, 5)`, full-screen quad, no depth for other objects |
| Same, lines 296–371 | Normal from the SDF gradient; diffuse light | Central differences, scene-space only |
| Same, lines 380–452 | `min` union and the polynomial `smoothmin`, which makes shapes "act more like liquids" | Divides by `k`; `k = 0` is undefined |
| Same, lines 453–555 | Move, rotate, scale an SDF by transforming the sampling point; scale needs a distance correction | Shown per sample in a fixed scene |
| `Raymarching/smoothmin.ts`, lines 88–137 (scene5, read with `demos.py show` and `export`) | Three spheres merged with `smin`, raymarch loop, `getNormal` | Adds Perlin displacement to the distance, which can break the distance bound |
| Heckel, *Refraction, dispersion, and other shader light effects*, lines 98–773 | Refraction from a render of the scene, dispersion, saturation, specular, fresnel, back faces | One interface; thickness is guessed |
| Heckel, *Real-time cloudscapes with volumetric raymarching*, lines 622–695 | Beer's law | Volume context; used here for tinted glass |
| Core study `studies/liquid-glass` at a6f95c6 (read with `git show`) | The family's glass shading, builder, presets, preview and checks | Single-interface bend with a Thickness slider |
| `examples/orbital-relic` | The plugin's native SDF study: explicit hit flag, zero-width smooth-min branch, conservative steps | A GLSL TOP with its own camera; no depth for other objects |
| Derivative docs: Write a GLSL MAT, GLSL MAT, CHOP to TOP, DAT to CHOP, Box SOP, Constant MAT, Render TOP, Camera COMP (read 2026-11-01) | `uTDMats[].proj` uses a 0..1 depth range ("Vulkan style"); `TDWorldToProj` is vertex-only; `TDDeform` includes instancing; parameter names | The user's installed build is authoritative |

Nothing in the archive is a native TouchDesigner raymarching material. Everything native here is a new adaptation.

**Independent review round (2026-11-01).** Two findings trace back to the archived method itself. *Refraction, dispersion, and other shader light effects*, lines 109–114, snapshots "the entire scene (the other meshes, the background, etc.)" with the mesh hidden. That assumes an opaque background (finding T1) and also captures meshes in front of the glass (T5). This study now keeps the Refraction TOP's alpha, and documents the second point. Native facts rechecked for that round: Write a GLSL MAT (`camProjInverse`, `TDFog`, picking with `TD_PICKING_ACTIVE`, `TDCheckDiscard`), the COMP Render page (`drawpriority`: smaller values draw later), CHOP to TOP (channels by order, `clamp`), and the Transparency page (Order Independent Transparency needs blending off; its Draw Priority wording contradicts itself). Outside Derivative, the fast-math default in MoltenVK's configuration docs and TouchDesigner-style shaders in glslang's tests were also checked. See [sources.json](sources.json) and [review.md](review.md#independent-review).

## Routes compared

| Route | What the viewer gets | Cost | Fit |
| --- | --- | --- | --- |
| Full-screen GLSL TOP raymarcher (like orbital-relic) | Correct blobs, but on its own camera; no depth against other objects unless the scene's depth and camera are wired in by hand | One full-screen pass | Fails "least wiring" |
| Mesh the field (Metaball SOP or marching cubes), wear the core material | Rasterized blobs with depth for free | Remeshing every frame; thickness still guessed; faceted merges | Weaker look, heavy |
| **GLSL MAT on a proxy box, writing `gl_FragDepth`** | Blobs inside an ordinary object: any camera, transforms, instancing, correct depth; real thickness from the field | Every box pixel runs the march; no early depth rejection | **Chosen** |

## What the references require

- Reference 1 (dense rainbow): high Dispersion and Saturation; the colour-gap mipmap keeps the rainbow continuous. Preset Prism Clear.
- Reference 2 (lavender gel, violet rims): Beer-Lambert tint over the real path plus Edge tint; low IOR and Backdrop distance keep it see-through. Preset Lavender Gel.
- Reference 3 (magnifying blob with droplets): a large body with real lens paths (it magnifies and flips the logo) and droplets that circle beside it and merge. Preset Sapphire Drops.
- Reference 4 (reflective glass over bold type): high IOR and Backdrop distance, strong reflections and Mirror, colour fringes. Preset Type Lens.

## Answer

Yes, as a GLSL MAT on a 2x2x2 proxy box. The box's back faces mark which pixels to march; the ray runs in the box's own space; the hit writes the depth a rasterized surface would have. The glass look is the core's, with two changes that the real geometry allows: the path through the glass is measured by marching inside the field, and colours spread far enough that each colour sample needs a matching mipmap level. Blob layout is procedural by default, or comes from a layout TOP (from a CHOP or Table DAT). See [decisions.json](decisions.json) for every consequential choice and [the tutorial](article.md) for how each part works.

## Family sync (2026-11-02)

The core study's audit rounds 2 and 3 and the family's merge items were brought in from commit 6a58487 (see [review.md](review.md#family-sync)). The native API facts they depend on were rechecked on docs.derivative.ca the same day: Write a GLSL MAT documents the output array `fragColor[TD_NUM_COLOR_BUFFERS]` and warns against writing past the buffer count, `TDDither()` and the picking define; the Render TOP and Render Pass TOP pages name the Dither toggle `dither` without stating its default; the ObjectCOMP and Matrix classes document `worldTransform` and `determinant()`. The fan-gap mipmap level that started here was measured against a 64-sample reference with the core's method and reduced to a quarter of the gap ([decisions.json](decisions.json)). A later reread of the page's Picking section (verifier finding P1) showed that only the `#else` block runs while picking; `blobs.vert` now uses that form, with the projection before the branch as in an exported MAT shader on docs.derivative.ca/Syntaxhighlight ([review.md](review.md#picking-form-fix)).
