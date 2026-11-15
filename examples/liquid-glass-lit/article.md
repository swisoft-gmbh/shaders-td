# Liquid Glass Lit: glass that takes its light from your scene

![Destination: the default Prism Chrome look on the demo torus, lit by two Light COMPs and an Environment Light. WebGL preview of the delivered GLSL, not a TouchDesigner capture.](captures/preview-final.png)

*The destination: the default look on the demo torus, lit by a warm key light, a blue-violet rim light and an Environment Light. This image is a WebGL preview of the same GLSL files, with stand-in light functions. It is not a TouchDesigner capture.*

The core Liquid Glass study lights itself. You type a light direction into the component, and you connect a Reflection TOP for reflections. This study removes both steps. The glass reads the Light COMPs and the Environment Light COMP that your render already uses. Drop it into a lit scene and the highlights land where your lights are, and the reflections show your environment map. With no lights at all, it falls back to a built-in key light and studio, so it never renders black.

This tutorial is for TouchDesigner users who have not written shaders before. Every code block is copied automatically from the delivered files, so what you read is what runs.

![The same glass in three light setups. WebGL preview, not a TouchDesigner capture.](captures/light-setups.png)

*Preview, left to right:* with no lights, the highlight comes from the built-in key light on the upper left and the reflections are the white studio. With the two demo Light COMPs, a bright highlight appears on the upper right and blue-violet glints on the left. With the Environment Light added, coloured panels from its map appear in the reflections. Nothing in the material changed between the three; only the scene did.

## Open the study

Build the component from the Textport, keeping it in a variable named `component` so the experiment commands below work:

```python
import runpy
component = runpy.run_path('/path/to/liquid-glass-lit/build.py')['build']()
```

Open the component's viewer. Each experiment below fixes time and every unrelated control, then changes one thing. Running one first puts every look control back to its default, so the experiments give the same result in any order. It keeps Preset, your setup (Refraction TOP, Faces, Object size, Flip screen V, Colour parameters) and anything you drive with an expression; `apply(component, 'final')` brings back the default look. **Study > Teaching stage** shows one ingredient at a time; most experiments use it. **Study > Demo Light COMPs** and **Demo Environment Light** switch the demo's lights, so you can watch the material react without touching the network.

The pictures come from a WebGL preview that runs the same shader files in a browser. TouchDesigner's own light functions are not available there, so the preview uses stand-ins written from Derivative's documented signatures. The pictures show what the code does with those stand-ins. They are not proof of how TouchDesigner renders it.

A shader is a small program the graphics card runs. A GLSL MAT holds two. The **vertex shader** runs once per corner of the mesh and decides where it lands on screen. The **pixel shader** runs once per covered pixel and decides its colour. All the lighting happens in the pixel shader.

## Start from the glass you already have

What does the material do before any light touches it?

It does what the core study does. The glass can't see the scene, so you hand it a picture of everything except the glass, from the same camera: the **Refraction TOP**. Each glass pixel looks up that picture at its own screen position, shifted by how much the surface bends light. That shift comes from `refract()`, the **index of refraction** (IOR) and **Thickness**. Dispersion repeats the lookup once per slice of the spectrum, each with a slightly different IOR, so edges split into rainbow fringes. **Frost** moves each lookup to a point of a small disc and reads a blurrier mipmap level, so the view blurs smoothly. The disc points come from the "R2" sequence, which spreads any number of points evenly and keeps their average near the centre, so frost blurs the view without shifting it. The core study's tutorial explains all of this step by step.

The function also returns the Refraction TOP's own alpha, `covered`: 1 where the scene render has something, 0 where its background is transparent. You will see below what the glass does with it.

The vertex shader places each point on screen (its `main()` comes back in "Use it in your own lit scene") and passes the surface position and normal in world space to the pixel shader. `passToPixelStage()` writes them. World space matters here: TouchDesigner's light functions work in world space, and the builder sets the GLSL MAT's **Lighting Space** to World Space to match.

From [liquid_glass_lit.vert](liquid_glass_lit.vert), lines 14–24:

```glsl
// Everything the pixel stage reads, written once per point.
void passToPixelStage(vec3 objPos, vec4 world)
{
    vObjPos = objPos;
    vWorldPos = world.xyz;
    // Decide before transforming: a missing normal stays exactly zero (the pixel
    // stage then builds faceted normals) instead of risking a NaN.
    vec3 objNormal = TDNormal();
    vWorldNormal = dot(objNormal, objNormal) > 1e-12 ? TDDeformNorm(objNormal) : vec3(0.0);
    vCamIndex = TDCameraIndex();
}
```

From [liquid_glass_lit.frag](liquid_glass_lit.frag), lines 240–324:

```glsl
// Refract the view ray and measure how far it moves sideways on screen
// after crossing `thickness` scene units of glass.
vec2 bendOffset(vec3 eye, vec3 n, float ior, float thickness, mat3 view, vec2 toUV)
{
    vec3 refracted = refract(eye, n, 1.0 / ior);
    if (dot(refracted, refracted) < 0.5) refracted = eye;  // total internal reflection guard
    vec3 sideways = view * (refracted - eye);
    return sideways.xy * thickness * toUV;
}

// Weight of one spectrum sample in R, G and B: w = 0 is red, w = 1 is violet.
vec3 spectrum(float w)
{
    vec3 c = clamp(1.0 - abs(w - vec3(0.1, 0.45, 0.8)) * vec3(2.4, 2.8, 2.4), 0.0, 1.0);
    c.r += 0.6 * clamp(1.0 - abs(w - 1.0) * 5.0, 0.0, 1.0);
    return c * c * (3.0 - 2.0 * c) + 0.02;
}

// Point i of N on a unit disc, spread evenly for any N: angle and area come
// from two different irrational steps (the "R2" sequence, built on the plastic
// number), so the points never line up on one spiral arm and their average
// stays near the centre.
vec2 discPoint(int i)
{
    vec2 f = fract(0.5 + float(i) * vec2(0.7548776662, 0.5698402910));
    float angle = 2.0 * LG_PI * f.x;
    return vec2(cos(angle), sin(angle)) * sqrt(f.y);
}

// One refraction per spectrum sample (dispersion), each also moved to a point
// of a disc (discPoint) for frost. Each frost sample reads a mipmap level as
// wide as the gap between samples, so the blur stays continuous.
// The result keeps the scene's alpha: rgb stays premultiplied, and a says how
// much of the view through the glass the Refraction TOP actually covers.
vec4 transmitted(vec3 eye, vec3 n, vec2 uv, float thickness, mat3 view, vec2 toUV)
{
    int count = clamp(int(uState.y + 0.5), 1, 32);
    float spread = uOptics.z * 0.3;
    float colourSplit = clamp(uOptics.z * 4.0, 0.0, 1.0);
    vec2 blurPixels = uBody.y * 0.25 * abs(toUV) * vec2(textureSize(sRefraction, 0));
    float lod = log2(max(2.0 * max(blurPixels.x, blurPixels.y) / sqrt(float(count)), 1.0));
    vec3 sum = vec3(0.0);
    vec3 weightSum = vec3(0.0);
    float covered = 0.0;
    for (int i = 0; i < 32; i++) {
        if (i >= count) break;
        float w = (float(i) + 0.5) / float(count);
        // Never below 1: below it the bend flips and snaps to zero past the critical angle.
        float ior = max(uOptics.x + spread * (w - 0.5), 1.0);
        vec2 offset = bendOffset(eye, n, ior, thickness, view, toUV);
        offset += discPoint(i) * uBody.y * 0.25 * toUV;
        vec3 weight = mix(vec3(1.0), spectrum(w), colourSplit);
        vec4 seen = textureLod(sRefraction, mirrorUV(uv + offset), lod);
        sum += seen.rgb * weight;
        weightSum += weight;
        covered += seen.a;
    }
    return vec4(sum / weightSum, covered / float(count));
}

vec3 saturateColour(vec3 c, float amount)
{
    float luma = dot(c, vec3(0.2125, 0.7154, 0.0721));
    return max(mix(vec3(luma), c, amount), 0.0);
}

// Colour parameters reach the shader as typed. In a project with a linear
// working colour space, uOptions.y asks for the sRGB-to-linear conversion that
// TouchDesigner applies to its own colour parameters.
vec3 paramColour(vec3 c)
{
    if (uOptions.y < 0.5) return c;
    vec3 low = c / 12.92;
    vec3 high = pow((max(c, 0.0) + 0.055) / 1.055, vec3(2.4));
    return mix(low, high, step(vec3(0.04045), c));
}

// Beer-Lambert: a longer path through tinted glass gives a deeper tint.
// The colour is clamped to 0..1 here: a glass colour above 1 can brighten the
// body, but it never amplifies the light passing through.
vec3 absorption(float path)
{
    vec3 passes = clamp(paramColour(uGlass.rgb), 0.0, 1.0);
    return exp(-(1.0 - passes) * uGlass.a * path);
}
```

