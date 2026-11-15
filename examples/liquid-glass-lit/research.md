# Liquid Glass Lit: research

## Question

Can the liquid-glass material take all its light from the TouchDesigner scene (Light COMPs, Environment Light COMPs, Ambient Light COMPs), so it needs no light settings and no Reflection TOP, and still render when the scene has no lights?

## Archive sources

All archive sources verified with `skills/research/scripts/corpus.py verify` (393 files, 0 errors). Exact lines, hashes and adaptations are in [sources.json](sources.json).

| Source | Mechanism | Limitation for this brief |
| --- | --- | --- |
| Heckel, *Refraction, dispersion, and other shader light effects*, lines 98–519 | Refraction through a render of the scene, dispersion, saturation | Inherited through the core study; unchanged here |
| Same article, lines 570–656, and its scene module `specular.ts`, lines 27–39 | Diffuse = max(N·L, 0); highlight = pow((N·H)², shininess); one light passed as a fixed uniform | The highlight has no N·L factor. With one light in front that rarely shows; with scene lights behind the object it would light surfaces the light can't reach |
| Same article, lines 657–695 | Fresnel glow | Inherited through the core study |
| Heckel, *Shaping light*, lines 116–177 | The scene's light position and direction are copied into shader uniforms every frame by JavaScript | A web host has no material-level access to scene lights; TouchDesigner has one |
| Heckel, *Painting with math*, lines 296–323 | Plain explanation of the N·L dot product | Teaching pattern only |
| Core Liquid Glass study, commit a6f95c6 | The family's glass: refraction, dispersion, frost, absorption, film, wobble, studio, presets, builder, checks | Lights itself from typed-in values and a Reflection TOP |

Nothing in the archive is a TouchDesigner lighting implementation. The native part is new.

## Native API (checked 2026-11-01)

| Fact | Where | Used for |
| --- | --- | --- |
| `TD_NUM_LIGHTS`, `TD_NUM_ENV_LIGHTS` are set at compile time; the material is recompiled per light setup | Write a GLSL MAT, "TouchDesigner specific defines" | Loops and `#if` guards |
| `TDPBRResult TDLightingPBR(int, vec3 diffuseColor, vec3 specularColor, vec3 worldPos, vec3 normal, float shadowStrength, vec3 shadowColor, vec3 vertToCam, float roughness)` handles light types, attenuation, projection and shadows | Write a GLSL MAT; TD preamble in glslang tests; two independent TD shaders | Scene lights |
| `TDEnvLightingPBR`: the doc page lists `TDPBRResult TDEnvLightingPBR(inout vec3, inout vec3, int, ...)`. TouchDesigner's own preamble defines `TDPBRResult TDEnvLightingPBR(int, vec3, vec3, vec3, vec3, float, float)` and a separate `void` form with the two inout arguments | Write a GLSL MAT vs glslang `Test/vk.relaxed.stagelink.0.1.frag` lines 226–237 | The material uses the 7-argument form; a negative compile test shows the doc's mixed form fails |
| `TDEnvLightTextureLod(int, vec2, float mip)` for 2D maps and `(int, vec3, float mip)` for cube maps; black for the other kind | Write a GLSL MAT, "Common Lighting Functions" | Reflections from any Environment Light |
| `TDCubeMapToEquirectangular(vec3)`: u = 0 at the middle of the +X face, rising toward +Z | GLSL Reference | 2D env-light lookup |
| `uTDEnvLights[i].color`, `.rotate` (mat3) | Write a GLSL MAT | Env colour and the light's map rotation |
| With zero lights, arrays are sized by `TD_LIGHTS_ARRAY_SIZE` = 1 and `TDEnvLightTextureLod` is not declared | glslang test preamble (older build, date not stated) | `#if` guards; compile stand-ins |
| `uTDGeneral.ambientColor` is the sum of Ambient Light COMPs | Write a GLSL MAT | Ambient on the body |
| GLSL MAT **Lighting Space**: World Space or legacy Camera Space | GLSL MAT | Builder sets World Space |
| `TDDither()` adds noise only if called | Write a GLSL MAT | Never called (no dithering) |
| Direction rotated as `rotate * R` | Third-party TD shader (TouchDesigner-ShaderBuilder `glsl_PBR.glsl` lines 171–192); not documented by Derivative | Rotation order |
| That same shader reads its reflection from `sTDPrefiltEnvLight2DMaps`, an undocumented prefiltered map, at `perceptualRoughness * mipCount`, with `mipCount = 1 + floor(log2(size))` taken from the raw map | Same file, lines 189–192 | Not evidence for this material's blur: `TDEnvLightTextureLod` reads the raw map ("Directly access environment maps"). `lod = roughness × Environment blur range` is this study's own choice |
| `Par.eval()` on an operator parameter returns one OP, a list or None; `evalOPs()` returns a list | Par Class | `native.lights()` |
| Render Pass TOP builds on its input render's colour and depth; Clear Depth Buffer and Clear to Camera Color can be turned off | Render Pass TOP | The recipe for putting the glass into a scene |
| Render TOP Render Mode (2D, Cube Map, Fish-Eye, Dual Paraboloid, UV Unwrap) and several cameras per pass | Render TOP | The screen-space refraction needs a 2D render from one camera |
| Light COMPs with Dimmer below 0.001 are ignored in a Render TOP | Light COMP | Experiment `blackout` (does Auto then fall back?) |
| `fragColor[TD_NUM_COLOR_BUFFERS]`, set from the render's colour buffers | Write a GLSL MAT, Multiple Render Targets | One output per buffer, zero in the extra ones |
| `uTDMats[].proj` has a Z range of [0,1]; `TDWorldToProj` should always write `gl_Position` | Write a GLSL MAT | Demo backdrop card |
| Picking: TouchDesigner defines `TD_PICKING_ACTIVE` in a Render Pick pass, and with the printed form `#ifndef TD_PICKING_ACTIVE ... #else TDWritePickingValues(); #endif` only the `#else` block runs; `TDWritePickingValues()` writes the default pick values (rechecked 2026-11-02, twice) | Write a GLSL MAT, Picking | Family sync C2: picking branch in the vertex shader; family close G6: the printed form, with the point placed before the branch |
| Extra colour buffers: `fragColor[TD_NUM_COLOR_BUFFERS]`; "ensure you are not writing beyond the number of buffers" | Write a GLSL MAT, Multiple Render Targets | Family sync C2: zeros at constant indices behind `#if` (a loop does not compile in WebGL2) |
| `vec4 TDFog(vec4 curColor, vec3 worldSpacePos, int cameraIndex)`, called at the end of the shader; nothing happens while fog is off | Write a GLSL MAT | Family sync C7: fog on the premultiplied output |
| Render TOP and Render Pass TOP have a `dither` parameter (label Dither); no default stated | Render TOP, Render Pass TOP (raw pages, 2026-11-02) | Family sync C4: Dither off on both demo renders, lenient |

