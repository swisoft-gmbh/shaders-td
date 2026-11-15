# Archive coverage recheck for five native studies

This recheck reconciles the archive (collected from public sources) with the
actual portable plugin. It does not infer completeness from the number of files alone. The machine-readable
[report](../validation/five-mechanisms/archive-recheck.json) records the
source hashes, catalog hashes, article decisions and repository scan results.

## What was checked

- All **60 cataloged articles**, **51 repositories**, **26 gist groups** and
  **25 historical source records** were reconciled with the existing coverage
  inventory. Gist and historical decisions remain documented in that inventory.
- All **393 preserved records** were checked against both the bundled bytes and
  their original archive files. Every hash matched. (That was the count at the
  time. Since 0.6.0 the plugin bundles 381 files: 379 of those records plus 2
  added MIT licence texts. The other 14 records are withheld because nothing
  licenses their redistribution.)
- A fresh scan read **1,431 authored source files** across the repository roots,
  without the earlier 250 KB source-file size cutoff. Dependency/build output
  and `.git` were excluded. The custom-shader pattern matched **167 files**;
  all were already bundled. No unbundled article matched that shader pattern.
- The wider earlier scan also counted R3F usage; its 186 blog signal files use
  a different pattern. These counts are not cumulative and do not represent
  missing or newly discovered tutorials.
- The full non-retired archive path index contained no `.toe` or `.tox` files.
  Indexed TouchDesigner mentions still resolve to *Shading Motion* and two
  captures of that article. These are web implementations inspired by
  TouchDesigner. This is an archive finding, not a claim about all of the
  author's work outside the collection.

This is a bounded source-pattern and catalog audit. A zero missing-match result
is not proof that every useful sentence, media asset or external paper has been
included. The prior [coverage inventory](coverage-audit.json),
[media catalog](../skills/research/references/media-catalog.json), [source formats](../skills/research/references/source-formats.md) and
[article links](../skills/research/references/article-reference-links.json) preserve those distinctions.

## Source closure for the five samples

| Sample | Primary archived mechanism | Matching implementation | Added native work |
|---|---|---|---|
| Orbital Relic | Surface raymarching and SDF composition | Raymarching `smoothmin.ts`, scene5 | Explicit hit flag, native uniforms, sphere/normal/aspect tests. |
| Lantern Fog | Volume density, Beer attenuation, light marching | Raymarching `lightTransmittance.ts`, scene18 | Correctly separated view/light transmission and segment-length integration; analytic slab checks. |
| Pigment Census | Basic Kuwahara neighborhood statistics | PainterlyShaders `basic.ts`, scene1 | Native texel addressing, radius-zero and constant/edge/grain fixtures. |
| Resonant Foil | Vertex displacement and displacement varyings | ShaderReactThreeFiber `blob.ts`, scene6 | Analytic Jacobian normal correction and native world-space transforms. |
| Tidal Ink | Simulation/render separation; previous-state/decay context | Particles `curlFBO.ts`, scene8; *Shading Motion* | Persistent periodic pigment advection in a prescribed field; additional primary advection reference. |

Every row has an individual `research.md`, exact `sources.json` hashes and line
ranges, decisions, native source, tutorial, captures and review. The five runtime
networks use procedural data and embedded GLSL. They need no external model,
video, texture, font, JavaScript package, camera, audio source or network service.

## What was added, and what remains external

The archive did not supply a native API manual. The plugin already contains
linked official Derivative guidance and observed host contracts. The new
[extension notes](../skills/research/references/native-extended-mechanisms.md) add tested integration, normal,
filter and transport details. Native behavior was checked in TouchDesigner
2025.33230 on macOS; it is not inferred from the archived web code.

The Tidal Ink transport algorithm is an explicit extension of the archive's
state/render architecture. [Mark J. Harris's GPU Gems chapter 38](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)
was consulted as a supplemental primary reference for backward advection. It is
linked and summarized, not silently attributed to Heckel or redistributed as a
full text in the corpus.

Not every external research paper, image, video, model or historical website
linked by the archive is bundled. The recovery records also document missing
binary URLs and failed historical captures. Those gaps do not block these five
procedural samples, but an exact reproduction using those assets needs a new
asset/dependency audit. Compute/POPs, live inputs and other native builds remain
separate implementation and test work.