**Experiment `see_through`:** Does light ever leak into the view through the glass?

On the built component, run `component.op('study_tools').module.apply(component, 'see_through')`.

Prediction: No. At IOR 1 with Specular, Surface diffuse, Reflection, Rim and Iridescence at 0, the torus disappears even though both demo lights and the Environment Light are on.

Parameters: Preset=clear_crystal, Pause=True, Time=2.0, Stage=final, Demolights=both, Demoenv=True, Ior=1.0, Dispersion=0.0, Frost=0.0, Density=0.0, Edgetint=0.0, Saturation=1.0, Translucency=1.0, Specular=0.0, Diffuse=0.0, Reflection=0.0, Rim=0.0, Iridescence=0.0, Wobble=0.0. Time and unrelated controls are fixed by this preset.

![Experiment see_through: the torus is invisible although both demo lights and the Environment Light are on. WebGL preview, not a TouchDesigner capture.](captures/preview-see_through.png)

*Preview:* the torus disappears, with both demo lights and the Environment Light on. An automated test compares this render with the backdrop alone. The largest difference is 1/255, with and without scene lights (`ior1_invisible_with_light_terms_off` in [the preview tests](checks/preview_tests.cjs)). Light never leaks into the view through the glass; it is only added on top, as you will see.

**Experiment `dispersion`:** Where do the rainbow fringes come from?

On the built component, run `component.op('study_tools').module.apply(component, 'dispersion')`.

Prediction: Every high-contrast edge seen through the glass splits into a red-to-violet fringe, widest near the silhouette. Lights do not change this stage.

Parameters: Preset=prism_chrome, Pause=True, Time=2.0, Stage=refraction, Dispersion=1.0. Time and unrelated controls are fixed by this preset.

![Experiment dispersion: rainbow fringes along high-contrast edges. WebGL preview, not a TouchDesigner capture.](captures/preview-dispersion.png)

*Preview (Refraction only stage):* every black and white edge seen through the glass carries a red-to-violet fringe, widest near the silhouette.

![Actual node names and dependencies, shown schematically](figures/network.svg)

The diagram is a schematic of the recipe, not a captured network. Orange arrows are the new part: the render that draws the glass (here the Render Pass TOP `render`) hands its lights to every material it draws. No wire runs from a light to the material.

## Ask the Render TOP for its lights

How does a material know which lights the scene has?

It doesn't look for them. The **Lights** parameter of the Render TOP or Render Pass TOP that draws it lists the Light COMPs and Environment Light COMPs it renders with. TouchDesigner passes their data to the shader in built-in arrays (`uTDLights`, `uTDEnvLights`) and compiles one version of the shader for each light setup it meets. In each version, `TD_NUM_LIGHTS` and `TD_NUM_ENV_LIGHTS` are fixed numbers. With three Light COMPs, `TD_NUM_LIGHTS` is 3 and the loop below runs three times. With none, it is 0 and the loop never runs.

The web scenes in Heckel's article do this by hand: the JavaScript copies a light's position into a uniform every frame (see *Shaping light*, lines 116–177). TouchDesigner does it for you, which is why this material needs no wiring.

First the material decides which sources to use. **Lighting > Lights** and **Environment** each have three modes. *Auto* uses the scene's lights and falls back to the built-in ones only when the scene has none of that kind. *Scene only* never falls back. *Built-in only* ignores the scene.

From [liquid_glass_lit.frag](liquid_glass_lit.frag), lines 328–344:

```glsl
// Which light sources this pixel uses. TouchDesigner compiles one version of
// the shader per light setup, so TD_NUM_LIGHTS and TD_NUM_ENV_LIGHTS are fixed
// numbers here. Mode 0 (Auto) uses the scene's lights and falls back to the
// built-in ones only when the scene has none; 1 uses the scene only; 2 uses
// the built-in ones only.
bool useSceneLights() { return TD_NUM_LIGHTS > 0 && int(uSources.x + 0.5) != 2; }
bool useKeyLight()
{
    int mode = int(uSources.x + 0.5);
    return mode == 2 || (mode == 0 && TD_NUM_LIGHTS == 0);
}
bool useSceneEnv() { return TD_NUM_ENV_LIGHTS > 0 && int(uSources.y + 0.5) != 2; }
bool useStudio()
{
    int mode = int(uSources.y + 0.5);
    return mode == 2 || (mode == 0 && TD_NUM_ENV_LIGHTS == 0);
}
```

Then it adds up what each light delivers. `TDLightingPBR()` is TouchDesigner's own light function. It knows each light's type (point, cone or distant), its colour and dimmer, its distance attenuation, and its shadow map if the light casts shadows. **Shadow strength** scales those shadows. The material asks it for two parts: **diffuse**, light the surface scatters, and **specular**, the light's own reflection, the highlight.

The `#if TD_NUM_LIGHTS > 0` line is a preprocessor guard. TouchDesigner removes the code between `#if` and `#endif` when the condition is false, before compiling. That keeps a shader with zero lights from mentioning a light that doesn't exist.

From [liquid_glass_lit.frag](liquid_glass_lit.frag), lines 385–407:

```glsl
// Every Light COMP listed in the Render TOP. TDLightingPBR() handles point,
// cone and distant lights, attenuation, projection maps and shadows; the
// loop runs zero, one or several times depending on the scene.
Lit gatherLights(vec3 pos, vec3 n, vec3 toCam, float roughness)
{
    Lit sum = Lit(vec3(0.0), vec3(0.0));
#if TD_NUM_LIGHTS > 0
    if (useSceneLights()) {
        for (int i = 0; i < TD_NUM_LIGHTS; i++) {
            TDPBRResult r = TDLightingPBR(i, vec3(1.0), vec3(1.0), pos, n,
                                          uShade.w, vec3(0.0), toCam, roughness);
            sum.diffuse += r.diffuse;
            sum.specular += r.specular;
        }
    }
#endif
    if (useKeyLight()) {
        Lit key = keyLight(n, toCam, roughness);
        sum.diffuse += key.diffuse;
        sum.specular += key.specular;
    }
    return sum;
}
```

**Experiment `scene_lights`:** What do the scene's Light COMPs deliver to the glass?

