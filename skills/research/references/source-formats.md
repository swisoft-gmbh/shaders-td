# Reading and adapting the reference library

The original files remain unchanged. The catalogs below are derived navigation,
with explicit provenance; a decoded demo is not a certified runnable application.

| Format | Read it for | Before using it |
|---|---|---|
| Article MDX | Explanations, progression, controls, captions and cited influences | Match the exact section to its widget; distinguish prose from the final scene. |
| React teaching widget | Small interactive models and diagrams | Inspect its host imports, units and dependencies. A teaching model may simplify the shader. |
| Sandpack wrapper | Scene selector, template, dependency declarations, extra files | Preserve version ranges as historical declarations; they are not a lockfile. |
| Scene module | Virtual JS, GLSL, WGSL and CSS files stored as strings | Use the decoded catalog/exporter instead of treating the outer TS file as an app. |
| Shared blog infrastructure | Code editor, setup files, preview/run controls, images, video and math | Useful teaching implementation references; site aliases and UI packages still need adaptation. |
| Standalone playground / live deployed bundle | Rendering infrastructure or deployed evidence | Follow the source hierarchy; deployed bundles do not prove the original source or current behavior. They are linked, not bundled: see [deployed demo evidence](supplemental-sources.md#deployed-demo-evidence). |
| Media catalog | Literal article image references and selected verified diagrams | Check `status`. Reference-only rows do not contain the image bytes. Videos/models/transitive assets are outside this inventory. |
| Glossary | Terminology discovery and article navigation | It was produced by the archived glossary-generation script. Confirm technical claims in authored article/code sources. |

## Contents

- [Use a scene as ordinary source files](#use-a-scene-as-ordinary-source-files)
- [Known differences and adaptation cautions](#known-differences-and-adaptation-cautions)
- [Visual reference status](#visual-reference-status)

## Use a scene as ordinary source files

From the research skill directory:

```sh
python3 scripts/demos.py list --article shades-of-halftone
python3 scripts/demos.py show shades-of-halftone::scene2
python3 scripts/demos.py export shades-of-halftone::scene2 /tmp/halftone-reference
python3 scripts/demos.py verify
```

[The scene catalog](demo-catalog.json) maps 141 embedded scenes from the 17 shader
articles. Its [deduplicated payloads](demo-payloads.json) contain 342 decoded file
contents. Exporting copies the files, MIT notice, provenance, dependency recipe
and external-URL inventory into a new directory. It never installs packages or
executes the archived JavaScript. Existing destinations are refused.

The decoder accepts static strings, static string imports and simple identifier
interpolation. Unsupported expressions must be reported rather than executed.
Merge order follows the archived host: scene files, wrapper extras, then the
React template's shared setup. Literal line numbers refer to the original
outer source file; exported line numbers refer to the decoded file. Preserve
both when describing an adaptation.

Before running an export, inspect Sandpack-specific raw-loader imports, any
template-inherited dependencies and remote resources. Inspect dynamic resource
construction too: a literal URL list is not a complete network dependency graph.
TSL scenes require an appropriate WebGPU setup; exporting them does not test
WebGPU support. Keep the archive's dependency generation separate from the
target project's dependencies.

## Known differences and adaptation cautions

These are observations from the archived snapshot, followed by our engineering
recommendations. They are not corrections silently applied to Heckel's work.

**Halftone angle variants.** `articles/shades-of-halftone.mdx`, lines 404–413, and
`blog/core/components/MDX/Widgets/Halftone/CMYKHalftoneDemo.tsx`, lines 107–110,
use C15/M75/Y0/K45. `Halftone/cmyk.ts`, lines 9–12, uses C15/M45/Y0/K75.
Name the chosen preset and explain its visible effect. There is no need to
pretend these two source variants are identical. Also inspect the scene's
black strength of 1.10 and the output range before porting its color arithmetic.

**Caustics.** Four things in the caustics source do not do what they appear
to, in `articles/caustics-in-webgl.mdx` and
`blog/core/components/MDX/Widgets/Caustics/beautifulCaustics.ts`:

- The scale of the caustic plane is computed with `Math.sqrt(a, b)` (article
  line 670; `dynamicCaustics.ts`, lines 1063 to 1066). `Math.sqrt` takes one
  argument, so the second is ignored and the "distance" is the x offset alone.
- The normal pass writes `normal * 0.5 + 0.5` (widget line 88) and the caustic
  pass reads it back with `normalize(rgb)`, without undoing the encoding
  (lines 11 to 12).
- The widget multiplies the intensity by 0.2 (line 24); the article's listing
  (lines 303 and 334) does not.
- The light uniform, a `vec3` in the shader, is created as
  `new THREE.Vector2(0, 0, 0)` (lines 55 and 170).

Port the mechanism, the ratio of a patch's area before and after refraction,
and compute distances, normals and scale yourself. Do not tune a native study
to match the demo's brightness.

**Refraction spaces.** The refraction article uses `normalMatrix` in its normal
example while constructing an eye vector from world positions. The final
`RefractionDispersionReactThreeFiber/final.ts`, lines 119–128, instead transforms
the normal with `modelMatrix`. For a new implementation, put both vectors in
one stated coordinate space and use an inverse-transpose normal transform for
nonuniform scale. The final snippet's model-matrix shortcut is not a general
normal-transform solution. Three.js computes its normal matrix from the model-view
matrix; consult the target version's renderer when adapting.
[Three.js renderer source](https://github.com/mrdoob/three.js/blob/dev/src/renderers/WebGLRenderer.js).

**Specular signs.** The final scene's highlight uses flipped vectors. The article
is [corpus/articles/refraction-dispersion-and-other-shader-light-effects.mdx](corpus/articles/refraction-dispersion-and-other-shader-light-effects.mdx)
([published post](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/)).

- `RefractionDispersionReactThreeFiber/final.ts` builds its half vector at line 38
  as `normalize(eyeVector + lightVector)`, with `lightVector = normalize(-light)`
  (line 37). `eyeVector` runs from the camera to the surface (line 127).
- The article (line 587) calls `uLight` the light position. So both vectors point
  the opposite way from the usual Blinn-Phong vectors (surface to camera, surface
  to light), and the half vector is -H, the reverse of the usual half vector H.
- Squaring N·H (line 43) cancels that sign and also lights back faces. The
  article (line 638) says the author can't find where the formula came from.
- The diffuse term `max(0.0, NdotL)` (line 42) keeps the flip, so it lights the
  side facing away from the light.
- The deployed painting6 bundle (line 489; live URL and use limits in
  [deployed demo evidence](supplemental-sources.md#deployed-demo-evidence)) uses
  the usual vectors, so on front faces the square only doubles the exponent. Its
  back-side pass still lights back faces where N·H is negative.
- For a port: use vectors toward the camera and toward the light, clamp N·H at 0,
  turn back-face normals toward the viewer (`TDFrontFacing()` in a GLSL MAT), and
  treat the square as doubled shininess.
- Label: inferred from code and a numeric check over 200,000 sphere points
  (3 November 2026); not explained by Heckel.

**Saturation inside the sample loop.** The final scene's colour boost compounds.

- `final.ts` line 96 applies `sat(color, uSaturation)` to the running sum on each
  of the 16 passes, before line 100 divides by the loop count.
- So early samples are saturated up to 16 times. Call the slider S. The average
  colour gain (how far colours move away from grey) is the mean of S^k for
  k = 1 to 16: about 1.55x at S = 1.05, 3.6x at the default 1.14, and 10.8x at
  the slider maximum 1.25 (line 187: min 1, max 1.25). Luminance stays the
  same, because the weights in `sat()` sum to 1.
- That explains the narrow slider. Saturation applied once after the loop needs
  about 3.6 to match the default; or keep the loop form and say so.
- Label: computed from the code, 3 November 2026.

**Cloud integration.** `Raymarching/lightTransmittance.ts`, lines 237–253,
accumulates light density without multiplying by a segment length and advances
using `marchSize * step`. Lines 264–273 then feed light-path transmission into
the view transmission accumulation. For a length-aware volume model, sample a
bounded interval at regular midpoints, include density × extinction × segment
length, and keep light visibility separate from camera-path transmittance.
Document this as an adaptation for the new model, not a claim about the
author's private intent or the physical accuracy of the original artistic demo.

**Reversed smoothing edges.** `PostProcessing/dots.ts`, line 18, uses decreasing
`smoothstep` edges. Use increasing edges and invert the result when a falling
mask is intended; keep a nonzero transition width. Khronos defines the result
as undefined when the first edge is greater than or equal to the second.
[Khronos reference source](https://github.com/KhronosGroup/OpenGL-Refpages/blob/main/gl4/smoothstep.xml).

Always reconcile a source discrepancy before adapting it: record both locations,
choose the convention the new implementation needs, then test that convention.
Preserving source faithfully does not require preserving a numerical defect.

## Visual reference status

[media-catalog.json](media-catalog.json) records image references, source lines,
captions and whether verified bytes are included. Bundled diagrams are kept as
served by his site's CDN, with their hashes and recovery paths. Use them to
understand the teaching approach; create original figures tied to the new shader
for the new article. Articles and diagrams are covered by the notice in
[references/NOTICE.md](NOTICE.md); preserve that credit when you reuse them.

The full texture, model, video and dependency archive is not installed with this
plugin. Missing local media is a declared limit, not proof that the archive
lacks the original asset. Newly built studies should package their own assets
or use procedural inputs, and test article embeds separately from the full lab.
