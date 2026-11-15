# Liquid Glass Flow: research

## Question

How can the liquid-glass material make the outline of any mesh move like liquid, with refraction, fresnel and highlights that follow the moved shape, while the core look and its twelve presets keep working?

## Sources retrieved

All archive sources verified with `skills/research/scripts/corpus.py verify` (393 files, no errors). Exact line ranges, hashes and adaptations are in [sources.json](sources.json). Archive commit `9837a4106e226c7c35775e44456a0250f1b894e5`.

| Source | Mechanism | Limitation for this brief |
| --- | --- | --- |
| Heckel, *The Study of Shaders with React Three Fiber*, lines 159–187 and 471–512; widget `ShaderReactThreeFiber/blob.ts`, lines 87–123 | The vertex shader moves vertices. Blob: Perlin noise of the position pushes each vertex along its normal; the displacement travels to the fragment shader as a varying and colours the sphere. | Normals are not rebuilt (the blob's colour does not need them). Displacement along the normal is not safe on meshes with split normals. |
| Heckel, *Caustics in WebGL*, lines 700–816; widget `Caustics/dynamicCaustics.ts`, lines 86–126 | Displaced meshes need recomputed normals. Marco Fugaro's method: tangent from `orthogonal(normal)`, a bitangent, two displaced neighbours, cross product. | One-sided differences; neighbours displaced along the centre's normal (treats the surface as flat); `vNormal = displacedNormal * normalMatrix` puts the vector on the left of the matrix. |
| Heckel, *Field Guide to TSL and WebGPU*, lines 255–434; widget `TSLWebGPU/glassblob.ts`, lines 189–300 | `positionNode` adds a noise of the position to the position: a displacement that depends on position only. The same neighbour method rebuilds normals and flips them when they face away from the original. The glass blob combines this with screen-space refraction and dispersion. | The glass blob jitters its refraction samples with `rand(viewportUV)`, a dither the brief excludes. WebGPU/TSL syntax, not GLSL. |
| `studies/liquid-glass` at commit a6f95c6 (core study); since the family sync, the core working tree after its family-sync merge on 6a58487 | The complete pixel look, twelve presets, preset loader and morph, builder, native helpers, preview and checks. | Its Wobble tilts normals only; the silhouette stays still. |
| `examples/resonant-foil` (plugin example) | Inverse-transpose Jacobian normal correction for one specific displacement map, then `TDDeformNorm`; exact zero-amplitude branch. | The formula belongs to that map; a general noise field needs another way to get the Jacobian. |
| Derivative docs: Write a GLSL MAT (oldid 38399), Box SOP, Sphere SOP, Grid SOP, Switch SOP, read 2026-11-01 | `TDDeform(vec3)` returns vec4; `TDDeformNorm`; `int TDInstanceID()`; `uTDMats[].worldInverse`; the Box SOP is 6 separate faces with 4 points per corner by default. | The page does not say what `TDNormal()` returns for a SOP without normals. The user's installed build is authoritative. |

Nothing in the archive is a native TouchDesigner liquid-glass project. Everything native here is a new adaptation.

## Routes compared

| Route | What the viewer sees | Cost | Fit |
| --- | --- | --- | --- |
| Normal-only wobble (core Wobble) | Shading ripples; the outline stays a perfect sphere or torus | Cheapest | Fails "real liquid silhouettes" |
| Noise SOP or other SOP-side deformation | Real outline change | CPU per frame, extra SOPs for every object | Breaks "least wiring"; normals must be recomputed by another SOP |
| Raymarched SDF blob (GLSL TOP) | Smooth merging blobs, perfect normals | Every shape must be written as a distance function | Not "any mesh" |
| **Vertex displacement in the GLSL MAT** | Real outline change on any mesh, normals rebuilt in the shader | Five field evaluations per vertex | **Chosen** |

## Three questions the mechanism raises

**Which way does a point move?** Along its normal is the classic blob. On a mesh where several vertices share one position but carry different normals (every edge of a default Box SOP; hard-edged models; some UV seams), those vertices move apart and the surface tears. The TSL guide's displacement depends on position only, so it cannot tear. We offer both: "Away from centre" uses `normalize(position - centre)`, a direction that depends on position only (crack-free, the default), and "Normal" for smooth meshes and open sheets. The field itself always reads position, never UV.

**How do we rebuild the normal of an arbitrary field?** Analytic derivatives would have to be rewritten for every new ingredient. The Jacobian formula from resonant-foil is exact but specific to one map. The archived neighbour method works for anything: nudge the point along two tangent directions, move the nudged copies with the same field, and cross the two moved steps. With central differences this measures `J t1` and `J t2`, where J is the Jacobian of the motion, and `cross(J t1, J t2)` is exactly the cofactor-transformed normal. In crack-free mode the nudged copies use their own direction, so the result is the true normal of the moved surface. In Normal mode they reuse the centre's normal, which treats the surface as locally flat; on curved surfaces that costs several degrees (measured in the tests: up to 10 on the demo torus at preset amplitudes).

**What scale is the field in?** A GLSL MAT does not know its geometry's size, but the component's Python does (`SOP.bounds()`). Units are therefore set by two parameters, Flow centre and Flow size, which a Fit to Glass geometry button fills in from the SOP's bounds: the field works in `q = (P - centre) / size`. Amplitude is a fraction of the flow size, so presets transfer between objects. (Since the family close the glass's own lengths use a separate Object size, the object's world radius / 1.45 by the family's rule, which the same button sets.)

**How does time stay usable in a long-running installation?** Two things grow with time. Multiplying seconds by speed makes any speed change jump the pattern, so the component adds speed up per frame instead (in Python's 64-bit floats; since the family sync with the core's `advance()`, shared by the flow time, the ripple and film drift and the demo spin). And a large drift added to a small position loses the GPU float's precision, so the shader folds each drift into one repeat of its noise lattice and keeps only small numbers in the noise argument. The [independent review](review.md#independent-review) found both; the tests now cover a day and a week of flow.

## What the references require

- Reference 3 (blue-violet magnifying blob with droplets) is the clearest call for a moving outline: Swell and Sag/Drip give the blob silhouette and hanging drops; instancing with Instance variation can scatter droplets.
- References 1 and 2 (rainbow glass, lavender gel) show flowing, rounded forms; the refraction now follows those forms because the normals do.
- Reference 4 (glass bending type) benefits from travelling waves that sweep the bend across the type.
- The look itself (dispersion, tint, rims, reflection) is the core's and is unchanged.

## Answer

Yes, as a GLSL MAT whose vertex stage moves the surface with a position-based liquid field and rebuilds normals with central-difference neighbours, and whose pixel stage is the core Liquid Glass shader (rebuilt from the core after its family sync; [review.md](review.md#family-sync) lists what that brought). See [decisions.json](decisions.json) for each consequential choice and [the tutorial](article.md) for how each part works.