On the built component, run `component.op('study_tools').module.apply(component, 'scene_lights')`.

Prediction: The Lights stage (everything the lights add) shows soft warm shading from the key light (upper right) over most of the front, with small hot highlights, and blue-violet light from the rim light on the left edge and on the inner wall of the hole. Surfaces facing neither light stay black.

Parameters: Preset=clear_crystal, Pause=True, Time=2.0, Stage=lights, Demolights=both, Demoenv=True, Diffuse=0.6. Time and unrelated controls are fixed by this preset.

![Experiment scene_lights: warm shading and highlights from the key, blue-violet light from the rim. WebGL preview, not a TouchDesigner capture.](captures/preview-scene_lights.png)

*Preview (Lights stage, which shows everything the lights add):* warm grey shading from the key light covers most of the front, with small hot highlights top and bottom. Blue-violet light from the rim light sits on the left edge and on the inner wall of the hole.

**Experiment `fallback`:** What happens when the scene has no lights at all?

On the built component, run `component.op('study_tools').module.apply(component, 'fallback')`.

Prediction: With Demo Light COMPs = None and no Environment Light, the glass still has a highlight, now from the built-in key light on the upper left instead of the demo key on the upper right, and white studio reflections, but none of the coloured panels. Switch Teaching stage to Light sources: the glass turns blue, meaning only the built-in fallback is in use.

Parameters: Preset=prism_chrome, Pause=True, Time=2.0, Stage=final, Demolights=none, Demoenv=False. Time and unrelated controls are fixed by this preset.

![Experiment fallback: with no lights, the built-in key light and studio take over. WebGL preview, not a TouchDesigner capture.](captures/preview-fallback.png)

*Preview:* the glass still has highlights and reflections, now from the built-in key light and the white studio. An automated test renders three presets this way and compares them with *Built-in only* in a scene that has one or three lights and an Environment Light. The difference is 0 in every case (`no_lights_equals_builtin_fallback`). The **Light sources** stage confirms which sources are active: red for scene lights, green for a scene Environment Light, blue for a built-in fallback.

One case needs a native check. Derivative's Light COMP page says lights with a Dimmer below 0.001 are ignored in a Render TOP. If that also removes them from `TD_NUM_LIGHTS`, *Auto* treats a blacked-out scene as a scene with no lights and turns the built-in key light on. **Study > Demo Light COMP dimmer** lets you test it.

**Experiment `blackout`:** What does Auto do when every scene light is dimmed to 0?

On the built component, run `component.op('study_tools').module.apply(component, 'blackout')`.

Prediction: A native check. Derivative's Light COMP page says lights with Dimmer below 0.001 are ignored. If TouchDesigner then compiles the material for zero lights, Auto switches to the built-in key light, and the Light sources stage turns from yellow (scene lights and scene environment) to cyan (scene environment and built-in key). If it stays yellow, dimmed lights still count. Also try Demo Light COMP dimmer 0.0005 and 0.01. In a show that fades every light to black, set Lighting > Lights to Scene only so the glass goes dark with the scene.

Parameters: Preset=prism_chrome, Pause=True, Time=2.0, Stage=sources, Demolights=both, Demoenv=True, Demodimmer=0.0. Time and unrelated controls are fixed by this preset.

![Experiment blackout: the Light sources stage with both demo lights dimmed to 0. WebGL preview, not a TouchDesigner capture.](captures/preview-blackout.png)

*Preview (Light sources stage):* the torus is yellow, so scene lights and the scene environment are in use. The preview keeps dimmed lights in the light count. That is the preview's assumption; only TouchDesigner can show what it does.

## Light only where the surface faces it

Why does a light behind the object only touch its edges?

A surface receives light in proportion to how directly it faces the light. The **dot product** N·L of the surface normal N and the direction to the light L measures that: 1 when the surface faces the light, 0 when it is edge-on, negative when it faces away. Clamped at 0, it is the diffuse term in Heckel's article and in most real-time light models.

Heckel's specular, `pow(NdotH * NdotH, shininess)`, has no N·L in it (`specular.ts`, lines 27–39). With his one fixed light that rarely shows. With a light behind the object, it would put a highlight on surfaces the light can't reach. Here no light adds anything where N·L is below 0. The built-in key light below multiplies each of its terms by N·L explicitly. For scene lights the material adds only what `TDLightingPBR()` returns, and TouchDesigner's PBR lighting is expected to include N·L; checking that in TouchDesigner is still to do.

The highlight's shape is **GGX**, the model most real-time PBR renderers use; TouchDesigner's own shader preamble contains a GGX function for its PBR lights. **Highlight size** is its roughness: small values give a tight, bright spot, large values a wide, soft sheen. It is the same idea as Heckel's shininess, turned around so that bigger means bigger.

From [liquid_glass_lit.frag](liquid_glass_lit.frag), lines 348–381:

```glsl
// What lights deliver at one surface point: diffuse (light the surface
// scatters) and specular (the light's own reflection, the highlight).
struct Lit
{
    vec3 diffuse;
    vec3 specular;
};

// GGX highlight shape: small and sharp at low roughness, wide and soft at high.
// N.H is clamped to 1 and the denominator kept above zero: in 32-bit floats N.H
// can round to 1.0000002, which at the smallest Highlight size made d <= 0.
float ggx(float NdotH, float roughness)
{
    float a2 = roughness * roughness * roughness * roughness;
    NdotH = min(NdotH, 1.0);
    float d = max(NdotH * NdotH * (a2 - 1.0) + 1.0, 1e-8);
    return a2 / (LG_PI * d * d);
}

// The built-in key light: a distant light used when the scene has none.
// Everything it adds is multiplied by N.L, so it only lights the side facing it.
Lit keyLight(vec3 n, vec3 toCam, float roughness)
{
    vec3 l = uKey.xyz / max(length(uKey.xyz), 1e-6);  // direction 0,0,0 gives no key light
    float NdotL = max(dot(n, l), 0.0);
    float NdotV = max(dot(n, toCam), 1e-4);
    float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    float visibility = 0.25 / ((NdotL * (1.0 - k) + k) * (NdotV * (1.0 - k) + k));
    vec3 halfway = l + toCam;
    vec3 h = halfway / max(length(halfway), 1e-6);  // zero when the key faces the camera head-on
    float spec = ggx(max(dot(n, h), 0.0), roughness) * visibility;
    vec3 light = paramColour(uKeyColor.rgb) * uKey.w * NdotL;
    return Lit(light, light * spec);
}
```

**Experiment `rim_only`:** Why does a light behind the object only touch its edges?

On the built component, run `component.op('study_tools').module.apply(component, 'rim_only')`.

Prediction: With only the rim light (to the left, slightly behind), the Lights stage is black on the surfaces facing the camera. Only surfaces that turn toward the left catch light: a thin band on the left outer edge and the inner wall on the right side of the hole. Everything a light adds is multiplied by N.L.

Parameters: Preset=clear_crystal, Pause=True, Time=2.0, Stage=lights, Demolights=rim, Demoenv=True, Diffuse=0.6. Time and unrelated controls are fixed by this preset.

![Experiment rim_only: only surfaces turned toward the left catch the rim light. WebGL preview, not a TouchDesigner capture.](captures/preview-rim_only.png)

*Preview (Lights stage):* the front of the torus is black. Only a thin band on the left outer edge and the inner wall on the right side of the hole catch the rim light.

