# Native API notes

Checked against official Derivative pages on 20 October 2026. These are concise
adaptation notes, not bundled copies of the documentation. Some pages retain
legacy menus alongside newer guidance; the running build is authoritative for
available parameters. Record the actual build and inspect parameter menus.

## Contents

- [Where Derivative's own skills say more](#where-derivatives-own-skills-say-more)
- [Pixel TOP contract](#pixel-top-contract)
- [State and material contracts](#state-and-material-contracts)
- [Construction, capture and evidence](#construction-capture-and-evidence)
- [More GLSL MAT and Python facts](#more-glsl-mat-and-python-facts)
- [Working assumptions to verify, not imported defaults](#working-assumptions-to-verify-not-imported-defaults)

## Where Derivative's own skills say more

Derivative publishes agent skills for TouchDesigner
(https://github.com/TouchDesigner/TDMCPSkills). When they are installed,
prefer them for API facts: they follow the current build, and these notes are
dated. Points where its `td-glsl-shaders` skill (read 13 November 2026) adds
to or differs from this file; none was run here:

- It prefers `glslmultiTOP` over `glslTOP`: more than three inputs and more
  than one output. Its resolution is set with `resolutionw`, `resolutionh` and
  `outputresolution`; it has no `resolution` parameter.
- Colour uniforms go on the Colors page, named samplers on the Samplers page,
  fixed arrays on the Arrays page.
- Delta time is `absTime.stepSeconds`; `me.time.step` does not exist.
- A sampler array indexed by a value that is not a constant needs
  `nonuniformEXT(index)`.
- Its reference gives `TDEnvLightingPBR` nine arguments, starting with two
  `inout vec3` accumulators, and a `TDPBRResult` return. The Liquid Glass Lit
  example calls the seven-argument returning form. If the Info DAT rejects
  that call in your build, switch to the nine-argument form
  ([lights](../../build/references/material-integration.md)).

## Pixel TOP contract

For the default full-screen vertex stage, use `vUV.st` and the host-provided
`sTD2DInputs[]`. Do not redeclare those. Declare a fragment output, assign every
path, and pass pixel output through `TDOutputSwizzle`. TouchDesigner supplies the
version directive. Current guidance favors GLSL 4.60; older-host compatibility
requires an explicit check. A custom vertex shader must supply its own UV
varying. Use each texture's size for pixel offsets, rather than assuming all
inputs match the output. Compute output helpers changed in the 2025.30000 series:
current `TDImageStoreOutput` handles output conversion itself; don't apply a
second swizzle. [Write a GLSL TOP](https://docs.derivative.ca/Write_a_GLSL_TOP)

The `pixeldat`, `vertexdat` and `computedat` parameters bind code DATs. Vector
uniform rows use names such as `vec0name` and `vec0valuex`; sequence length must
match the declared bindings. Use Info DATs to inspect compile messages. Current
color uniform rows are converted to the project's working colour space and
data-vector rows are not (see "Colour typed into custom uniforms" below).
Inspect menus instead of silently accepting unsupported values.
[GLSL TOP](https://docs.derivative.ca/GLSL_TOP)

## State and material contracts

A Feedback TOP has a regular seed input and a `top` target reference. During
normal feedback it reads the target's previous output; reset passes the seed.
`resetpulse` resets for one frame. Keep feedback references distinct from
ordinary same-frame wires. [Feedback TOP](https://docs.derivative.ca/Feedback_TOP)

For material shaders, host deformation and projection helpers manage native
transforms. `TDDeform` yields world coordinates; normal and vector variants have
different purposes. Current examples use `TDPos()` and `TDNormal()`. Do not
assume those accessors in every older build. Use `TDWorldToProj` for projection.
A pixel-stage material needs matching varyings, appropriate normal handling and
output swizzle. [Write a GLSL MAT](https://docs.derivative.ca/Write_a_GLSL_MAT)

GLSL MAT sampler bindings are named parameters, not the TOP's automatic input
array. Inspect material sampling and lighting settings for the project.
[GLSL MAT](https://docs.derivative.ca/GLSL_MAT)

Render TOP chooses camera and geometry by parameter references. Keep the
selection scoped to the study's geometry; a wildcard can include unrelated
objects. Record resolution and antialiasing settings alongside the capture.
[Render TOP](https://docs.derivative.ca/Render_TOP)

## Construction, capture and evidence

Components can create children with `create(opType, name)` and save actual `.tox`
files through `save(filepath)`. Resolve returned names, since collisions may
receive numeric suffixes. [COMP class](https://docs.derivative.ca/COMP_Class)

Custom parameter pages support typed controls. Inspect the returned parameter
group and configure individual parameters, menu names/labels, bounds and
defaults. [Page class](https://docs.derivative.ca/Page_Class)

TOP image capture supports `save(filepath)` and pixel readback through
`numpyArray`. Readback can stall; use it for validation, not an unmeasured
per-frame production pathway. A saved image establishes only that captured
state, not control behavior. [TOP class](https://docs.derivative.ca/TOP_Class)

Cooking is demand-driven. A viewer may make an otherwise unused branch cook;
test the delivered output with intermediate viewers disabled too. Inspect
compile information and native errors, not just node existence.
[Troubleshooting](https://docs.derivative.ca/Troubleshooting_in_TouchDesigner)

The Performance Monitor distinguishes frame duration, cook work, draw activity
and graphics-driver time. State which was measured and how; do not call a
single CPU cook duration a GPU benchmark.
[Performance Monitor](https://docs.derivative.ca/Performance_Monitor_Dialog)

## More GLSL MAT and Python facts

Checked against official Derivative pages on 3 November 2026. This toolkit has
not run these in TouchDesigner unless a line says so. Evidence for each
paragraph: Docs, from the page linked at its end. Example pointers go to the
preview-only liquid-glass examples ([status](../../review/references/host-free-checks.md#status-of-the-liquid-glass-evidence));
read the [examples map](../../build/references/glass-refraction.md#start-from-the-liquid-glass-examples)
before using them.

**A render compiles its own version.** TouchDesigner compiles a GLSL MAT again
for each combination of lights and cameras. Versions are cached, so renders with
the same lights and cameras share one. The version a render draws with is
compiled apart from the MAT's own, and only it sees the `TD_RENDER_TOP` define.
So a clean Info DAT on the MAT does not prove the render compiled. Read
`errors()` and `warnings()` on every Render TOP and Render Pass TOP that draws
it, as `render_diagnostics()` in
[the core liquid-glass study](../../../examples/liquid-glass/native.py) does.
Inferred from the docs, not yet run: that
those calls show the render's own compile errors, and that the first frame
after a new light setup stalls while it compiles.
[Write a GLSL MAT](https://docs.derivative.ca/Write_a_GLSL_MAT)

**Par API.** These four facts decide whether a reset or a lookup sees what the
user set:

- `Par.val` reads and writes the constant-mode value only. So a reset that
  writes `.val` leaves parameters driven by an expression, export or bind alone.
  Read the working value with `eval()`.
- `Par.menuIndex` is the constant menu value by index. For a menu driven by an
  expression, use `par.menuNames.index(par.eval())`.
- `eval()` on an operator parameter returns one operator, a list when several
  match, or None. `evalOPs()` always returns a list.
- To fill a Render TOP's Geometry from a custom operator-list parameter, join the
  paths of `par.evalOPs()` with spaces.

Menus driven by expressions are not checked in TouchDesigner.
[Par Class](https://docs.derivative.ca/Par_Class)

**Shared code.** Code DATs for a GLSL MAT can `#include` other DATs by absolute
or relative path. TouchDesigner defines `TD_VERTEX_SHADER` or `TD_PIXEL_SHADER`
for the stage it compiles, so one DAT can hold every stage behind `#ifdef`. Use
this instead of hand-copied stages; see
[study families](../../build/references/study-families.md#share-code-instead-of-hand-copying).
Not checked in TouchDesigner: how relative `#include` paths resolve after a .tox
is exported and reopened under another parent.
[Write a GLSL MAT](https://docs.derivative.ca/Write_a_GLSL_MAT)

**Draw order.** A component with a higher Draw Priority draws first; a lower
value draws later. Draw Priority orders only sibling components, starting from
the components in the Render TOP's Geometry parameter. For sorted transparency,
draw opaque geometry first. Then draw transparent geometry far to near in a
Render Pass TOP, with Alpha Blending on in their MATs. Or set the Render TOP's
Transparency to Order Independent Transparency and call `TDCheckOrderIndTrans()`
near the start of the pixel shader's `main()`, after any derivatives; see
[material integration](../../build/references/material-integration.md#call-the-pipeline-hooks-yourself).
[Transparency](https://docs.derivative.ca/Transparency)

**Colour typed into custom uniforms.** TouchDesigner converts its own colour
parameters to the project's working colour space (the space every colour is
held in; Python reads it as `project.workingColorSpace`). Values a GLSL MAT
receives as Vectors-page data arrive as typed. Inferred from Color Space
Workflows (3 November 2026), which names only colour parameters as converted;
not yet run. When users type colours, offer a
setup menu: Auto, As typed, sRGB. Decode the sRGB curve in the shader only when
the working space is linear. The decode covers the transfer curve, not the
gamut, so colours look slightly more saturated in ACEScg, P3 or Rec.2020
projects. Leave data uniforms such as positions and sizes undecoded: they are
numbers, not colours. Colour uniforms have their own Colors page on both the
GLSL TOP and the GLSL MAT (`color0name`, `color0rgbr`, `color0rgbg`,
`color0rgbb`, `color0alpha`; Derivative's `td-glsl-shaders` skill, read 13
November 2026), and values there are converted like other colour parameters.
The bundled builder binds a uniform with `"kind": "color"` on that page. Not
yet run here. Example: `decode_colours()` in
[presets.py](../../../examples/liquid-glass/presets.py). Not checked in
TouchDesigner: what `project.workingColorSpace` returns in a given build.
[Color Space Workflows](https://docs.derivative.ca/Color_Space_Workflows)

**Panorama helpers.** An equirectangular panorama is a 360-degree image unwrapped
onto a 2:1 rectangle. `TDEquirectangularToCubeMap()` and
`TDCubeMapToEquirectangular()` document its convention: U = 0 is the middle of
the +X face, and as U rises the direction turns from +X to +Z, then -X, then -Z.
An overload of `TDCubeMapToEquirectangular()` also returns a mipmap (pre-shrunk
copies of a texture) bias; pass it to `texture()` to hide the seam. Call these
instead of hand-written atan maths. Not checked in TouchDesigner: how a given
Movie File In panorama appears through them.
[GLSL Reference](https://docs.derivative.ca/GLSL_Reference)

**CHOP data in a shader.** CHOP to TOP outputs 32-bit float by default. Data
Format groups channels by their order in the CHOP (R, RG, RGB or RGBA per
scanline); channel names do not matter. Clamp CHOP Values (`clamp`) limits
values to 0-1, so turn it off for positions and sizes. Read the texture with
`texelFetch()`, so no filtering blends neighbouring records. Example: Table DAT,
then DAT to CHOP, then CHOP to TOP in
[Liquid Glass Blobs](../../../examples/liquid-glass-blobs/README.md).
[CHOP to TOP](https://docs.derivative.ca/CHOP_to_TOP)

Scene lights, fog, dithering, picking and extra colour buffers in a GLSL MAT are
in [material integration](../../build/references/material-integration.md).

## Working assumptions to verify, not imported defaults

Define the input transfer/color space, TOP working/output spaces and alpha
association. Data textures (masks, tensor, position, history) must not receive
display transforms. State whether luma weights apply to linear RGB or an
artistic encoded-image signal. Intermediates may need floating point precision.
Check aspect ratio, edge extension, sampler filtering, invalid math, dimensions,
missing inputs and reset conditions.

In this package's examples, all inputs are procedural, pixel outputs are opaque,
state textures use float RGBA and the color choices are artistic values. Record
the project's color settings before judging captured color. No camera, audio,
file-watch or network input is silently enabled.
