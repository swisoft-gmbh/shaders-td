# A GLSL MAT in the user's scene

Read when: a GLSL MAT must work on the user's own meshes, lights and render,
not only in a demo.

Evidence: rules marked Docs follow Derivative pages checked 3 November 2026.
The others come from the preview-only liquid-glass examples
([status](../../review/references/host-free-checks.md#status-of-the-liquid-glass-evidence)).

## Contents

- [Choose the route](#choose-the-route)
- [Draw into the scene with a Render Pass TOP](#draw-into-the-scene-with-a-render-pass-top)
- [Blend a see-through material](#blend-a-see-through-material)
- [Sample a screen-space TOP from a MAT](#sample-a-screen-space-top-from-a-mat)
- [Call the pipeline hooks yourself](#call-the-pipeline-hooks-yourself)
- [Handle Render Pick](#handle-render-pick)
- [Fill every colour buffer](#fill-every-colour-buffer)
- [Use the scene's lights](#use-the-scenes-lights)
- [Follow the object's world scale](#follow-the-objects-world-scale)

## Choose the route

- **GLSL MAT:** use it when the effect must dress the user's meshes, receive
  scene lights (`uTDLights` reaches only a MAT), sort in depth, instance, or
  answer Render Pick.
- **GLSL TOP:** use it for image effects. A raymarcher in a TOP needs its own
  camera and gets no scene depth without manual wiring.
- **Proxy-geometry MAT:** use it for distance-field content that must sort
  with a scene; see
  [material recipes](material-recipes.md#raymarch-inside-a-proxy-box-that-writes-depth).
- **Over TOP compositing:** use it only for a flat plate, because it loses
  occlusion.

Prefer one drop-in material with opt-in passes and per-pixel analytic
fallbacks over a route that needs extra wiring in every scene. Judged with
universality first, the core's single drop-in material scored highest of the
five studies ([LIQUID-GLASS.md](../../../examples/LIQUID-GLASS.md), "How they
were judged").

## Draw into the scene with a Render Pass TOP

Draw an effect material into the scene render with a Render Pass TOP, because
an Over TOP paints the effect over objects in front of it.

1. Render the scene without the effect objects in a Render TOP.
2. Wire that Render TOP into a Render Pass TOP.
3. Turn off Clear Depth Buffer (`cleardepth`) and Clear to Camera Color
   (`cleartocamcolor`), so the pass keeps the scene's depth and colour.
4. Set Geometry to the effect objects only, and Override Material
   (`overridemat`) to the material.
5. Use the same scene render as the material's background sampler.
6. Keep resolution, pixel format and antialiasing equal across the passes.

Why: in a preview with an opaque ball in front of the glass, the Over TOP
route changed the ball's pixels by up to 246/255; the Render Pass TOP route
changed them by at most 1/255 (Preview, `render_pass_keeps_foreground_in_front`).
Override Material also avoids a loop of parameter references: Geometry COMP,
material, helper pass, Geometry COMP.

Cost: one scene render plus the effect. Heckel's
[/refraction demo](https://r3f.maximeheckel.com/refraction) (read 3 November
2026) renders the whole scene twice per frame, and the deployed painting6
bundle (line 489) three times. Both counts are inferred from code. The
bundle's URL and use limits are under [live sources](../../research/references/NOTICE.md#live-sources-not-included).

Docs: [Render Pass TOP](https://docs.derivative.ca/Render_Pass_TOP) gives the
parameter names and says the TOP builds on its input's depth and colour.
Unverified in TouchDesigner: that the material may sample the input render
while the pass draws onto it. Keep the Over TOP route as the documented
fallback, and say that it loses occlusion. Example:
[Use it on your own objects](../../../examples/liquid-glass/README.md#use-it-on-your-own-objects).

## Blend a see-through material

Output premultiplied colour (rgb already multiplied by alpha), because one
blend setting then covers clear, tinted and opaque parts. On the GLSL MAT's
Common page: Blending on, Source Color = One, Destination Color = One Minus
Source Alpha, Separate Alpha Function off, Post-Mult Color by Alpha off.

- Read the scene TOP's alpha (call it `covered`) and compose with one
  premultiplied formula. At covered 1 it reproduces the refracted look; at
  covered 0 it is a plain alpha blend with whatever is behind. Ignoring it
  turned clear glass over a transparent scene render opaque black: 255/255 on
  56,680 pixels (Preview).
- Limit: a partly covered pixel counts the scene twice, up to 72/255 brighter.
- Writing depth with Opacity below 1 makes self-overlap depend on triangle
  order. Use Order Independent Transparency, which needs a hook (see
  [Call the pipeline hooks yourself](#call-the-pipeline-hooks-yourself)), or
  Draw Priority (see
  [native API notes](../../research/references/native-api.md#more-glsl-mat-and-python-facts)).

Evidence: parameter names as read in the examples' recipes; behaviour from
Preview. Example: the compose
block of `main()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag).

## Sample a screen-space TOP from a MAT

Compute the screen UV from the fragment position and the viewport, because a
MAT gets no UV for the render it draws into:
`uv = (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw`.
Docs: `viewport` holds x, y, 1/width and 1/height in pixels.

Do not assume which way raster rows run against the projection. Measure it per
pixel:

1. Project the pixel's camera-space point with `uTDMats[cam].proj` and compare
   the sign of its NDC (normalised device coordinates, -1 to 1) with the
   pixel's raster position.
2. On the centre row or column of an odd-sized render, where both are 0, use
   the sign of the projected position's screen derivative.
3. Apply the measured sign to every screen offset.
4. Make Flip screen V flip the base UV and the vertical sign together.

The derivative sign alone measured worse: 2 to 5 wrong silhouette pixels per
preset. An antialiasing residual stays open: 8 pixels changed across 144
multisampled renders (12 mesh, raster and size rows of twelve presets), all in
the emulated flipped raster. At most 6 changed in one row (knot, 481 x 271);
the largest change was 43/255 (knot, 480 x 270); none changed in the normal
raster (check `centre_line_residual` in the core's `validation.json`).
Evidence: Preview only, with the flipped raster emulated; TouchDesigner's
actual orientation is unverified. Example: `screenUV()` and `screenSign()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag).

## Call the pipeline hooks yourself

Built-in MATs get fog, dithering, Order Independent Transparency (OIT) and
discards from TouchDesigner. A custom GLSL MAT gets each one only if its code
calls the hook.

- **Fog:** the signature is `TDFog(vec4 color, vec3 worldPos, int cameraIndex)`,
  and it changes nothing while fog is off. Pass the camera index from
  `TDCameraIndex()` in the vertex stage as a flat varying. For premultiplied
  output, fog only the material's own share:
  `TDFog(vec4(c, 1.0), p, cam).rgb - TDFog(vec4(0.0, 0.0, 0.0, 1.0), p, cam).rgb * (1.0 - alpha)`.
  That compose formula comes from Preview.
- **Dither:** `TDDither()` changes the colour only if the shader calls it and
  the Render TOP's Dither is on. So the Render TOP's Dither cannot add noise to
  a material that never calls it.
- **OIT:** call `TDCheckOrderIndTrans()` near the start of `main()`, right
  after the derivatives, as for `TDCheckDiscard()`. Derivative's page says "at
  the start"; whether the call discards pixels is unverified. TouchDesigner
  run pending (status 2026-11-03). None of the five liquid-glass shaders
  calls it ([known gaps](../../../examples/LIQUID-GLASS.md#known-gaps)).
- **Discard:** `TDCheckDiscard()` serves OIT and dual-paraboloid renders. Take
  derivatives first
  ([GLSL pitfalls](td-glsl-pitfalls.md#take-derivatives-before-any-discard-or-branch)).

Evidence: Docs ([Write a GLSL MAT](https://docs.derivative.ca/Write_a_GLSL_MAT))
for each signature. Example:
the end of `main()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag).

## Handle Render Pick

A Render Pick DAT or CHOP renders the scene once more with
`TD_PICKING_ACTIVE` defined. With Derivative's printed form,
`#ifndef TD_PICKING_ACTIVE ... #else TDWritePickingValues(); #endif`, only the
`#else` block runs. So:

- Place the point before the branch: `TDDeform()`, then
  `gl_Position = TDWorldToProj(...)`, which applies the pick adjustment itself.
- Write the pixel-stage outputs inside `#ifndef`.
- If the vertex shader moves points, write the moved positions and normals
  into `vTDPickVert` after `TDWritePickingValues()`.
- Test: compile a `TD_PICKING_ACTIVE` variant, and list the pick render's
  statements with `glslangValidator -E`
  ([host-free checks](../../review/references/host-free-checks.md#compile-every-define-combination-against-stand-ins)).

Evidence: Docs; Compile; no pick has run. Examples:
[liquid_glass.vert](../../../examples/liquid-glass/liquid_glass.vert);
[liquid_flow.vert](../../../examples/liquid-glass-flow/liquid_flow.vert) for
displaced points.

## Fill every colour buffer

Declare the output as an array sized by TouchDesigner, because a render can
have several colour buffers:

```glsl
#ifndef TD_NUM_COLOR_BUFFERS
#define TD_NUM_COLOR_BUFFERS 1
#endif
layout(location = 0) out vec4 fragColor[TD_NUM_COLOR_BUFFERS];
```

- TouchDesigner sets the define from the render's '# of Color Buffers'. The
  docs warn that writing past the provided buffers can corrupt output or crash
  the GPU. A single `out vec4 fragColor` leaves the extra buffers undefined.
- Write colour to `[0]`. Write zeros or real data to 1 to N under
  `#if TD_NUM_COLOR_BUFFERS > k`, with constant indices. A loop failed in
  WebGL2; TouchDesigner is unverified.
- Compile with 1, 3 and 8 buffers.

Evidence: Docs; Compile; Preview: the extra buffers went from non-zero on
93,845 pixels to 0. Example: the buffers block at the end of `main()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag).

## Use the scene's lights

The Render TOP's Lights parameter fills `uTDLights` and `uTDEnvLights`.
`TD_NUM_LIGHTS` and `TD_NUM_ENV_LIGHTS` are compile-time defines, and the
shader recompiles for each light combination.

- Loop `TDLightingPBR()` from 0 to `TD_NUM_LIGHTS`. List the lights on the
  render that draws the material.
- Wrap environment-light code in `#if TD_NUM_ENV_LIGHTS > 0`.
- `TDEnvLightingPBR()` is documented in two shapes: seven arguments returning
  a `TDPBRResult` (the form the Lit example calls and its stand-in declares),
  and nine arguments that start with two `inout vec3` accumulators (the form
  in Derivative's `td-glsl-shaders` skill). Read the render's Info DAT on the
  installed build; if the seven-argument call is rejected, use the other.
- Gate every light term by N·L (how directly the surface faces the light).
  Provide a built-in key light and studio when the counts are 0.
- Set the GLSL MAT's Lighting Space to World Space.
  `uTDGeneral.ambientColor` holds the sum of the Ambient Light COMPs.

Open risks:

- Lights with Dimmer below 0.001 are ignored (Docs:
  [Light COMP](https://docs.derivative.ca/Light_COMP)). Whether they then
  leave `TD_NUM_LIGHTS` is unknown; if they do, an Auto fallback flashes on
  during a blackout.
- Glass listed in a light's Shadow Casters shadows itself as if opaque.

Evidence: Docs for the defines, recompiles, `TDLightingPBR()`, Lighting Space
and Dimmer; Compile (stand-ins) for the preamble signatures; TouchDesigner run
pending (status 2026-11-03). Example:
[liquid-glass-lit](../../../examples/liquid-glass-lit/README.md):
`liquid_glass_lit.frag`, the fact table in `research.md`, and the light-count
matrix in `checks/compile_glsl.py`.

## Follow the object's world scale

Make lengths and patterns follow the object's size in the world, because the
same preset must look the same on a small and a large object. Three things
break otherwise: object-space pattern lookups change with Geometry COMP
scale, normal-perturbation slopes scale with 1/scale, and lengths typed in
scene units do not follow the object.

- Multiply slopes and pattern lookups by
  `worldScale() = cbrt(|det(mat3(uTDMats[cam].world))|)`. The determinant
  says how much the matrix scales a volume; its cube root is one average
  scale.
- Offer a Fit pulse. It reads the render-flagged SOP's bounds (`SOP.bounds()`,
  with `geometryCOMP.bounds(render=True)` as a fallback), multiplies them by
  the COMP's world scale and sets one Object size.
- Limits: one Object size per component. An animated COMP scale, several
  objects of different size and per-instance scale break it (per-instance
  scale needs `TDInstanceMat3()`). A non-uniform scale counts as its
  cube-root average.

Evidence: Preview (Geometry COMP scale 0.1 and 10 match within 2/255).
Unverified: whether `bounds()` returns a Bounds object or a tuple.
Example: `worldScale()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag);
`fit_glass()` in [native.py](../../../examples/liquid-glass/native.py);
[Use it on your own objects](../../../examples/liquid-glass/README.md#use-it-on-your-own-objects),
step 6.