Two automated tests check the rule pixel by pixel. The first tests the material's own maths. With no Light COMPs, *Auto* uses the built-in key light. Raising **Key light intensity** from 0 to 1 changes none of the 19,963 pixels whose normal faces away from the key, darkens no pixel, and brightens 46,181 of the 46,356 pixels facing it (`builtin_key_adds_energy_only_where_NdotL_positive`). The second adds a distant Light COMP: none of the 15,365 away-facing pixels changes (`light_adds_energy_only_where_NdotL_positive`). There the N·L comes from the preview's stand-in for `TDLightingPBR()`, so that test only shows the material adds nothing of its own on the far side.

**Experiment `highlight_size`:** What does Highlight size change?

On the built component, run `component.op('study_tools').module.apply(component, 'highlight_size')`.

Prediction: Compared with scene_lights, raising Highlight size from 0.12 to 0.45 spreads each highlight into a wide, dimmer sheen; the diffuse shading does not change.

Parameters: Preset=clear_crystal, Pause=True, Time=2.0, Stage=lights, Demolights=both, Demoenv=True, Diffuse=0.6, Highlightsize=0.45. Time and unrelated controls are fixed by this preset.

![Experiment highlight_size: wider, softer highlights. WebGL preview, not a TouchDesigner capture.](captures/preview-highlight_size.png)

*Preview (Lights stage):* compared with `scene_lights`, the highlights spread into broad sheens while the diffuse shading stays the same.

## Reflect the Environment Light

Where do reflections come from, without a Reflection TOP?

An **Environment Light COMP** holds an environment map: a picture of everything around the scene, usually a 360 panorama. `reflect()` mirrors the viewing direction around the normal. The direction it returns says which part of the environment this pixel reflects.

Two details make this work with any Environment Light. First, the light's own **Environment Map Rotate** reaches the shader as a matrix, `uTDEnvLights[i].rotate`. Multiplying the direction by it turns the reflection when you turn the map. Second, a map can be a 2D panorama or a cube map. `TDEnvLightTextureLod()` has one version for each, and the version for the other kind returns black. The material calls both and adds them, so whichever kind the light uses comes through. `TDCubeMapToEquirectangular()` turns a direction into a panorama coordinate in TouchDesigner's own layout. The result is multiplied by the light's colour, `uTDEnvLights[i].color`.

From [liquid_glass_lit.frag](liquid_glass_lit.frag), lines 448–460:

```glsl
#if TD_NUM_ENV_LIGHTS > 0
// One Environment Light COMP seen in direction d, at a mipmap level.
// The light's Environment Map Rotate turns the direction first. Its map is
// either a 2D equirectangular image or a cube map; the lookup for the other
// kind returns black, so adding both covers whichever the light uses.
vec3 envLight(int i, vec3 d, float lod)
{
    vec3 m = safeNormalize(uTDEnvLights[i].rotate * d, d);  // a zero matrix (no rotation set) keeps d
    vec3 c = TDEnvLightTextureLod(i, m, lod).rgb
           + TDEnvLightTextureLod(i, TDCubeMapToEquirectangular(m), lod).rgb;
    return c * uTDEnvLights[i].color;
}
#endif
```

When the scene has no Environment Light, the built-in studio from the core study takes over: a dark room with soft white light strips. **Built-in > Studio rotation** turns it.

From [liquid_glass_lit.frag](liquid_glass_lit.frag), lines 411–444:

```glsl
// Built-in studio: a dark room with soft white light strips (from the core
// study). envmap.frag bakes a coloured variant of it for the demo.
float band(float x, float centre, float halfWidth, float soft)
{
    return 1.0 - smoothstep(halfWidth - soft, halfWidth + soft, abs(x - centre));
}

float angleDelta(float a, float b)
{
    return mod(a - b + LG_PI, 2.0 * LG_PI) - LG_PI;
}

// Angle around the vertical axis. atan(0, 0) is undefined, so straight up and
// straight down get 0.
float azimuth(vec3 d)
{
    return dot(d.xz, d.xz) > 1e-12 ? atan(d.z, d.x) : 0.0;
}

vec3 studio(vec3 d, float soft)
{
    float c0 = cos(uKeyColor.w);
    float s0 = sin(uKeyColor.w);
    d = vec3(c0 * d.x + s0 * d.z, d.y, -s0 * d.x + c0 * d.z);  // Studio rotation, around +Y
    float az = azimuth(d);
    float el = d.y;
    vec3 c = vec3(0.015) + vec3(0.05) * smoothstep(-0.1, 0.7, el);
    c += vec3(2.2) * band(angleDelta(az, 0.6), 0.0, 0.10, 0.03 + soft) * band(el, 0.15, 0.55, 0.15 + soft);
    c += vec3(1.6, 1.7, 1.9) * band(angleDelta(az, 2.6), 0.0, 0.06, 0.02 + soft) * band(el, 0.0, 0.65, 0.15 + soft);
    c += vec3(1.5, 1.25, 1.0) * band(angleDelta(az, -1.8), 0.0, 0.22, 0.06 + soft) * band(el, 0.3, 0.3, 0.1 + soft);
    c += vec3(1.8) * band(el, 0.93, 0.02, 0.015 + soft);
    c += vec3(0.06) * (1.0 - smoothstep(-0.7, 0.0, el));
    return c;
}
```

**Experiment `env_reflection`:** Where do the reflections come from now?

On the built component, run `component.op('study_tools').module.apply(component, 'env_reflection')`.

Prediction: The Reflection stage shows the demo environment map's coloured panels (blue-violet, magenta, warm window) wrapped around the torus, brightest at its edges. Turn Demo Environment Light off and only the white built-in studio strips remain.

Parameters: Preset=chrome_type, Pause=True, Time=2.0, Stage=reflection, Demolights=none, Demoenv=True. Time and unrelated controls are fixed by this preset.

