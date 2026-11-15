# Third-party code inside the bundled source

Maxime Heckel's blog source quotes code from other authors and credits them in
comments. Those credits are kept exactly as he wrote them. His MIT grant covers
his own code, not theirs, so each item below keeps its own terms.

Paths are relative to `skills/research/references/corpus/blog/core/`.
Licences were checked on 14 November 2026 against each project's repository.
"Not stated" means the source names the author but no licence; treat that code
as reference only.

| Code | Author | Licence | Source | Files (line of the credit) |
| --- | --- | --- | --- | --- |
| Simplex noise | Ian McEwan, Ashima Arts | MIT, stated in the file header. Text: [`LICENSES/MIT-webgl-noise.txt`](LICENSES/MIT-webgl-noise.txt) | https://github.com/ashima/webgl-noise | `components/MDX/Widgets/ParticlesReactThreeFiber/curlFBO.ts:32`, `components/MDX/Widgets/ShaderReactThreeFiber/gradient2.ts:3` |
| Classic Perlin noise (`cnoise`, `pnoise`) | Stefan Gustavson | MIT in the webgl-noise repository; not stated in these files. Text: [`LICENSES/MIT-webgl-noise.txt`](LICENSES/MIT-webgl-noise.txt) | https://github.com/stegu/webgl-noise | `components/MDX/Widgets/Halftone/gooey.ts:72`, `components/MDX/Widgets/Halftone/halftone.ts:47`, `components/MDX/Widgets/ShaderReactThreeFiber/blob.ts:3` |
| glsl-noise, simplex 2D | Hugh Kennedy (hughsk) | MIT. Text: [`LICENSES/MIT-glsl-noise.txt`](LICENSES/MIT-glsl-noise.txt) | https://github.com/hughsk/glsl-noise | `components/MDX/Widgets/ShaderReactThreeFiber/gradient2.ts:11` |
| glsl-noise-simplex, 3D | guoweish | MIT. Text: [`LICENSES/MIT-glsl-noise-simplex.txt`](LICENSES/MIT-glsl-noise-simplex.txt) | https://github.com/guoweish/glsl-noise-simplex | `components/MDX/Widgets/ParticlesReactThreeFiber/curlFBO.ts:27` |
| glsl-rotate | Damien Seguin (dmnsgn) | MIT. Text: [`LICENSES/MIT-glsl-rotate.txt`](LICENSES/MIT-glsl-rotate.txt) | https://github.com/dmnsgn/glsl-rotate | `components/MDX/Widgets/ParticlesReactThreeFiber/animateShader.ts:7`, `customPointShader.ts:15`, `customizeSizeShader.ts:7`; `components/MDX/Widgets/Raymarching/infinitySpheres.ts:22`, `mengerFractal.ts:23`, `richardmattka.ts:22` |
| Transmission code | Khronos Group, glTF-Sample-Viewer | Apache-2.0. Text: [`LICENSES/Apache-2.0-glTF-Sample-Viewer.txt`](LICENSES/Apache-2.0-glTF-Sample-Viewer.txt) | https://github.com/KhronosGroup/glTF-Sample-Viewer | `components/MDX/Widgets/Caustics/dynamicCaustics.ts:311` |
| glsl-curl-noise2 | drcmda | Not stated: the repository has no licence file | https://github.com/drcmda/glsl-curl-noise2 | `components/MDX/Widgets/ParticlesReactThreeFiber/curlFBO.ts:26`; imported by name in `features/IndexSection/gpgpu/simulationFragment.glsl:10` |
| Shader `ltKBDd` | battlebottle (Shadertoy) | Share-alike, non-commercial: see below | https://www.shadertoy.com/view/ltKBDd | `components/MDX/Widgets/Raymarching/beersLaw.ts:26`, `bicubicFiltering.ts:26`, `lightTransmittance.ts:26`, `phase.ts:26`; `components/MDX/Widgets/RenderTargetsReactThreeFiber/postprocessing.ts:4` |
| 2D noise, shader `4dS3Wd` | Morgan McGuire (Shadertoy) | Share-alike, non-commercial unless the author states otherwise: see below | https://www.shadertoy.com/view/4dS3Wd | `components/MDX/Widgets/Retro/final.ts:12` |
| Cosine colour palette, fog | Inigo Quilez | Not stated | https://iquilezles.org/articles/ | `components/MDX/Widgets/Raymarching/infinitySpheres.ts:42`, `mengerFractal.ts:43`, `richardmattka.ts:42`, `smoothmin.ts:81`, `martianLandscape.ts:89` |
| RGB to CMYK | Matt DesLauriers | Not stated | https://gist.github.com/mattdesl/e40d3189717333293813626cbdb2c1d1 | `components/MDX/Widgets/Halftone/CMYKHalftoneDemo.tsx:59`, `components/MDX/Widgets/Halftone/cmyk.ts:40` |
| `range()` snippet | Josh W. Comeau | Not stated | https://www.joshwcomeau.com/snippets/javascript/range/ | Eight files in `components/MDX/Widgets/RefractionDispersionReactThreeFiber/`: `advancedSampling.ts:100`, `fresnel.ts:132`, `saturation.ts:71`, `simpleDispersion.ts:55`, `simpleRefraction.ts:22`, `simpleSampling.ts:62`, `specular.ts:121`, `transparency.ts:25` |
| Hue dithering | Alex Charlton | Not stated | http://alex-charlton.com/posts/Dithering_on_the_GPU/ | `components/MDX/Widgets/Retro/hue.ts:83` |

## The Shadertoy files

Shadertoy's terms put a shader under CC BY-NC-SA 3.0 Unported when its author
states no other licence (https://www.shadertoy.com/terms, read 13 November
2026). Whether the two authors above stated one was not checked. Until someone
checks, the six files based on those shaders are not covered by the MIT label
on the rest of `corpus/blog/`.

For agents and users this means: read those six files to understand the
technique, and do not copy or adapt their code into a study. The exception is a
user who has read the shader's own page and accepts its terms, which by default
are non-commercial and share-alike; the study then carries that licence and the
author's credit.

## Using the rest

- MIT and Apache-2.0 code may be adapted if the author's notice stays with the
  copy. The licence texts are in [`LICENSES/`](LICENSES/).
- Code marked "Not stated" is reference only. Write your own version of the
  idea and credit the author for it.
- When a study uses an algorithm from this table, its tutorial credits the
  author named here, not Maxime Heckel.