## Routes compared

| Route | What the user does | What it costs | Fit |
| --- | --- | --- | --- |
| Core style: typed-in light direction and colour, Reflection TOP | Copies light settings by hand, wires a panorama | Lighting drifts from the scene when lights move | Fails "least wiring" |
| Python expressions read Light COMP parameters into uniforms | Picks lights on the component | Re-implements light types, attenuation and shadows; breaks for instancing and many lights | Fragile |
| TouchDesigner's light functions inside the GLSL MAT (chosen) | Nothing: the Lights list of the render that draws the glass applies | One compile per light setup; light levels follow TD's implementation | Chosen |
| PBR MAT with transmission | Uses a built-in material | No screen-space refraction, dispersion, film or presets | Fails the references |

## What the references require from lighting

- Reference 1 (clear, dense rainbow): bright white highlights from the scene's lights over dispersion. Prism Chrome.
- Reference 2 (lavender gel, violet rims): soft body light on a translucent gel; deep tint at the rims. Violet Gel.
- Reference 3 (blue-violet blob): a cool rim light along the edge, which only appears where N·L > 0. Sapphire Drop with the demo rim light.
- Reference 4 (reflective glass over type): strong environment reflections. Chrome Type with the Environment Light.

## Answer

Yes. The material loops `TDLightingPBR()` over the scene's Light COMPs, reads each Environment Light COMP through `TDEnvLightTextureLod()` (reflections) and `TDEnvLightingPBR()` (ambient), and falls back per kind to a built-in key light and studio. Every light term is multiplied by N·L. Rough reflections read a blurrier mipmap level. See [decisions.json](decisions.json) and [the tutorial](article.md). The open native questions are the `TDEnvLightingPBR` form in 2025.x, whether the env map has mipmaps (and how blurry they are), which way the map rotation turns, whether dimmed lights leave the light count, and whether the panorama wraps sideways.

## Integration route (independent review)

The first recipe rendered the glass alone and laid it over the scene with an Over TOP. That draws the glass over anything in front of it. Heckel's article avoids this: it hides the mesh, renders the scene into a render target, shows the mesh again and draws it in the normal, depth-tested render (refraction article, lines 140–154). The TouchDesigner equivalent is a Render Pass TOP built on the scene's Render TOP: it keeps the scene's depth, so the glass is hidden behind what is in front of it. The scene Render TOP is also the Refraction TOP. See [decisions.json](decisions.json) and [review.md](review.md#independent-review).

## Family sync (2026-11-02)

The core study took two more audit rounds after commit a6f95c6 and then merged the members' integration fixes (items C1 to C9). This study took the parts that apply to its route from the core's working tree, function by function, and kept its own lighting. Item by item, with tests and numbers: [review.md](review.md#family-sync); reasons for each choice: [decisions.json](decisions.json).