![Experiment env_reflection: the environment map's coloured panels wrap around the torus. WebGL preview, not a TouchDesigner capture.](captures/preview-env_reflection.png)

*Preview (Reflection only stage):* the blue-violet, magenta and warm panels of the demo map curve around the torus, brightest at its edges, where the fresnel term is strongest.

**Experiment `env_rotate`:** Does the Environment Light's rotation reach the material?

On the built component, run `component.op('study_tools').module.apply(component, 'env_rotate')`.

Prediction: Turning the demo environment by 90 degrees turns the reflected panels around the vertical axis. A native check: a PBR MAT sphere lit by the same Environment Light should turn the same way.

Parameters: Preset=chrome_type, Pause=True, Time=2.0, Stage=environment, Demolights=none, Demoenv=True, Demoenvrotate=90.0. Time and unrelated controls are fixed by this preset.

![Experiment env_rotate: the reflected panels turn with the map. WebGL preview, not a TouchDesigner capture.](captures/preview-env_rotate.png)

*Preview (Environment stage):* the panels have moved around the torus. An automated test confirms that a full 360-degree turn gives exactly the original image and 90 degrees changes it (`env_rotation_reaches_reflection`). Which way TouchDesigner turns the map for a positive angle is a native check: compare with a PBR MAT sphere lit by the same Environment Light.

## Rough reflections are blurrier mipmaps

How does a rough surface blur its reflection without grain?

A rough surface scatters each reflection over a cone of directions instead of one. Averaging many random directions would blur it, but with few samples it looks grainy, and this family of studies avoids grain. A **mipmap** is a chain of pre-shrunk copies of a texture, each half the size of the last, so each level is a blurrier version of the map. Reading a higher level costs one lookup and gives a smooth blur.

The material picks the level as roughness times **Lighting > Environment blur range**. This mapping is this study's own choice. About 10 suits a 1024-wide map: level 10 is the last one, a single pixel wide. A third-party TouchDesigner shader uses a similar rule, but it reads a prefiltered copy of the map that Derivative does not document. `TDEnvLightTextureLod()` reads the map itself, so how blurry its levels are in TouchDesigner is a native check. The material also averages eight nearby directions on a small disc, so the blur stays smooth where a map has coarse or missing mipmap levels.

From [liquid_glass_lit.frag](liquid_glass_lit.frag), lines 464–489:

```glsl
// What the surface reflects in direction R. Roughness picks a blurrier
// mipmap level (roughness x mip levels, as in TouchDesigner's PBR) and
// averages a small ring of nearby directions, so the blur stays smooth
// where a map has coarse or missing mipmap levels.
vec3 environment(vec3 R, float roughness)
{
    int taps = roughness > 0.001 ? 8 : 1;
    float lod = roughness * uSources.w;
    float radius = roughness * roughness * 0.5;
    vec3 t = normalize(cross(abs(R.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), R));
    vec3 b = cross(R, t);
    vec3 sum = vec3(0.0);
    for (int k = 0; k < 8; k++) {
        if (k >= taps) break;
        float a = float(k) * 2.39996;
        float r = taps > 1 ? sqrt((float(k) + 0.5) / 8.0) * radius : 0.0;
        vec3 d = normalize(R + (t * cos(a) + b * sin(a)) * r);
#if TD_NUM_ENV_LIGHTS > 0
        if (useSceneEnv()) {
            for (int i = 0; i < TD_NUM_ENV_LIGHTS; i++) sum += envLight(i, d, lod) * uSources.z;
        }
#endif
        if (useStudio()) sum += studio(d, 0.3 * roughness);
    }
    return sum / float(taps);
}
```

**Experiment `env_roughness`:** How does a rough surface reflect?

On the built component, run `component.op('study_tools').module.apply(component, 'env_roughness')`.

Prediction: At Reflection roughness 0.6 the Environment stage shows the same panels as soft glows, without steps or ghost copies: roughness picks a blurrier mipmap level and averages eight nearby directions.

Parameters: Preset=chrome_type, Pause=True, Time=2.0, Stage=environment, Demolights=none, Demoenv=True, Roughness=0.6. Time and unrelated controls are fixed by this preset.

![Experiment env_roughness: soft glows instead of sharp panels. WebGL preview, not a TouchDesigner capture.](captures/preview-env_roughness.png)

*Preview (Environment stage):* the same panels as soft glows, with no steps and no ghost copies. An automated test measures the colour gradient of the reflection on a sphere at six roughness values and divides it by the mean brightness, so a reflection that only got darker would not pass. It falls at every step, for the Environment Light (0.44 at roughness 0 down to 0.002 at 0.9) and for the built-in studio (0.53 down to 0.15), and the brightness never drops below 60% of the sharp reflection's (`env_roughness_blurs_monotonically`). The rough studio gets brighter, because its softened light strips spread wider. The preview's mipmaps are plain averages of 2×2 pixels; TouchDesigner's may differ.

A panorama has a seam where its left and right edges meet, in the +X direction. The preview wraps the panorama across it. Whether TouchDesigner does so for its blurry levels is another native check.

**Experiment `env_seam`:** Does a rough reflection show a seam where the panorama's edges meet?

On the built component, run `component.op('study_tools').module.apply(component, 'env_seam')`.

Prediction: A native check. The panorama's left and right edges meet in the +X direction. Turned by 90 degrees, that direction should face the camera on the front of the ring (if TouchDesigner turns the other way, use -90). If TouchDesigner does not wrap the panorama sideways when it reads its blurry mipmap levels, a thin vertical line shows there. The WebGL preview wraps the panorama, so it cannot show this.

Parameters: Preset=chrome_type, Pause=True, Time=2.0, Stage=environment, Demolights=none, Demoenv=True, Roughness=0.7, Demoenvrotate=90.0. Time and unrelated controls are fixed by this preset.

![Experiment env_seam: rough reflection with the panorama's seam turned toward the camera. WebGL preview, not a TouchDesigner capture.](captures/preview-env_seam.png)

*Preview (Environment stage):* soft glows and no line, as expected from a preview that wraps the panorama. The TouchDesigner result is pending.

## Light the body, not only the surface

How does milky glass take the scene's light?

Clear glass shows mostly what is behind it. Milky glass, a gel or a jelly, also scatters light inside its body. **Translucency** mixes the two: at 1 you see the bent, tinted view through the glass, at 0 the glass's own body colour. The body is lit by two kinds of light. **Direct** light comes from the Light COMPs and only reaches the side facing them. **Ambient** light comes from all around and keeps the shadow side from going black.

Ambient light has three possible sources. Ambient Light COMPs arrive summed in `uTDGeneral.ambientColor`. Each Environment Light COMP gives a smooth average of its map through `TDEnvLightingPBR()`; the material uses only its diffuse part. Without an Environment Light, a soft average of the studio stands in. **Ambient on the body** scales it.

From [liquid_glass_lit.frag](liquid_glass_lit.frag), lines 493–508:

```glsl
// Light reaching the glass body from all around: Ambient Light COMPs, the
// diffuse part of each Environment Light COMP, or a soft average of the studio.
vec3 ambientLight(vec3 n, vec3 toCam)
{
    vec3 a = uTDGeneral.ambientColor.rgb;
#if TD_NUM_ENV_LIGHTS > 0
    if (useSceneEnv()) {
        for (int i = 0; i < TD_NUM_ENV_LIGHTS; i++) {
            TDPBRResult r = TDEnvLightingPBR(i, vec3(1.0), vec3(0.0), n, toCam, 1.0, 1.0);
            a += r.diffuse * uSources.z;
        }
    }
#endif
    if (useStudio()) a += 0.35 * studio(n, 0.9) + vec3(0.04);
    return a;
}
```

The composition puts the pieces together. Light reaches the body and the surface, never the view through the glass: `through * tint` stays exactly what the Refraction TOP shows, tinted by the glass. Reflections, highlights, surface diffuse and the rim glow are added on top. **Opacity** scales everything, and the output is premultiplied alpha, as in the core study.

One formula covers every scene. Where the Refraction TOP covers the view (`covered` = 1), the glass shows the bent scene and is opaque. Where the scene render is transparent, or no Refraction TOP is connected (`covered` = 0), there is nothing to bend, so alpha drops by the share of light that passes and the real background behind the glass shows through by blending. **Energy conserving** (off by default) takes the reflected share out of the view through the glass, so Mirror 1 becomes a true mirror. Then `TDFog()` adds the Camera COMP's fog, only the glass's own share of it, since what shows through keeps whatever fog its own render gave it. Built-in MATs fog by themselves; a GLSL MAT fogs only if it calls `TDFog()`. The demo's backdrop card does not, so in the demo only the glass fades into fog. A very tight highlight can be thousands of times brighter than white, so the colour is capped at 1024 to stay finite in a 16-bit float render. The teaching stages get the same cap.

From [liquid_glass_lit.frag](liquid_glass_lit.frag), lines 550–610:

```glsl
    Lit lit = gatherLights(vWorldPos, n, toCam, clamp(uSurface.w, 0.02, 1.0));
    vec3 ambient = ambientLight(n, toCam);

    float thickness = uOptics.y;
    // The scene behind, bent. `covered` is the Refraction TOP's alpha there:
    // 0 where that TOP is transparent or not connected.
    vec3 through = vec3(0.0);
    float covered = 0.0;
    if (hasRefraction) {
        vec4 behind = transmitted(eye, n, uv, thickness, view, toUV);
        through = saturateColour(behind.rgb, uOptics.w);
        covered = behind.a;
    }
    float path = thickness * (1.0 + uBody.w * (1.0 / max(NdotV, 0.15) - 1.0));
    vec3 tint = absorption(path);
    vec3 glass = paramColour(uGlass.rgb);
    vec3 body = glass * (lit.diffuse + ambient * uShade.z);
    float translucency = uBody.x;
    vec3 litBody = glass * lit.diffuse * (1.0 - translucency);  // the lit part of the body

    vec3 film = thinFilm(NdotV, filmThickness());
    vec3 filmTint = mix(vec3(1.0), 2.0 * film, uFilm.x);

    float r0 = (uOptics.x - 1.0) / (uOptics.x + 1.0);
    float reflectance = mix(mix(r0 * r0, 1.0, fresnel), 1.0, uSurface.x);
    vec3 env = environment(reflect(eye, n), uSurface.z);
    vec3 reflection = env * paramColour(uReflect.rgb) * uReflect.a * reflectance * filmTint;
    vec3 fromLights = lit.specular * uShade.x * filmTint + lit.diffuse * uShade.y;
    vec3 glow = fromLights
              + paramColour(uRim.rgb) * uRim.a * fresnel
              + film * uFilm.x * 0.3 * (0.3 + 0.7 * fresnel);
    // Energy conserving (off by default): light the surface reflects no longer
    // also passes through it, so Mirror 1 is a mirror.
    float keep = 1.0 - uOptions.x * clamp(reflectance, 0.0, 1.0);

    // Where the Refraction TOP covers the view (covered = 1), the bent scene
    // passes through the glass. Where it is transparent or missing (covered < 1)
    // there is nothing to bend: the glass lets the real background behind it in
    // the render show through by blending, so alpha drops by the share that
    // passes. One grey share (the tint's average), since alpha has one channel;
    // the glass colour fills in the rest of the tint.
    float seeThrough = translucency * (1.0 - covered) * dot(tint, vec3(1.0 / 3.0));
    vec3 colour = (mix(body, through * tint, translucency)
                   + glass * (translucency * (1.0 - covered) - seeThrough)) * keep
                + reflection + glow;
    float alpha = 1.0 - seeThrough * keep;

    // Premultiplied output: opacity fades the whole glass, reflections included.
    // A very small highlight can peak far above 1; capping at 1024 keeps it
    // finite in a 16-bit float render (largest value 65504).
    colour = min(colour, vec3(1024.0)) * uBody.z;
    alpha *= uBody.z;
    // The Camera COMP's fog (TDFog changes nothing while fog is off). TDFog
    // takes an unpremultiplied colour: fogging black gives the fog colour it
    // adds, and the glass adds only its own share (alpha) of that. What shows
    // through keeps whatever fog its own render gave it: built-in MATs fog by
    // themselves, a GLSL MAT only if it calls TDFog (the demo card does not,
    // so the demo scene stays unfogged). The bent scene inside `colour` gets
    // the glass's fog on top of any fog it already had: an approximation.
    vec3 fogAdded = TDFog(vec4(0.0, 0.0, 0.0, 1.0), vWorldPos, vCamIndex).rgb;
    colour = TDFog(vec4(colour, 1.0), vWorldPos, vCamIndex).rgb - fogAdded * (1.0 - alpha);
```

**Experiment `body_light`:** How does a milky glass body take the scene's light?

On the built component, run `component.op('study_tools').module.apply(component, 'body_light')`.

Prediction: With Translucency 0.35, the Glass body stage is bright pink on the right, where the key light hits, and keeps a dimmer pink on the left from the Environment Light's ambient instead of going black.

Parameters: Preset=rose_quartz, Pause=True, Time=2.0, Stage=body, Demolights=key, Demoenv=True, Translucency=0.35. Time and unrelated controls are fixed by this preset.

![Experiment body_light: pink body, brighter where the key light hits. WebGL preview, not a TouchDesigner capture.](captures/preview-body_light.png)

*Preview (Glass body stage):* the torus is bright pink on the right, where the key light reaches it, and keeps a dimmer pink on the left from the Environment Light's ambient. Faint dark bands are the backdrop's black bars, still visible through the 35% translucent body.

## Twelve looks and a morph

How do presets and morphing reach the shader?

The shader only sees fifteen sets of four numbers, its **uniforms**, plus the Refraction TOP. Each parameter on the component feeds one of those numbers through an expression on the GLSL MAT's Vectors page. Presets work exactly as in the core study: choosing one copies its values into the parameters, and **Morph** blends every look-related value toward the **Morph target**. Presets set the look only. The light sources, environment intensity, shadow strength and built-in light are scene settings, and presets leave them alone. A preset therefore keeps working in any lighting. **Object size** is a setup value too: it is the object's size in the world, with the Geometry COMP's scale counted. Lengths such as Thickness are multiplied by it and the ripple and film frequencies divided by it, so a preset looks the same on a small or a large object. The ripples and film are worked out on the object's own coordinates, so they stick to it. The shader multiplies those coordinates by the Geometry COMP's scale (the cube root of its world matrix's determinant), so they follow Object size whether you sized the object in its SOP or with the COMP's Scale (`fit_size_carries_presets_over_comp_scale`).

Morphing also changes **Wobble speed**, and that is where time comes in. If the shader computed the ripple drift as speed × the time since TouchDesigner started, a speed change after an hour would throw the pattern a long way in one frame. So the component adds up speed × frame time every frame, in Python's double precision, and hands the result to the shader in `uPhase`, wrapped at 256. The noise repeats every 256 units, so the wrap does not show. An automated test plays one frame of a morph after an hour: it changes the image no more than after two seconds (`morph_frame_is_smooth_after_an_hour`).

From [liquid_glass_lit.frag](liquid_glass_lit.frag), lines 25–46:

```glsl
uniform sampler2D sRefraction;

// Lengths are in scene units: the component multiplies Thickness and Frost by
// Object size and divides Tint density and the pattern frequencies by it.
// Object size is the object's size in the world (Fit to Glass geometry counts
// the Geometry COMP's scale), so the shader multiplies the pattern frequencies
// by that scale (worldScale()).
uniform vec4 uGlass;     // rgb glass colour, a tint density (per scene unit)
uniform vec4 uBody;      // translucency, frost (scene units), opacity, edge tint
uniform vec4 uOptics;    // ior, thickness (scene units), dispersion, saturation
uniform vec4 uReflect;   // rgb reflection tint, a reflection amount
uniform vec4 uSurface;   // mirror, fresnel power, reflection roughness, highlight size (roughness)
uniform vec4 uRim;       // rgb rim colour, a rim amount
uniform vec4 uShade;     // specular, surface diffuse, ambient, shadow strength
uniform vec4 uSources;   // light source (0 auto, 1 scene, 2 built-in), environment source (same), env intensity, env mip levels
uniform vec4 uKey;       // built-in key light: xyz direction toward the light, w intensity
uniform vec4 uKeyColor;  // built-in key light rgb colour, w studio rotation (radians)
uniform vec4 uFilm;      // iridescence, film thickness (nm), film variation, film swirl frequency (2.5 / object size)
uniform vec4 uWobble;    // amount, scale (ripples per scene unit: Wobble scale / object size), speed, unused
uniform vec4 uPhase;     // noise drift: 0.6, 0.4, -0.3, 0.15 x speed, added up every frame, wrapped to 0..256
uniform vec4 uState;     // teaching stage, samples, flip V, has refraction TOP
uniform vec4 uOptions;   // energy conserving (0 or 1), colours are sRGB (1) or as typed (0), unused, unused
```

**Experiment `morph`:** How do presets and the morph reach the shader?

On the built component, run `component.op('study_tools').module.apply(component, 'morph')`.

Prediction: Halfway between Prism Chrome and Violet Gel: a faintly violet glass with softer fringes; the scene's lights and reflections stay the same.

Parameters: Preset=prism_chrome, Pause=True, Time=2.0, Stage=final, Morphtarget=violet_gel, Morph=0.5. Time and unrelated controls are fixed by this preset.

![Experiment morph: halfway between Prism Chrome and Violet Gel. WebGL preview, not a TouchDesigner capture.](captures/preview-morph.png)

*Preview:* a faintly violet glass with softer fringes, under the same lights and reflections. Automated tests confirm that Morph 1 renders exactly the target preset and Morph 0 changes nothing.

**Experiment `final`:** What does the finished default look like in the demo scene?

On the built component, run `component.op('study_tools').module.apply(component, 'final')`.

Prediction: Prism Chrome on the torus: rainbow fringes through the glass, coloured reflections from the Environment Light, a warm key highlight on the upper right and blue-violet glints on the left from the rim light.

Parameters: Preset=prism_chrome, Pause=True, Time=2.0, Stage=final, Demolights=both, Demoenv=True. Time and unrelated controls are fixed by this preset.

![The twelve presets on a knot under the demo lights. WebGL preview, not a TouchDesigner capture.](captures/presets-sheet.png)

*Preview of all twelve presets on a knot (the knot exists only in the preview; the TouchDesigner demo uses a torus), lit by the demo key and rim lights and the Environment Light. [The same sheet over the Type backdrop](captures/presets-sheet-type.png) compares with the other family studies.*

## Use it in your own lit scene

How do you put the glass into a scene where things can pass in front of it?

Draw it into the scene render, the way Heckel's article does in WebGL: render the scene without the glass, then draw the glass into that render (refraction article, lines 140–154). In TouchDesigner that is a **Render Pass TOP**. It starts from another render's colour and depth, so anything already drawn in front of the glass hides it.

1. Render your scene without the glass in a Render TOP, Render Mode 2D, and set it as **Inputs > Refraction TOP**.
2. Set your glass Geometry COMP's **Material** to `liquid_glass_lit/material`.
3. Wire that Render TOP into a Render Pass TOP with the same camera, only the glass as Geometry, and the lights that should light the glass. Turn **Clear Depth Buffer** and **Clear to Camera Color** off, and **Dither** off on both renders: the glass never calls `TDDither()`, but dithered built-in materials would be bent through it.
4. If your glass is much smaller or larger than the demo torus, press **Inputs > Fit to Glass geometry**. It sets **Object size** from the objects that wear the material (this study has no Glass geometry field; it finds them for you), measured in the world, so a Geometry COMP's Scale counts.

That is all. No light direction to type, no Reflection TOP to connect. The demo uses the same network: `demo_scene` draws the backdrop on a card at the far plane and, if you ask for it, a dark bar in front of the torus; `render` is the Render Pass TOP.

The material finds its place in the Refraction TOP from the pixel's position on screen, and it turns scene units into a screen offset with the camera's own projection:

From [liquid_glass_lit.frag](liquid_glass_lit.frag), lines 65–113:

```glsl
// Where this pixel sits on the render, 0..1 across and up.
// uTDGeneral.viewport holds (x, y, 1/width, 1/height) in pixels.
vec2 screenUV()
{
    vec2 uv = (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw;
    if (uState.z > 0.5) uv.y = 1.0 - uv.y;  // Flip V: escape hatch if the input arrives upside down
    return uv;
}

// Which way screen x and y run against the camera's own x and y: +1 or -1
// each. TouchDesigner's usual orientation gives +1, +1; a build whose screen
// y (or x) runs the other way would bend light the wrong way without this.
// It is measured per pixel, without guessing: the pixel's own point, projected
// with the camera's projection, lands at ndc; the raster says the pixel sits
// at `raster` (same -1..1 range, from gl_FragCoord). Same sign: the raster
// follows the projection; opposite: it is mirrored. The projection's own sign
// (a mirrored proj matrix) counts too. On the centre line of a render with an
// odd width or height, both are 0 and cannot be told apart. There the sign of
// `ndcStep`, how ndc changes to the next pixel (screen derivatives, taken at
// the top of main()), decides instead, as in the Liquid Glass Prism study. A
// derivative is only trusted where the surface is not nearly edge-on:
// `depthStep`, how much 1/w changes to the next pixel, stays under 10%.
// Otherwise, and for a value that is not a number, the result is +1.
vec2 screenSign(vec2 ndc, vec2 ndcStep, vec2 depthStep, mat4 proj)
{
    vec2 raster = 2.0 * (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw - 1.0;
    vec2 runs = vec2(abs(ndc.x + raster.x) < abs(ndc.x - raster.x) ? -1.0 : 1.0,
                     abs(ndc.y + raster.y) < abs(ndc.y - raster.y) ? -1.0 : 1.0);
    // Neighbouring pixel centres are 2 x viewport.zw apart in raster units;
    // only a pixel exactly on a centre line comes within 0.5 x viewport.zw of 0.
    vec2 useStep = step(abs(raster), 0.5 * uTDGeneral.viewport.zw) * step(depthStep, vec2(0.1));
    runs = mix(runs, vec2(ndcStep.x < 0.0 ? -1.0 : 1.0, ndcStep.y < 0.0 ? -1.0 : 1.0), useStep);
    vec2 orient = runs * vec2(proj[0][0] < 0.0 ? -1.0 : 1.0, proj[1][1] < 0.0 ? -1.0 : 1.0);
    if (uState.z > 0.5) orient.y = -orient.y;  // Flip V flips the base UV and every vertical offset together
    return orient;
}

// Fold coordinates that leave the image back inside it (mirror repeat).
vec2 mirrorUV(vec2 uv)
{
    return 1.0 - abs(1.0 - mod(uv, 2.0));
}

// How far one scene unit moves on screen at this pixel's depth.
vec2 unitsToUV(mat4 proj, float depth)
{
    float perspective = abs(proj[2][3]) > 0.5 ? depth : 1.0;
    return 0.5 * abs(vec2(proj[0][0], proj[1][1])) / perspective;
}
```

Both steps assume the render is one flat picture from one camera. So keep Render Mode at 2D: in Cube Map or Fish-Eye renders the glass still lands in the right place, but the bend reads the wrong part of the scene. With several cameras, give each one its own scene render and glass pass.

`screenSign()` checks which way the screen runs. It projects the pixel's own point with the camera's projection and compares where it lands with where the pixel actually is. If a build drew screen y upside down relative to the projection, every bend would go the wrong way; the sign turns it back. An automated test emulates such a build and gets the exact mirror image (`bends_follow_screen_orientation`). One row and one column are the exception. In a render with an odd width or height they sit exactly on the screen's centre lines, where both positions are 0 and there is nothing to compare. There the sign of a screen derivative decides: how the projected position changes to the next pixel. `main()` takes it at its very top, where every pixel still runs the same code. On a nearly edge-on surface the next pixel's position is a poor guess, so the tie gives +1 there. A second test counts the wrong signs at every glass pixel of the twelve presets on three objects, in both orientations and at an even and an odd size (`screen_orientation_has_no_wrong_pixels`). It also shows the remaining limit: with antialiasing, a pixel the glass only partly covers is shaded at its centre, outside its own triangle, and near a centre line a few of those still get the wrong sign. In this study's preview they change at most 6 pixels in twelve frames, by up to 26/255, and only where the raster runs the other way. Whether that shows in TouchDesigner is an open family question, with a native check pending. A centroid-sampled position removed most of them in the usual raster in a wider preview sweep, but no TouchDesigner build has run one, so the shader does not use it yet.

The vertex shader's `main()` is also ready for a **Render Pick DAT or CHOP**. It places the point first, which every render needs. Then it follows the form printed on Derivative's *Write a GLSL MAT* page: for a pick render TouchDesigner defines `TD_PICKING_ACTIVE`, so of the branch only the `#else` block runs, where `TDWritePickingValues()` writes the values the pick reads. An ordinary render runs the other block and calls `passToPixelStage()`. Its code is the core study's vertex shader (only the comments differ), and a unit test keeps it that way.

From [liquid_glass_lit.vert](liquid_glass_lit.vert), lines 30–41:

```glsl
    // Every render places the point, a pick render too.
    vec3 objPos = TDPos();
    vec4 world = TDDeform(objPos);
    gl_Position = TDWorldToProj(world);
#ifndef TD_PICKING_ACTIVE
    passToPixelStage(objPos, world);
#else
    // A Render Pick DAT or CHOP is drawing: TouchDesigner sets
    // TD_PICKING_ACTIVE, so of the branch only this block runs. Its default
    // pick values are right, because the points move only through TDDeform.
    TDWritePickingValues();
#endif
```

**Experiment `occluder`:** Does an object between the camera and the glass stay in front of it?

On the built component, run `component.op('study_tools').module.apply(component, 'occluder')`.

Prediction: The dark bar stays in front of the torus: the Render Pass TOP draws the glass into the scene render and keeps its depth, so the bar hides the glass behind it. Beside the bar, the glass can show a bent copy of the bar's edge, because the Refraction TOP (the scene render) contains the bar too.

Parameters: Preset=prism_chrome, Pause=True, Time=2.0, Stage=final, Demolights=both, Demoenv=True, Demooccluder=True. Time and unrelated controls are fixed by this preset.

![Experiment occluder: a dark bar in front of the torus stays in front of the glass. WebGL preview, not a TouchDesigner capture.](captures/preview-occluder.png)

*Preview:* the bar stays in front of the torus. To its right, the glass shows a dark, bent copy of the bar: the Refraction TOP is the scene render, and the bar is in it. An automated test compares the bar with and without the glass: 0 of 20,444 bar pixels change (`occluder_stays_in_front`). The same test models the earlier recipe, a glass render laid over the scene with an Over TOP. There the glass covers 10,559 of the bar's pixels. An Over TOP is still fine over a flat image or video with nothing in front of the glass. The [README](README.md) has the details.

The scene behind the glass changes the look a lot. **Study > Demo backdrop** swaps the checkerboard for bold white type on black, the backdrop the core and Prism studies use too.

**Experiment `type_backdrop`:** How does the glass read over a different scene, such as bold type on black?

On the built component, run `component.op('study_tools').module.apply(component, 'type_backdrop')`.

Prediction: Over the Type backdrop, Chrome Type bends the white letters along the torus and splits their edges into thin colour fringes; the reflections and highlights are the same as over the checkerboard, because only the Refraction TOP changed. The family's other studies use the same backdrop, so their contact sheets compare.

Parameters: Preset=chrome_type, Pause=True, Time=2.0, Stage=final, Demolights=both, Demoenv=True, Backdrop=type. Time and unrelated controls are fixed by this preset.

![Experiment type_backdrop: white type bent and split into colour fringes by the torus. WebGL preview, not a TouchDesigner capture.](captures/preview-type_backdrop.png)

*Preview:* the white letters bend around the torus and break into thin colour fringes at their edges; the reflections are the same as over the checkerboard. An automated test confirms that *Checker* is still the earlier backdrop exactly and *Type* is mostly black with heavy white ink (`backdrop_menu_switches_the_demo_scene`).

## Limits

- **Not yet run in TouchDesigner.** The shaders compile as GLSL 4.60 against stand-ins for every light setup tested, and the preview passes its tests, but the stand-in light functions are not TouchDesigner's. Absolute brightness of scene lights can differ from the preview. See [validation.json](validation.json).
- **Signature risk.** The material calls the seven-argument `TDEnvLightingPBR()` that TouchDesigner's own shader preamble defines. Derivative's page lists a mixed form with extra arguments. If your build reports a compile error there, that line is the place to look.
- **Reflections need a map.** An Environment Light COMP without a map reflects black. Give it a map, or set **Environment** to *Built-in only*.
- **Glass casts opaque shadows.** A shadow map treats the glass as solid. Keep it out of a light's Shadow Casters if it darkens itself.
- **Light never passes through.** A light behind the glass does not shine through it toward the camera; only its edges catch it. The view through the glass comes only from the Refraction TOP.
- **Only what the camera sees can be refracted,** and the bend is a single-surface approximation, as in the core study.
- **Fog is an approximation.** `TDFog()` adds the glass's own share of the fog colour; the bent scene keeps any fog its own render gave it and gets the glass's fog on top. The demo scene render is unfogged: its backdrop card is a GLSL MAT that never calls `TDFog()`. TouchDesigner's fog is a pending native check. With several colour buffers, the extra ones get zero.
- **Partly covered scene pixels count twice.** Where the Refraction TOP's alpha is between 0 and 1 (antialiased edges of a transparent scene render), the glass draws the bent scene and blending adds the scene behind it again by the see-through share.
- **Objects in front can show up bent inside the glass,** next to their edges, because the Refraction TOP contains them.
- **One flat camera view.** Render Mode 2D and one camera per glass render.
- **One Object size per component.** Fit measures when you press it and takes the largest object that wears the material. A smaller object, a Geometry COMP whose Scale changes after Fit, and an instance with its own scale all keep that one Object size. At a fifth of the size the glass bends and tints as if it were five times larger; scaled up three times without a new Fit, as if it were three times smaller. Instanced glass is placed, turned and lit per instance through `TDDeform`, and its ripples and film bands grow with it, but their tilt ignores its rotation. The README lists the workarounds; a change that would let all three follow is recorded in [decisions.json](decisions.json) and waits for the user's decision.
- **The preview is not TouchDesigner.** Its light functions are stand-ins, its mipmaps are plain averages, it wraps the panorama sideways and it has no cube-map Environment Light.
- **Colour parameters convert the transfer curve only.** *Auto* follows the project's working colour space for the typed glass, reflection, rim and built-in key colours; wide-gamut primaries are not converted. The previews show *As typed*.

## Credits

Refraction through a render of the scene, multi-sample dispersion, saturation, the diffuse N·L term, the glass highlight and the fresnel glow come from Maxime Heckel, [Refraction, dispersion, and other shader light effects](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/). His article credits the sampling technique to the open-source Junni site by @ore_ukonpower, and the colour-channel split to research by Ravishankar Sundararaman. Copying scene light data into a shader each frame is shown in his [Shaping light](https://blog.maximeheckel.com/posts/shaping-light-volumetric-lighting-with-post-processing-and-raymarching/) article. The GGX highlight follows the widely used Cook-Torrance model (Walter et al. 2007; Karis 2013). The TouchDesigner implementation is newly written and builds on the core Liquid Glass study (commit a6f95c6, brought up to its audit rounds 2 and 3 and its family sync). The frost disc uses Martin Roberts' R2 quasirandom sequence. TouchDesigner API details follow Derivative's documentation (Write a GLSL MAT, GLSL Reference, Environment Light COMP, Render TOP). [sources.json](sources.json) lists each source's lines and how it was adapted.
