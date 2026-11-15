# Original native studies

Start with the [five complete mechanism tests](FIVE-MECHANISMS.md) for distinct
research → build → explain → review examples. The three initial studies remain
useful introductions to native contracts.

| Study | Native route | What it teaches |
|---|---|---|
| [Contour Loom](contour-loom/article.md) | Procedural GLSL TOP | Scalar field → antialiased equal-height lines → independent pigment composition. |
| [Phosphor Memory](phosphor-memory/article.md) | Feedback TOP + state/display GLSL TOPs | Initialization, frame difference, time-unit decay, pause/reset and hatch interpretation. |
| [Contour Material](contour-material/article.md) | GLSL MAT + geometry/camera/Render TOP | Object-space pattern, world-space geometric normals, nonuniform scale and scoped scene rendering. |
| [Orbital Relic](orbital-relic/article.md) | SDF GLSL TOP | Distance composition, explicit hit status, conservative marching and normals. |
| [Lantern Fog](lantern-fog/article.md) | Volume GLSL TOP | Separate view/light paths, segment-length integration and analytic transmission. |
| [Pigment Census](pigment-census/article.md) | Multi-pass image TOPs | Quadrant statistics, edge preservation and controlled filtering comparisons. |
| [Resonant Foil](resonant-foil/article.md) | Displaced GLSL MAT | Actual vertex motion, Jacobian-corrected normals and world-space lighting. |
| [Tidal Ink](tidal-ink/article.md) | Feedback + state/display TOPs | Periodic pigment advection, simulated time, reset/hold and numerical diffusion. |

Each of the eight directories above includes `native/study.tox`, GLSL, a portable source builder,
inspectable recipe, controls, experiment presets, native captures, source credit,
decisions and a tutorial generated from the actual code. The `.tox` embeds its
shader source, helper module, recipe, experiments and tutorial text. Its Markdown
figures/captures also travel in this source package.

The `builder.py` and `native.py` in these eight folders are the versions their
`.tox` files were built with. `scaffold.py` gives a new study the current
versions from `skills/build/scripts/`, leaves the `.tox`, captures and results
behind and adds the licence notice.

Everything here is CC BY-NC 4.0: non-commercial use, with credit to Swisoft
GmbH and to Maxime Heckel ([NOTICE.md](../NOTICE.md)).

Open a `.tox` by dragging it into TouchDesigner. Open its `out` viewer and use
the Study controls. Temporal feedback must cook repeatedly to accumulate state;
the tutorial explains this and the explicit reset/hold behavior.

These are toolkit validation examples, not Heckel-authored TouchDesigner
projects or claims of globally unprecedented effects. They demonstrate different
native contracts; future projects should design their own subject, input,
mechanism and presentation.

## Liquid Glass family (preview-only)

Five more studies show one refraction-glass material for any mesh and four
variants. **Nothing in them has run in TouchDesigner.** Their evidence is
glslang compiles against stand-ins for TouchDesigner's built-ins, WebGL2
previews of the same GLSL and Python unit tests, and they have no
`native/study.tox`. Read the core first, and open a member only for what it
adds; [the family overview](LIQUID-GLASS.md#which-one-to-use) says which to
use. To start from one, copy its folder (`scaffold.py --example` covers only
the eight studies above).

| Study | Native route | What it adds |
|---|---|---|
| [Liquid Glass](liquid-glass/README.md) (core, read first) | GLSL MAT drawn with a Render Pass TOP | Refraction projected through the camera, spectral dispersion, mipmap frost without dithering, presets with an A/B morph, separate Refraction and Reflection TOPs, a tutorial for TouchDesigner users new to GLSL. |
| [Flow](liquid-glass-flow/README.md) | Displacing GLSL MAT | Crack-free vertex motion on any mesh, rebuilt normals, a drift clock tested at a week of uptime. |
| [Prism](liquid-glass-prism/README.md) | GLSL MAT, two surfaces | Per-colour bending at entry and exit, total internal reflection, caustic glow. |
| [Lit](liquid-glass-lit/README.md) | GLSL MAT with scene lights | Light COMPs and an Environment Light COMP inside a custom MAT. |
| [Blobs](liquid-glass-blobs/README.md) | Raymarched GLSL MAT on a proxy box | SDF blobs that write depth and sort with the scene; blob data from a table or CHOP. |
