# Liquid Glass: a refracting, colour-splitting glass material for any object

![Destination: the default Prism Chrome look on the demo torus. WebGL preview of the delivered GLSL, not a TouchDesigner capture.](captures/preview-final.png)

*The destination: the default look on the demo torus. This image is a WebGL preview of the same GLSL files, not a TouchDesigner capture.*

This tutorial builds a glass material you can put on any 3D object in TouchDesigner. Seen through it, the scene shifts and flips. Bright edges break into rainbow fringes, and the glass can be tinted, frosted, mirrored or rippled like liquid. It is written for TouchDesigner users who have not written shaders before. Every code block below is copied automatically from the delivered files, so what you read is what runs.

The core idea comes from Maxime Heckel's article [Refraction, dispersion, and other shader light effects](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/). His version is a web scene you can orbit around; this one is a reusable TouchDesigner material. The adaptation changes how the bend is measured, how colours are split and how blur works, and adds tint, reflections, liquid ripples, a thin oil film and presets. Each change is pointed out where it happens.

## Open the study

Build the component from the Textport, keeping it in a variable named `component` so the experiment commands below work:

```python
import runpy
component = runpy.run_path('/path/to/liquid-glass/build.py')['build']()
```

Open the component's viewer. Each experiment below is a named preset that fixes time and every unrelated control, then changes one thing. Running an experiment first returns the look to its defaults: every preset value, Morph, Samples, Energy conserving, the light direction, panorama rotation and flat image warp, the back-face pass and the Study page (including Demo backdrop, since the predictions describe the checkerboard). So you can run the experiments in any order. Your setup stays as it is: the Refraction and Reflection TOPs, Reflection map, Faces, the back-face camera and glass geometry, Object size, Flip screen V, Colour parameters and Demo render. `component.op('study_tools').module.apply(component, 'final')` brings back the default look, paused at 2 seconds with the Preset menu on *Custom*; turn off **Study > Pause** to let it move again. Experiments change the component's `material`, so glass in your own scene that uses it changes too: if you have tuned this component, build a second one for the tutorial. The **Study > Teaching stage** menu shows one ingredient of the material at a time; most experiments use it.

The pictures under each experiment come from a WebGL preview that runs the same shader files in a browser. They show what the code does; they are not proof of how TouchDesigner renders it. When you run an experiment natively, compare against the stated prediction.

A shader is a small program the graphics card runs for you. A GLSL MAT holds two of them. The **vertex shader** runs once per corner of the mesh and decides where it lands on screen. The **pixel shader** runs once per pixel the object covers and decides its colour. Almost all of the glass happens in the pixel shader.

## Make the object see-through

How can an object show what is behind it, when a shader only knows about its own surface?

It can't see the scene, so we hand it a picture of the scene: a render of everything *except* the glass, from the same camera. This is the **Refraction TOP**. If each glass pixel copies the pixel at the same screen position from that picture, the object becomes invisible. That sounds useless, but it is the foundation: every effect after this is a change to *where* we look in that picture, or what we do with the colour we find. Heckel does the same with a frame buffer rendered each frame inside the web page.

The vertex shader places each point on screen (its `main()` comes back in "Use it in your own scene") and passes along what the pixel shader needs. `passToPixelStage()` writes it: the surface position and normal in world space, the position in the object's own space (so ripples later stick to the object), and which camera is rendering.

From [liquid_glass.vert](liquid_glass.vert), lines 14–24:

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

In the pixel shader, `screenUV()` turns the pixel's position into 0..1 coordinates across the render. `uTDGeneral.viewport` is TouchDesigner's built-in description of the render size. `mirrorUV()` folds coordinates that leave the picture back inside it, so strong bending near the frame edge doesn't smear the border. `unitsToUV()` answers a question we need in the next section: how far does one scene unit move on screen at this pixel's depth?

`screenSign()` answers a quieter question: does the screen run the same way as the camera? In TouchDesigner's usual setup it does, and the function returns +1 for both directions. A build whose screen rows run the other way would otherwise bend every view upside down. So the shader checks, at every pixel, where the pixel's own point lands when the camera's projection maps it, against where the pixel actually sits on the render. Same side: +1; mirrored: -1. A first version used screen derivatives everywhere instead (how a value changes from one pixel to the next); on a few sliver triangles along silhouettes their neighbours are made-up values, and those pixels flipped (up to 50/255 on the knot). So the comparison uses the pixel's own values, with one exception. On the centre row or column of a render with an odd width or height, the pixel sits exactly at 0 and so does its projected point, and the comparison cannot tell the two cases apart. There, and only where the surface is not nearly edge-on, the derivative of the projected position decides (the tie-break of the Liquid Glass Prism and Lit studies). Without it, a mirrored build bent the whole centre row of a 481 x 271 preview the wrong way: about 1,500 pixels per twelve renders. **Flip screen V** stays as the manual escape hatch for inputs that arrive upside down: it flips the screen position and the measured direction together.

From [liquid_glass.frag](liquid_glass.frag), lines 57–106:

```glsl
// Where this pixel sits on the render, 0..1 across and up.
// uTDGeneral.viewport holds (x, y, 1/width, 1/height) in pixels.
vec2 screenUV()
{
    vec2 uv = (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw;
    if (uState.w > 0.5) uv.y = 1.0 - uv.y;  // Flip V: escape hatch if the inputs arrive upside down
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
// the top of main()), decides instead, as in the Liquid Glass Prism and Lit
// studies. A derivative is only trusted where the surface is not nearly
// edge-on: `depthStep`, how much 1/w changes to the next pixel, stays under
// 10%. Otherwise, and for a value that is not a number, the result is +1.
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
    if (uState.w > 0.5) orient.y = -orient.y;  // Flip V flips the base UV and every vertical offset together
    return orient;
}

// Fold coordinates that leave the image back inside it (mirror repeat),
// so strong refraction near the frame edge never smears a border pixel.
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

**Experiment `see_through`:** What does the glass show when it does not bend light?

On the built component, run `component.op('study_tools').module.apply(component, 'see_through')`.

Prediction: The object disappears: every glass pixel shows the refraction TOP at its own screen position.

Parameters: Preset=clear_crystal, Pause=True, Time=2.0, Stage=final, Ior=1.0, Dispersion=0.0, Frost=0.0, Density=0.0, Reflection=0.0, Rim=0.0, Specular=0.0, Diffuse=0.0, Iridescence=0.0, Wobble=0.0, Saturation=1.0. Time and unrelated controls are fixed by this preset.

![Experiment see_through: the torus is invisible. WebGL preview, not a TouchDesigner capture.](captures/preview-see_through.png)

*Preview:* the torus disappears completely. An automated test compares this render with the backdrop alone; the largest difference is 1/255 (`ior1_is_invisible` in [the preview tests](checks/preview_tests.cjs)).

![Actual node names and dependencies, shown schematically](figures/network.svg)

The diagram is a schematic of the recipe, not a captured network. Solid lines carry images, dashed lines are parameter references, and the orange path is the optional back-face pass. In your own scene the Render Pass TOP's output is the final image; the Over TOP belongs to the demo, whose backdrop is a flat picture.

## Bend the light

Why does glass shift and flip what is behind it?

Light changes direction when it enters a denser material. The **index of refraction** (IOR) says how much: 1.0 is air (no bend), water is 1.33, glass about 1.5. GLSL has a built-in `refract()` that takes the viewing direction, the surface normal and the ratio of the two IORs, and returns the bent direction. The bend is largest where the surface tilts away from you. That's why the edges of a glass ball distort most and its middle least.

We need a shift on screen, not a direction. `bendOffset()` subtracts the unbent direction from the bent one, which leaves the sideways part of the bend. It multiplies that by **Thickness**, how far the light travels inside the glass in scene units. Then it converts the result into screen units with the camera's own projection. Heckel's code adds the refracted direction's x and y straight to the screen coordinates without projecting them through the camera, so the shift's on-screen direction and size don't follow the camera's distance, lens or orientation. Projecting it with the camera's own matrices makes the effect behave the same at any distance and with any lens.

From [liquid_glass.frag](liquid_glass.frag), lines 277–285:

```glsl
// Refract the view ray at the surface and measure how far it moves sideways
// (in camera space) after crossing `thickness` scene units of glass.
vec2 bendOffset(vec3 eye, vec3 n, float ior, float thickness, mat3 view, vec2 toUV)
{
    vec3 refracted = refract(eye, n, 1.0 / ior);
    if (dot(refracted, refracted) < 0.5) refracted = eye;  // total internal reflection guard
    vec3 sideways = view * (refracted - eye);
    return sideways.xy * thickness * toUV;
}
```

The main function first works out, once per pixel, the facts everything else uses. These are the screen derivatives of the position and of its projection (taken first, because inside a branch they are undefined), the camera position and direction, the depth, the distance along the view ray, the screen position, the surface normal and the **fresnel** term (how close to edge-on we see the surface; it returns in the reflection section). A Light direction of 0, 0, 0 points nowhere, so it counts as straight up.

From [liquid_glass.frag](liquid_glass.frag), lines 493–531:

```glsl
    // Screen derivatives come first, while all four pixels of each 2x2 block
    // still run the same code: inside a branch, or after TDCheckDiscard() has
    // removed a neighbour, they are undefined. They give the faceted normal when
    // the geometry has no normals, and the screen orientation on a centre line.
    mat4 proj = uTDMats[vCamIndex].proj;
    vec3 camPoint = (uTDMats[vCamIndex].cam * vec4(vWorldPos, 1.0)).xyz;  // this pixel's point, camera space
    vec4 clip = proj * vec4(camPoint, 1.0);
    vec2 ndc = clip.xy / clip.w;  // where the camera projects it, -1..1
    float invW = 1.0 / clip.w;
    vec2 ndcStep = vec2(dFdx(ndc.x), dFdy(ndc.y));
    vec2 depthStep = abs(vec2(dFdx(invW), dFdy(invW)) / invW);
    vec3 dPdx = dFdx(vWorldPos);
    vec3 dPdy = dFdy(vWorldPos);
    TDCheckDiscard();

    bool perspective = abs(proj[2][3]) > 0.5;
    vec2 orient = screenSign(ndc, ndcStep, depthStep, proj);
    vec3 camPos = uTDMats[vCamIndex].camInverse[3].xyz;
    mat3 view = mat3(uTDMats[vCamIndex].cam);
    vec3 forward = safeNormalize(-uTDMats[vCamIndex].camInverse[2].xyz, vec3(0.0, 0.0, -1.0));
    vec3 eye = perspective ? safeNormalize(vWorldPos - camPos, forward) : forward;
    float depth = max(-camPoint.z, 1e-3);
    // Distance along the view ray: from the camera for a perspective camera,
    // along the parallel rays (the depth) for an orthographic one.
    float surfaceDistance = perspective ? length(vWorldPos - camPos) : depth;
    // Camera units to screen UV, with the measured orientation: every bend and
    // frost offset goes through it.
    vec2 toUV = unitsToUV(proj, depth) * orient;
    vec2 uv = screenUV();

    bool backPass = uState.y > 0.5;
    bool useBack = uInputs.z > 0.5 && !backPass;
    bool hasRefraction = uInputs.x > 0.5;

    // Ripples tilt the normal again, so it is turned toward the camera once more.
    vec3 n = faceCamera(wobbleNormal(facingNormal(eye, dPdx, dPdy)), eye);
    vec3 lightDir = safeNormalize(uLight.xyz, vec3(0.0, 1.0, 0.0));  // (0, 0, 0) means straight up
    float NdotV = clamp(dot(n, -eye), 0.0, 1.0);
    float fresnel = pow(1.0 - NdotV, uSurface.y);
```

**Experiment `bend`:** What does refract() do to the view through the object?

On the built component, run `component.op('study_tools').module.apply(component, 'bend')`.

Prediction: The backdrop appears shifted and flipped inside the torus; where the surface tilts most, near the edges, it shifts most.

Parameters: Preset=clear_crystal, Pause=True, Time=2.0, Stage=refraction, Dispersion=0.0, Ior=1.45, Thickness=0.8. Time and unrelated controls are fixed by this preset.

![Experiment bend: the backdrop is shifted and flipped inside the tube. WebGL preview, not a TouchDesigner capture.](captures/preview-bend.png)

*Preview:* the checkerboard and black bars appear shifted and upside down inside the tube, most strongly near its edges.

**Experiment `thick`:** How does thickness change the bend?

On the built component, run `component.op('study_tools').module.apply(component, 'thick')`.

Prediction: Doubling Thickness doubles the sideways shift, so the flipped image inside the tube is pushed further.

Parameters: Preset=clear_crystal, Pause=True, Time=2.0, Stage=refraction, Dispersion=0.0, Ior=1.45, Thickness=1.6. Time and unrelated controls are fixed by this preset.

![Experiment thick: twice the thickness pushes the flipped image further. WebGL preview, not a TouchDesigner capture.](captures/preview-thick.png)

*Preview:* the same picture pushed about twice as far, so different bars land inside the tube.

The normal matters as much as the IOR. A mesh only stores normals at its corners. Between corners they are blended, and right at the silhouette a blended normal can tilt slightly *away* from the camera. `refract()` then bends even at IOR 1. The first version of this shader failed the invisibility test along every silhouette for exactly this reason. `faceCamera()` lays any such normal back into the view plane. It runs twice: inside `facingNormal()`, and again after the liquid ripples (a later section), which can tilt a normal away once more. A review found thin streaks along the outline of every rippled preset before the second call was added; a test now checks that rippled glass at IOR 1 is still invisible. When the geometry has no normals at all, `facingNormal()` should build faceted ones from screen derivatives (not yet checked in TouchDesigner). Its test compares the facet's size with the pixel's size, so it works at any scene scale.

From [liquid_glass.frag](liquid_glass.frag), lines 110–143:

```glsl
// A unit vector along v, or `fallback` when v is (nearly) zero: normalize()
// of a zero vector is undefined (NaN on many GPUs).
vec3 safeNormalize(vec3 v, vec3 fallback)
{
    float l2 = dot(v, v);
    return l2 > 1e-12 ? v * inversesqrt(l2) : fallback;
}

// Near silhouettes a normal can tilt slightly away from the camera, and then
// refract() bends even at IOR 1. Lay any such normal back into the view plane.
vec3 faceCamera(vec3 n, vec3 eye)
{
    float away = dot(n, eye);
    return away > -0.01 ? normalize(n - eye * (away + 0.01)) : n;
}

// The interpolated normal, or, when the geometry carries no normals, a faceted
// one from the screen derivatives of the position (dPdx, dPdy, taken in main).
// Always turned to face the camera.
vec3 facingNormal(vec3 eye, vec3 dPdx, vec3 dPdy)
{
    vec3 n = vWorldNormal;
    if (dot(n, n) > 1e-8) {
        n = normalize(n);
        n = TDFrontFacing(vWorldPos, n) ? n : -n;
    } else {
        // Relative test, so the size of a pixel in scene units cancels out.
        n = cross(dPdx, dPdy);
        float l2 = dot(n, n);
        n = l2 > 1e-12 * dot(dPdx, dPdx) * dot(dPdy, dPdy) ? n * inversesqrt(l2) : -eye;
        n = dot(n, eye) > 0.0 ? -n : n;
    }
    return faceCamera(n, eye);
}
```

## Split the colours, then frost them

Where do rainbow fringes come from, and how does the same loop make frosted glass?

In real glass the IOR depends on the colour of light: violet bends a little more than red. This is **dispersion**. A white edge seen through glass splits into a small rainbow. To imitate it, the shader looks up the picture behind the glass many times, each time for a different slice of the spectrum. Each slice has its own IOR and its own red, green and blue weight. Adding the samples and dividing by the total weight per channel gives the final colour. With Dispersion at 0 every slice bends equally, and the result is exactly the plain bend from "Bend the light".

Heckel splits light into red, green and blue, then six bands (adding yellow, cyan and violet) with their own IORs. That reads the picture twelve times per loop step in his final scene. Here each step is one spectrum slice and one read, so 12 samples cost 12 reads. **Samples** sets the count; raise it if strong dispersion shows colour steps. Because neighbouring slices share colour (their red, green and blue weights overlap), 12 slices already come close to many: at Dispersion 1, a 12-sample render differs from a 64-sample one by less than 1/255 on average at the presets' own Thickness in the preview, and by less than 2/255 at Thickness 2.5 (`dispersion_converges_with_samples`). A sibling study, Liquid Glass Blobs, blurs each slice by a mipmap level as wide as the gap between neighbouring slices. Tried here, it doubled the difference from the 64-sample render, because a mipmap blurs across the rainbow as well as along it; so it was left out.

Each sample's IOR is kept at 1 or above. Below 1 the bend flips direction and snaps to zero past a critical angle, which drew hard rings at very low IOR with strong dispersion.

**Frost** reuses the same loop. `discPoint()` spreads the samples over a small disc. Angle and area come from two different irrational steps (Martin Roberts' *R2* sequence), so the disc fills evenly for any sample count and the samples' average stays near the centre: frost blurs the view without shifting it. An earlier version took both from one golden-ratio sequence, which lines every sample up on a single spiral arm and shifted the image by about a tenth of the blur radius. Many sideways looks averaged together give a blur. With only 12 samples the first preview showed separate ghost copies instead of a smooth blur. Random jitter would have hidden that as grain, but the brief asked for a continuous look without dithering. So each sample now reads a **mipmap** level, a pre-shrunk copy of the picture, as wide as the gap between neighbouring samples. The builder sets the sampler filter to *Mipmap Linear* so TouchDesigner provides those levels. `saturateColour()` is Heckel's saturation: mix the colour with its own grey to make it duller or stronger.

From [liquid_glass.frag](liquid_glass.frag), lines 289–361:

```glsl
// Weight of one spectrum sample in R, G and B: w = 0 is red, w = 1 is violet.
vec3 spectrum(float w)
{
    vec3 c = clamp(1.0 - abs(w - vec3(0.1, 0.45, 0.8)) * vec3(2.4, 2.8, 2.4), 0.0, 1.0);
    c.r += 0.6 * clamp(1.0 - abs(w - 1.0) * 5.0, 0.0, 1.0);  // violet also excites red
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

// What lies behind the glass at uv: the back-face pass where it covers,
// otherwise the refraction TOP. lod > 0 reads a pre-blurred mipmap level of
// the scene; the back-face pass is always read sharp (see backfaceAt).
// Alpha is how much of that spot the scene covers: the Refraction TOP's own
// alpha (0 where its background is transparent), also on the inner surface.
// The back-face pass has no spare channel for it (its alpha is a distance),
// so the scene's alpha is read at the same spot.
vec4 sampleBehind(vec2 uv, float lod, bool useBack)
{
    uv = mirrorUV(uv);
    vec4 scene = textureLod(sRefraction, uv, lod);
    vec4 back = vec4(0.0);
    if (useBack && backfaceAt(uv, back)) return vec4(back.rgb, scene.a);
    return scene;
}

// Many slightly different refractions, one per sample of the spectrum.
// Violet bends more than red (dispersion). The same samples also spread over a
// disc (discPoint), which blurs the view (frost) without shifting it. Each
// frost sample reads a mipmap level as wide as the gap between samples, so the
// blur stays continuous instead of showing separate copies.
// The result keeps the scene's alpha: rgb stays premultiplied, and a says how
// much of the view through the glass the Refraction TOP actually covers.
vec4 transmitted(vec3 eye, vec3 n, vec2 uv, float thickness, mat3 view, vec2 toUV, bool useBack)
{
    int count = clamp(int(uState.z + 0.5), 1, 32);
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
        vec4 seen = sampleBehind(uv + offset, lod, useBack);
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
```

**Experiment `dispersion`:** What happens if every colour bends by a different amount?

On the built component, run `component.op('study_tools').module.apply(component, 'dispersion')`.

Prediction: Same bend as the 'bend' experiment, but every high-contrast edge seen through the glass now carries a rainbow fringe, with red and violet on opposite sides.

Parameters: Preset=clear_crystal, Pause=True, Time=2.0, Stage=refraction, Ior=1.45, Thickness=0.8, Dispersion=1.0. Time and unrelated controls are fixed by this preset.

![Experiment dispersion: rainbow fringes along every high-contrast edge. WebGL preview, not a TouchDesigner capture.](captures/preview-dispersion.png)

*Preview:* the same bend as in `bend`, but each black/white edge seen through the glass now carries a red-to-violet fringe, widest near the silhouette.

**Experiment `frost`:** What does spreading the samples over a disc look like?

On the built component, run `component.op('study_tools').module.apply(component, 'frost')`.

Prediction: The view through the glass blurs smoothly, without separate ghost copies.

Parameters: Preset=clear_crystal, Pause=True, Time=2.0, Stage=refraction, Dispersion=0.0, Frost=0.6. Time and unrelated controls are fixed by this preset.

![Experiment frost: a smooth blur without ghost copies. WebGL preview, not a TouchDesigner capture.](captures/preview-frost.png)

*Preview:* a continuous blur. Automated tests check that 12 and 32 samples agree within 16/255 at every pixel (`frost_converges_with_samples`; with the mipmap widening switched off, ghost copies make them differ by up to 31/255), and that the sample count changes nothing when dispersion and frost are both off (`samples_invariant_without_dispersion`).

## Give the glass its own colour

Why is coloured glass pale in the middle and deep at the edges?

Coloured glass is coloured because it absorbs some colours of the light passing through it. The further light travels inside, the more it loses: violet glass removes more red and green over a long path than over a short one. This is the **Beer-Lambert law**: what survives drops off exponentially with distance. `absorption()` applies it with the **Glass colour** (the colours that pass) and **Tint density** (how quickly the others are lost). **Edge tint** lengthens the path where you look at the surface edge-on. That gives the deep rims of reference image 2 while the middle stays pale. The glass colour is capped at 1 inside `absorption()`: a value above 1 can brighten the body, but the glass never amplifies the light passing through. `paramColour()` converts colour parameters from sRGB to linear when the project works in a linear colour space (**Inputs > Colour parameters**); in a default, pass-through project it changes nothing.

Not all glass is clear. **Translucency** mixes between the bent, tinted view (1) and the glass's own colour lit by the light (0), for milky, jelly-like or almost solid looks. `bodyColour()` uses soft, wrapped lighting so the body never goes fully black.

From [liquid_glass.frag](liquid_glass.frag), lines 365–391:

```glsl
// Colour parameters reach the shader as typed. In a project with a linear
// working colour space, uInputs.w asks for the sRGB-to-linear conversion that
// TouchDesigner applies to its own colour parameters.
vec3 paramColour(vec3 c)
{
    if (uInputs.w < 0.5) return c;
    vec3 low = c / 12.92;
    vec3 high = pow((max(c, 0.0) + 0.055) / 1.055, vec3(2.4));
    return mix(low, high, step(vec3(0.04045), c));
}

// Light that crossed the glass loses the colours the glass absorbs
// (Beer-Lambert): a longer path through tinted glass gives a deeper tint.
// The colour is clamped to 0..1 here: a glass colour above 1 can brighten the
// body, but it never amplifies the light passing through.
vec3 absorption(float path)
{
    vec3 passes = clamp(paramColour(uGlass.rgb), 0.0, 1.0);
    return exp(-(1.0 - passes) * uGlass.a * path);
}

// The glass's own colour where it scatters light instead of passing it.
vec3 bodyColour(vec3 n, vec3 lightDir)
{
    float wrap = clamp((dot(n, lightDir) + 0.5) / 1.5, 0.0, 1.0);
    return paramColour(uGlass.rgb) * paramColour(uLightColor.rgb) * (0.25 + 0.75 * wrap);
}
```

The composition puts the pieces together. The order matters: tint applies only to light that passed through, reflections sit on top, and **Opacity** scales everything, reflections included. The output is **premultiplied alpha**: the colour is already multiplied by its coverage, which is what TouchDesigner's Over TOP and the material's One / One Minus Source Alpha blending expect. By default reflections simply add on top of the see-through view, like Heckel's glow. **Energy conserving** (off by default) multiplies the see-through part by `keep`, what the surface does not reflect.

One formula covers every scene behind the glass. `covered` is the Refraction TOP's own alpha where the bent view lands: 1 over an opaque scene, 0 over a transparent background or with no Refraction TOP at all. Where it is 1, the glass shows the bent, tinted scene and writes alpha 1, exactly as it did before this formula existed (a preview test compares all twelve presets with the earlier shader). Where it is 0, there is nothing to bend, so the glass lets the real background through by blending: its alpha drops by the share that passes. A render of your scene with an empty background therefore stays empty behind clear glass, ready to lay over a plate. The back-face pass (see "Measure thickness with the back-face pass") stores a distance in its alpha, not coverage, so where it covers the view `sampleBehind()` takes the inner surface's colour from it and `covered` still from the Refraction TOP at the same spot. Clear glass with the pass on keeps an empty background empty too. Last comes the Camera COMP's fog: `TDFog()` does nothing while fog is off, and with fog on the glass adds only its own share of the fog colour.

From [liquid_glass.frag](liquid_glass.frag), lines 535–598:

```glsl
    float thickness = glassThickness(uv, surfaceDistance, useBack);
    // The scene behind, bent. `covered` is the Refraction TOP's alpha there:
    // 0 where that TOP is transparent or not connected.
    vec3 through = vec3(0.0);
    float covered = 0.0;
    if (hasRefraction) {
        vec4 behind = transmitted(eye, n, uv, thickness, view, toUV, useBack);
        through = saturateColour(behind.rgb, uOptics.w);
        covered = behind.a;
    }

    // Edge tint lengthens the light path at grazing angles (deep-coloured rims).
    float path = thickness * (1.0 + uBody.w * (1.0 / max(NdotV, 0.15) - 1.0));
    vec3 tint = absorption(path);
    vec3 body = bodyColour(n, lightDir);
    float translucency = uBody.x;

    vec3 film = thinFilm(NdotV, filmThickness());
    vec3 filmTint = mix(vec3(1.0), 2.0 * film, uFilm.x);

    float r0 = (uOptics.x - 1.0) / (uOptics.x + 1.0);
    float reflectance = mix(mix(r0 * r0, 1.0, fresnel), 1.0, uSurface.x);
    vec3 env = environment(reflect(eye, n), uv, view, orient);
    vec3 reflection = env * paramColour(uReflect.rgb) * uReflect.a * reflectance * filmTint;
    vec3 glow = highlights(n, eye, lightDir, fresnel)
              + film * uFilm.x * 0.3 * (0.3 + 0.7 * fresnel);
    // Energy conserving (off by default, like Heckel's additive glow): light the
    // surface reflects no longer also passes through it, so Mirror 1 is a mirror.
    float keep = 1.0 - uSurface.w * clamp(reflectance, 0.0, 1.0);

    // Where the Refraction TOP covers the view (covered = 1), the bent scene
    // passes through the glass. Where it is transparent or missing (covered < 1)
    // there is nothing to bend: the glass lets the real background behind it in
    // the render show through by blending, so alpha drops by the share that
    // passes. One grey share (the tint's average), since alpha has one channel;
    // the glass colour fills in the rest of the tint.
    float seeThrough = translucency * (1.0 - covered) * dot(tint, vec3(1.0 / 3.0));
    vec3 colour;
    float alpha;
    if (backPass) {
        // Inner surfaces: refracted scene plus softer reflections. Alpha carries
        // this surface's distance for the front pass (blending must be off).
        colour = through + 0.5 * (reflection + glow);
        alpha = surfaceDistance;
    } else {
        colour = (mix(body, through * tint, translucency)
                  + paramColour(uGlass.rgb) * (translucency * (1.0 - covered) - seeThrough)) * keep
               + reflection + glow;
        alpha = 1.0 - seeThrough * keep;
    }

    // Premultiplied output: opacity fades the whole glass, reflections included.
    if (!backPass) {
        colour *= uBody.z;
        alpha *= uBody.z;
        // The Camera COMP's fog (TDFog changes nothing while fog is off). TDFog
        // takes an unpremultiplied colour: fogging black gives the fog colour it
        // adds, and the glass adds only its own share (alpha) of that; what
        // shows through by blending is fogged in its own render. The bent scene
        // inside `colour` was fogged in its render too and gets the glass's fog
        // on top: an approximation.
        vec3 fogAdded = TDFog(vec4(0.0, 0.0, 0.0, 1.0), vWorldPos, vCamIndex).rgb;
        colour = TDFog(vec4(colour, 1.0), vWorldPos, vCamIndex).rgb - fogAdded * (1.0 - alpha);
    }
```

**Experiment `tint`:** Where does the glass colour come from?

On the built component, run `component.op('study_tools').module.apply(component, 'tint')`.

Prediction: Grazing edges turn deeper violet (Edge tint lengthens the path there); the middle stays pale and see-through. Without the back-face pass the thickness is one constant value; the 'backface' experiment measures real thickness.

Parameters: Preset=violet_gel, Pause=True, Time=2.0, Stage=body. Time and unrelated controls are fixed by this preset.

![Experiment tint: violet deepens toward the rims, where Edge tint lengthens the path. WebGL preview, not a TouchDesigner capture.](captures/preview-tint.png)

*Preview (Glass body stage, which hides reflections and highlights):* the view through the gel turns violet, deepest along the silhouette. Without the back-face pass, thickness is one number for the whole object, so this colour change comes from Edge tint alone; the back-face section measures real thickness.

**Experiment `milky`:** What does lower translucency do?

On the built component, run `component.op('study_tools').module.apply(component, 'milky')`.

Prediction: Compared with 'tint', only Translucency changes: the glass's own lavender colour replaces most of the see-through view, and the gel looks milky and nearly solid.

Parameters: Preset=violet_gel, Pause=True, Time=2.0, Stage=body, Translucency=0.3. Time and unrelated controls are fixed by this preset.

![Experiment milky: low translucency gives a nearly solid gel. WebGL preview, not a TouchDesigner capture.](captures/preview-milky.png)

*Preview (Glass body stage, as in `tint`):* the lavender body covers most of the background; only a faint bent image remains.

## Reflect the world

What does glass reflect, and why mostly at the edges?

`reflect()` mirrors the viewing direction around the normal. Where that reflected direction points decides what the glass shows. The material offers three sources. A **360 panorama TOP** is read by direction, in an equirectangular layout, and can be rotated. (This study's convention puts u = 0 toward +X, then +Z. It has not yet been compared with TouchDesigner's own environment lighting; Panorama rotation corrects an offset.) A **flat image TOP** suits plain images, movies or other renders; it is shifted across the screen by the reflected direction. The **built-in studio** is a dark room with soft white light strips. The studio is also the fallback when no Reflection TOP is connected. **Reflection blur** averages eight nearby directions, again with mipmaps, and widens the studio's light edges. A flat image moves further per direction (by Flat image warp), so it reads a correspondingly wider mipmap level; before that fix, strong warps showed eight stacked copies instead of a blur ([before and after](captures/review-flat-blur.png)).

How much glass reflects depends on the angle (the **fresnel effect**). Facing a window you see through it; at a grazing angle it turns into a mirror. Heckel adds fresnel as a glow. Here it also weights the reflection between the glass's base reflectance (from the IOR, 4% for 1.5) and 100% at the silhouette. **Mirror** raises that to 100% everywhere. Because reflections add on top of the see-through view by default (as in all twelve presets), Mirror 1 alone gives clear glass under a strong reflection. Turn on **Energy conserving** for a true mirror or liquid metal: the reflected share then no longer also passes through.

From [liquid_glass.frag](liquid_glass.frag), lines 395–474:

```glsl
// Built-in studio: a dark room with soft white light strips. Used when the
// map mode is Studio, or when no reflection TOP is connected.
// (env.frag bakes the same studio into the demo panorama; keep them in sync.)
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

// soft > 0 widens every light edge, which is how the studio blurs.
vec3 studio(vec3 d, float soft)
{
    float az = azimuth(d);
    float el = d.y;
    vec3 c = vec3(0.015) + vec3(0.05) * smoothstep(-0.1, 0.7, el);
    c += vec3(2.2) * band(angleDelta(az, 0.6), 0.0, 0.10, 0.03 + soft) * band(el, 0.15, 0.55, 0.15 + soft);
    c += vec3(1.6, 1.7, 1.9) * band(angleDelta(az, 2.6), 0.0, 0.06, 0.02 + soft) * band(el, 0.0, 0.65, 0.15 + soft);
    c += vec3(1.5, 1.25, 1.0) * band(angleDelta(az, -1.8), 0.0, 0.22, 0.06 + soft) * band(el, 0.3, 0.3, 0.1 + soft);
    c += vec3(1.8) * band(el, 0.93, 0.02, 0.015 + soft);
    c += vec3(0.06) * smoothstep(0.0, 0.7, -el);
    return c;
}

// Equirectangular lookup in this study's convention: u = 0 faces +X, then +Z;
// v = 0 is straight down. env.frag bakes the demo panorama the same way.
// Not yet compared with TouchDesigner's own environment lighting; Panorama
// rotation turns the map if your panorama is offset.
vec2 panoramaUV(vec3 d)
{
    float u = azimuth(d) / (2.0 * LG_PI);
    float v = 0.5 + asin(clamp(d.y, -1.0, 1.0)) / LG_PI;
    return vec2(fract(u), v);
}

vec3 environmentSample(vec3 d, vec2 uv, mat3 view, vec2 orient, float blur)
{
    int mode = int(uEnv.x + 0.5);
    float c = cos(uEnv.y);
    float s = sin(uEnv.y);
    vec3 r = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);  // rotate around +Y
    if (uInputs.y < 0.5 || mode == 2) return studio(r, 0.15 * blur);
    // Mipmap level about as wide as the gap between the 8 blur directions.
    // A flat image moves 2.5 x Flat image warp times further per direction than
    // a panorama, so its level widens by that factor.
    float spread = mode == 1 ? max(1.0, 2.5 * uEnv.w) : 1.0;
    float lod = log2(max(blur * 0.05 * spread * float(textureSize(sReflection, 0).x), 1.0));
    if (mode == 1) {
        vec3 rv = view * d;  // reflection direction as seen by the camera
        return textureLod(sReflection, mirrorUV(uv + rv.xy * orient * uEnv.w * 0.5), lod).rgb;
    }
    return textureLod(sReflection, panoramaUV(r), lod).rgb;
}

// Average a few nearby directions for blurry (rough) reflections.
// orient: the screen orientation (screenSign), for the flat image's offset.
vec3 environment(vec3 R, vec2 uv, mat3 view, vec2 orient)
{
    float blur = uEnv.z;
    if (blur <= 0.001) return environmentSample(R, uv, view, orient, 0.0);
    vec3 t = normalize(cross(abs(R.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), R));
    vec3 b = cross(R, t);
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        float a = float(i) * 2.39996;
        float r = sqrt((float(i) + 0.5) / 8.0) * blur * 0.4;
        sum += environmentSample(normalize(R + (t * cos(a) + b * sin(a)) * r), uv, view, orient, blur);
    }
    return sum / 8.0;
}
```

**Experiment `reflection`:** What does the reflection map contribute on its own?

On the built component, run `component.op('study_tools').module.apply(component, 'reflection')`.

Prediction: Studio strips and the coloured gels of the panorama wrap around the object, strongest toward the silhouette. Iridescence is off, so no film colours are mixed in.

Parameters: Preset=prism_chrome, Pause=True, Time=2.0, Stage=reflection, Iridescence=0.0. Time and unrelated controls are fixed by this preset.

![Experiment reflection: the panorama's light strips and coloured gels wrap around the torus. WebGL preview, not a TouchDesigner capture.](captures/preview-reflection.png)

*Preview (Reflection stage, Iridescence off so the film does not colour it):* thin white strips and faint magenta and blue patches from the panorama's gels curve around the torus, brightest at its edges.

**Experiment `fresnel`:** Where does glass reflect most?

On the built component, run `component.op('study_tools').module.apply(component, 'fresnel')`.

Prediction: Dark in the middle where the surface faces the camera, bright at grazing edges.

Parameters: Preset=prism_chrome, Pause=True, Time=2.0, Stage=fresnel. Time and unrelated controls are fixed by this preset.

![Experiment fresnel: dark where the surface faces the camera, bright at the edges. WebGL preview, not a TouchDesigner capture.](captures/preview-fresnel.png)

*Preview:* black across the face of the torus, white around its outline and hole.

## Highlights and a glowing rim

What makes glass look shiny?

A highlight is the light source reflected in the surface. **Specular** sets how bright it is, **Shininess** how small and sharp. Heckel squares the usual Blinn-Phong term for a tighter, glassier highlight, and that is kept. The **rim** is a coloured glow that follows the fresnel term, as in his article. **Diffuse** adds soft light on the side facing the light.

From [liquid_glass.frag](liquid_glass.frag), lines 478–487:

```glsl
// Heckel-style Blinn-Phong: squaring the half-vector term gives a tight,
// glassy highlight. The rim is a fresnel glow toward the silhouette.
vec3 highlights(vec3 n, vec3 eye, vec3 lightDir, float fresnel)
{
    vec3 h = safeNormalize(lightDir - eye, vec3(0.0));  // light straight behind: no highlight
    float nh = max(dot(n, h), 0.0);
    float spec = pow(nh * nh, uLightColor.w) * uLight.w;
    float diffuse = max(dot(n, lightDir), 0.0) * uSurface.z;
    return paramColour(uLightColor.rgb) * (spec + diffuse) + paramColour(uRim.rgb) * uRim.a * fresnel;
}
```

**Experiment `highlights`:** What do specular and rim add?

On the built component, run `component.op('study_tools').module.apply(component, 'highlights')`.

Prediction: Small, sharp white highlights where the light reflects toward the camera, and a bright glow along the silhouette.

Parameters: Preset=clear_crystal, Pause=True, Time=2.0, Stage=final, Specular=4.0, Shininess=200.0, Rim=1.5. Time and unrelated controls are fixed by this preset.

![Experiment highlights: sharp white highlights and a bright rim. WebGL preview, not a TouchDesigner capture.](captures/preview-highlights.png)

*Preview:* a white glow outlines the torus and small hard highlights sit on its upper curves.

## Make it liquid

How does a solid mesh start to look like liquid?

Liquid surfaces are never perfectly smooth; they ripple. **Wobble** lays a smooth, drifting noise pattern over the object and tilts each normal along the pattern's slope, like ripples on a liquid skin. Because refraction, reflection and highlights all follow the normal, the whole look starts to flow. The silhouette stays the same: this changes shading, not geometry. The noise lives in the object's own space, so the ripples move with the object instead of sliding across it. Their strength doesn't depend on the Geometry COMP's scale either: TouchDesigner's normal matrix divides by that scale, so the slope is multiplied back by it. Their size follows **Object size**, the object's size in the world: the component divides Wobble scale by it before it reaches `uWobble.y`, and `worldScale()` multiplies the lookup by the Geometry COMP's scale. So an object ten times larger gets the same number of ripples, whether it was built larger in its SOP or scaled up by its COMP. (Before the family close the lookup skipped the COMP's scale, which Fit counts, so the ripples on a scaled COMP grew with the scale.)

The noise drifts over time, and the two obvious ways to write that drift both fail. Adding the time in seconds inside the shader fails in long installations: after a week, a 32-bit float only holds time in steps of 1/16 s and the ripples turn grainy. Multiplying the speed by the time fails as soon as the speed changes: the drift then jumps by the change in speed times every second since TouchDesigner started. A review found that after an hour, a single frame of an A/B morph threw the ripples and the film bands across the object. So [presets.py](presets.py) adds the drift up instead. Every frame, each offset in `uPhase` grows by its rate times Wobble speed times the frame's duration. Python does this in double precision and wraps the result to 0..256. The noise lattice repeats every 256 units, so the wrap is invisible, and changing or morphing Wobble speed only changes how fast the ripples move. While **Pause** is on, the offsets come from Fixed time instead, so experiments look the same every time, and unpausing continues from there. With Wobble speed 0 the offsets hold still and the material does not need to update every frame. The demo torus's spin is added up the same way.

From [liquid_glass.frag](liquid_glass.frag), lines 147–208:

```glsl
// Smooth 3D value noise in 0..1, built from an integer lattice hash.
// The lattice repeats every 256 units, so shifting the noise by 256 changes
// nothing: the drift offsets in uPhase can wrap around without a jump.
float latticeHash(ivec3 c)
{
    uvec3 q = uvec3(c & 255);
    uint h = (q.x * 73856093u) ^ (q.y * 19349663u) ^ (q.z * 83492791u);
    h ^= h >> 16; h *= 0x7feb352du;
    h ^= h >> 15; h *= 0x846ca68bu;
    h ^= h >> 16;
    return float(h) * (1.0 / 4294967295.0);
}

float valueNoise(vec3 p)
{
    ivec3 i = ivec3(floor(p));
    vec3 f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float x00 = mix(latticeHash(i),               latticeHash(i + ivec3(1, 0, 0)), u.x);
    float x10 = mix(latticeHash(i + ivec3(0, 1, 0)), latticeHash(i + ivec3(1, 1, 0)), u.x);
    float x01 = mix(latticeHash(i + ivec3(0, 0, 1)), latticeHash(i + ivec3(1, 0, 1)), u.x);
    float x11 = mix(latticeHash(i + ivec3(0, 1, 1)), latticeHash(i + ivec3(1, 1, 1)), u.x);
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

// Two drifting octaves: the "liquid skin" height field on the object.
float liquidField(vec3 p)
{
    return valueNoise(p + vec3(0.0, uPhase.x, 0.0))
         + 0.5 * valueNoise(2.03 * p + vec3(uPhase.y, 0.0, uPhase.z));
}

// The Geometry COMP's scale (its parents' included) as one number: the cube
// root of how much its world transform changes a volume. 1 when unscaled.
float worldScale()
{
    return pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0);
}

// Tilt the normal along the field's slope, like ripples on a liquid.
// Shading only: the silhouette does not change.
vec3 wobbleNormal(vec3 n)
{
    float amount = uWobble.x;
    if (amount <= 0.0) return n;
    // Object size is the object's size in the world, so the ripples are laid
    // out in world-sized steps: a Geometry COMP scale counts, as it does for
    // Thickness and Frost. The pattern still sticks to the object.
    float scale = worldScale();
    vec3 p = vObjPos * uWobble.y * scale;
    const float h = 0.04;
    float f0 = liquidField(p);
    vec3 slope = vec3(liquidField(p + vec3(h, 0.0, 0.0)) - f0,
                      liquidField(p + vec3(0.0, h, 0.0)) - f0,
                      liquidField(p + vec3(0.0, 0.0, h)) - f0) / h;
    // Object space to world space. worldForNormals alone would divide the tilt
    // by the Geometry COMP's scale; multiplying by that scale keeps the same
    // Wobble at any object scale.
    slope = uTDMats[vCamIndex].worldForNormals * slope * scale;
    slope -= dot(slope, n) * n;  // keep only the sideways part
    return normalize(n - amount * 0.35 * slope);
}
```

The rainbow sheen of a soap bubble or an oil slick is **thin-film interference**. Light reflects from both the top and the bottom of a very thin film. Depending on the film's thickness and the viewing angle, some colours reinforce and others cancel. `thinFilm()` computes that for red, green and blue wavelengths. The film thickness swirls over the object (**Film variation**), about 2.5 swirls per Object size (`uFilm.w`), counted in world-sized steps like the ripples, so the colours form moving bands. Set by hand to 0, `uFilm.w` gives one film thickness over the whole object, with no swirl; that one thickness still drifts, and Wobble speed 0 stops it. **Iridescence** sets how strongly the film colours the reflections and adds a sheen.

From [liquid_glass.frag](liquid_glass.frag), lines 212–232:

```glsl
// Thin-film interference, as on a soap bubble or an oil slick. A film of a
// given thickness reflects some wavelengths strongly and cancels others.
vec3 thinFilm(float cosView, float thicknessNm)
{
    const float filmIor = 1.33;
    float sinT2 = (1.0 - cosView * cosView) / (filmIor * filmIor);
    float cosT = sqrt(max(1.0 - sinT2, 0.0));
    float path = 2.0 * filmIor * thicknessNm * cosT;          // optical path difference, nm
    vec3 wavelength = vec3(650.0, 532.0, 450.0);              // red, green, blue, nm
    return 0.5 - 0.5 * cos(2.0 * LG_PI * path / wavelength);  // half-wave shift at the top surface
}

// Film thickness swirls over the object so the colours form bands, about
// 2.5 swirls per object size (uFilm.w), in world-sized steps like the ripples.
// uFilm.w = 0 gives one film thickness over the whole object, which still
// drifts with uPhase.w; Wobble speed 0 stops the drift.
float filmThickness()
{
    float swirl = valueNoise(vObjPos * uFilm.w * worldScale() + vec3(0.0, uPhase.w, 0.0)) * 2.0 - 1.0;
    return uFilm.y * (1.0 + uFilm.z * swirl);
}
```

**Experiment `wobble`:** How does wobble change the surface?

On the built component, run `component.op('study_tools').module.apply(component, 'wobble')`.

Prediction: The normal view shows soft ripples over the whole object while the silhouette stays the same.

Parameters: Preset=aqua_jelly, Pause=True, Time=2.0, Stage=normal, Wobble=0.6. Time and unrelated controls are fixed by this preset.

![Experiment wobble: soft ripples in the normal view, unchanged silhouette. WebGL preview, not a TouchDesigner capture.](captures/preview-wobble.png)

*Preview (Normal stage, which shows normal directions as colours):* soft colour waves cover the torus while its outline stays round.

**Experiment `film`:** What does the oil film look like on its own?

On the built component, run `component.op('study_tools').module.apply(component, 'film')`.

Prediction: Bands of magenta, green and gold that follow the swirl and shift colour toward the edges.

Parameters: Preset=oil_slick, Pause=True, Time=2.0, Stage=film. Time and unrelated controls are fixed by this preset.

![Experiment film: bands of interference colour. WebGL preview, not a TouchDesigner capture.](captures/preview-film.png)

*Preview (Iridescence film stage):* saturated magenta, green and gold bands following the swirl. In the final look this colour is mixed in far more gently.

## Measure thickness with the back-face pass

How can the shader know how thick the object really is?

Until now, Thickness is one number for the whole object. Real objects are thicker in some places than others. The optional **back-face pass** renders the glass a second time, showing only its far side, into `render_back`. That render stores the inner surface's colour, and in its alpha channel how far that surface is along the view ray, as a 32-bit float: 16-bit floats step visibly once the camera is tens of units away. The front surface knows its own distance, so the difference is the real thickness at that pixel. For an orthographic camera the distance is the depth along the parallel rays. `backfaceAt()` reads the pass with a bilinear filter written out by hand that only blends the texels the back faces cover, so the empty background around the object neither darkens the colour nor shortens the distance. This also brings back Heckel's backside trick: the far side is drawn with the same material, so its reflections and fringes are themselves bent by the front surface.

From [liquid_glass.frag](liquid_glass.frag), lines 236–273:

```glsl
// The optional back-face pass stores the inner surface's colour in rgb and its
// distance along the view ray in alpha (0 where no back face was drawn).
// backfaceAt() is a bilinear filter written out by hand that only blends the
// texels the back faces cover. The empty background therefore never darkens
// the colour or pulls the distance toward 0 at the silhouette, and refracted
// inner surfaces stay smooth instead of turning into stair steps.
bool backfaceAt(vec2 uv, out vec4 back)
{
    ivec2 size = textureSize(sBackface, 0);
    vec2 p = uv * vec2(size) - 0.5;
    vec2 f = fract(p);
    ivec2 base = ivec2(floor(p));
    vec4 sum = vec4(0.0);
    float covered = 0.0;
    for (int k = 0; k < 4; k++) {
        ivec2 o = ivec2(k & 1, k >> 1);
        vec4 texel = texelFetch(sBackface, clamp(base + o, ivec2(0), size - 1), 0);
        vec2 w = mix(1.0 - f, f, vec2(o));
        if (texel.a > 0.0) {
            sum += texel * (w.x * w.y);
            covered += w.x * w.y;
        }
    }
    back = covered > 0.0 ? sum / covered : vec4(0.0);
    return covered >= 0.5;  // the edge sits where half the filter is covered
}

// With the back-face pass, thickness is measured instead of guessed: the far
// side's distance minus this surface's distance, along the same view ray.
float glassThickness(vec2 uv, float surfaceDistance, bool useBack)
{
    float thickness = uOptics.y;
    vec4 back = vec4(0.0);
    if (useBack && backfaceAt(uv, back) && back.a > surfaceDistance) {
        thickness = back.a - surfaceDistance;
    }
    return thickness;
}
```

**Experiment `backface`:** What does the back-face pass measure?

On the built component, run `component.op('study_tools').module.apply(component, 'backface')`.

Prediction: Thickness varies across the object, largest through the middle of the tube and thin at its edges, instead of one constant value.

Parameters: Preset=clear_crystal, Pause=True, Time=2.0, Stage=thickness, Backface=True, Thickness=1.0. Time and unrelated controls are fixed by this preset.

![Experiment backface: thickness varies across the tube. WebGL preview, not a TouchDesigner capture.](captures/preview-backface.png)

*Preview (Thickness stage):* brighter across the middle of the tube, darker toward its edges. On a unit sphere, an automated test compares the measured thickness with the exact distance through the sphere along each pixel's ray. At five points, from the centre (2.0 units) to near the edge (0.5 units), they agree within 1/255 (`backface_thickness_matches_chord`). The same holds 50 units from the camera and with an orthographic camera off axis. Over a flat grey scene, clear glass with the pass on stays exactly grey (`backface_pass_adds_no_dark_fringe`).

It is optional because it costs a second render and needs to know your camera and glass objects (**Inputs** page). It only renders while the toggle is on.

## Twelve looks and a morph

How do presets and morphing reach the shader?

The shader only sees fourteen sets of four numbers (**uniforms**). It doesn't know about presets. Each parameter on the component feeds one of those numbers through an expression on the GLSL MAT's Vectors page.

From [liquid_glass.frag](liquid_glass.frag), lines 16–38:

```glsl
uniform sampler2D sRefraction;
uniform sampler2D sReflection;
uniform sampler2D sBackface;

// Lengths are in scene units: the component multiplies Thickness and Frost by
// Object size and divides Tint density and the pattern frequencies by it.
// Object size is the object's size in the world (Fit to Glass geometry counts
// the Geometry COMP's scale), so the shader multiplies the pattern frequencies
// by that scale (worldScale()).
uniform vec4 uGlass;      // rgb glass colour, a tint density (per scene unit)
uniform vec4 uBody;       // translucency, frost (scene units), opacity, edge tint
uniform vec4 uOptics;     // ior, thickness (scene units), dispersion, saturation
uniform vec4 uReflect;    // rgb reflection tint, a reflection amount
uniform vec4 uEnv;        // map mode (0 panorama, 1 screen, 2 studio), rotation (radians), blur, screen warp
uniform vec4 uSurface;    // mirror, fresnel power, diffuse, energy conserving (0 or 1)
uniform vec4 uRim;        // rgb rim colour, a rim amount
uniform vec4 uLight;      // xyz direction toward the light, w specular amount
uniform vec4 uLightColor; // rgb light colour, w shininess
uniform vec4 uFilm;       // iridescence, film thickness (nm), film variation, film swirl frequency (2.5 / object size; 0 = one thickness, no swirl)
uniform vec4 uWobble;     // amount, scale (ripples per scene unit, laid out on the object), speed, unused
uniform vec4 uPhase;      // noise drift: 0.6, 0.4, -0.3, 0.15 x speed, added up every frame, wrapped to 0..256
uniform vec4 uState;      // debug stage, pass (0 front, 1 back), samples, flip V
uniform vec4 uInputs;     // has refraction TOP, has reflection TOP, use back-face TOP, colours are sRGB (1) or as typed (0)
```

Choosing a **Preset** runs a small script ([preset_exec.py](preset_exec.py)). It copies that look's values from [presets.json](presets.json) into the parameters, so you can keep adjusting from there. Presets leave the light direction, panorama rotation, inputs and quality settings alone. **Morph** works one step later: each look-related uniform expression calls `u()` in [presets.py](presets.py). It returns the parameter's value blended toward the same value in the **Morph target** preset. At Morph 0 you get your sliders, at 1 the target, and anything in between can be animated. Wobble speed is morphed too, and because the drift is added up frame by frame (see *Make it liquid*), an animated morph changes how fast the ripples move, never where they are. From a script, load a look with `component.op('presets').module.apply(component, 'violet_gel')`, then set any overrides: that writes the values at once, while changing the menu goes through the callback.

**Experiment `morph`:** What lies halfway between two presets?

On the built component, run `component.op('study_tools').module.apply(component, 'morph')`.

Prediction: A lightly violet, partly dispersive glass: every preset value sits halfway between Prism Chrome and Violet Gel.

Parameters: Preset=prism_chrome, Pause=True, Time=2.0, Stage=final, Morphtarget=violet_gel, Morph=0.5. Time and unrelated controls are fixed by this preset.

![Experiment morph: halfway between Prism Chrome and Violet Gel. WebGL preview, not a TouchDesigner capture.](captures/preview-morph.png)

*Preview:* a faintly violet glass with softer fringes than Prism Chrome. Unit tests check the morph maths in `presets.py`; preview tests check that the shader, given those values, renders exactly the target preset at Morph 1 and changes nothing at Morph 0. Another preview test plays one frame of a 100-frame morph after an hour of running: it changes the image no more than the same frame after two seconds (`morph_frame_is_smooth_after_an_hour`).

**Experiment `final`:** What does the default look produce?

On the built component, run `component.op('study_tools').module.apply(component, 'final')`.

Prediction: Clear glass with rainbow fringes, an oil-film sheen, bright rims and studio reflections.

Parameters: Preset=prism_chrome, Pause=True, Time=2.0, Stage=final. Time and unrelated controls are fixed by this preset.

![The twelve presets on a knot. WebGL preview, not a TouchDesigner capture.](captures/presets-sheet.png)

*Preview of all twelve presets on a knot shape (the knot exists only in the preview; the TouchDesigner demo uses a torus).*

## Use it in your own scene

The [README](README.md) has the full steps. In short: render your scene without the glass and use it as the Refraction TOP; its background may be transparent. Give the Reflection TOP a panorama or an image. Then add a Render Pass TOP after the scene render: it draws only the glass objects, with Override Material set to the component's `material`, on top of the scene's colour and depth. Objects in front of the glass then still cover it. A preview test puts an opaque ball in front of the glass to check this route; TouchDesigner's own Render Pass TOP is still to be checked. (The demo inside the component lays the glass over a flat backdrop with an Over TOP instead; that only works when nothing stands in front of the glass.) Turn Dither off on both renders, so nothing adds dithering noise to the continuous glass.

Your object is probably not the size of the demo torus. Thickness, Frost and Tint density are lengths, and so are the ripple and film patterns, so a preset tuned on the demo torus would bend ten times too little on an object ten times larger. Point **Inputs > Glass geometry** at your objects and press **Fit to Glass geometry**: it measures them against the demo torus and sets **Object size** (the torus itself measures 1), and the component converts every length by it. Object size is a size in the world, so it does not matter whether you sized your object in its SOP or with its Geometry COMP's Scale. Presets and experiments never touch Object size, and at 1 nothing changes.

The glass can only show what your scene puts behind it. The demo has a second backdrop for exactly this reason: **Study > Demo backdrop** switches the checkerboard for heavy white type on black, the backdrop of the sibling study Liquid Glass Prism, so looks from the two studies can be compared on the same scene.

**Experiment `type_backdrop`:** The glass only shows what is behind it: how does the same preset read over a different scene?

On the built component, run `component.op('study_tools').module.apply(component, 'type_backdrop')`.

Prediction: Over heavy white type on black, the bent, upside-down letters and their rainbow edges dominate the glass, and the clear parts turn dark, because there is little light behind them. The material is the same as over the checkerboard.

Parameters: Preset=prism_chrome, Pause=True, Time=2.0, Stage=final, Backdrop=type. Time and unrelated controls are fixed by this preset.

![Experiment type_backdrop: Prism Chrome over bold white type on black. WebGL preview, not a TouchDesigner capture.](captures/preview-type_backdrop.png)

*Preview:* the same Prism Chrome glass now shows bent, upside-down white letters with coloured edges, and its clear parts read dark. All twelve presets over this backdrop are in [the second contact sheet](captures/presets-sheet-type.png).

The material also fits into larger TouchDesigner setups. The vertex shader's `main()` is ready for Render Pick DAT and CHOP passes. It places the point first, which every render needs. Then it follows the form printed on Derivative's *Write a GLSL MAT* page: for a pick render TouchDesigner defines `TD_PICKING_ACTIVE`, so of the branch only the `#else` block runs, where `TDWritePickingValues()` writes what the pick reads. An ordinary render runs the other block and calls `passToPixelStage()`. In a render with several colour buffers, the glass writes zeros into the extra ones (`fragColor[1]` and up), which leaves them as they were.

From [liquid_glass.vert](liquid_glass.vert), lines 30–41:

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

## Limits

- **Only what the camera sees can be refracted.** The glass can't show things outside the frame or hidden behind other objects; mirror-repeat hides the frame edge but invents nothing. Glass behind other glass is not seen through the nearer glass, and an object in front of the glass also shows up, refracted, inside it, because both come from the same scene render.
- **The bend is an approximation.** Light is bent once, at the front surface, and slid sideways by Thickness. Exit refraction, multiple internal bounces and total internal reflection are not modelled. The back-face pass improves thickness, not the light path.
- **Wobble changes shading only.** For a real liquid silhouette, deform the geometry (the plugin's *Resonant Foil* example shows how, with matching normals).
- **Partly transparent scenes.** Where the Refraction TOP is only partly covered (alpha between 0 and 1, as on antialiased edges), that part of the scene is counted twice behind the glass, so it looks slightly brighter and more opaque there. With the back-face pass on, `covered` is read where the view first bends, while the inner surface's colour comes from a second bend; at the edge of a scene object over a transparent background the two can disagree slightly (not measured).
- **Fog is approximate.** The bent scene was fogged in its own render and gets the glass's fog on top. Not yet checked natively.
- **Object size averages a non-uniform scale.** Fit and the ripple and film lookups use the cube root of how much the Geometry COMP's transform changes a volume, so a COMP stretched along one axis counts as its average size.
- **One Object size per component.** Fit measures when you press it and takes the largest object. A smaller object, a Geometry COMP whose Scale changes after Fit, and an instance with its own scale all keep that one Object size. At a fifth of the size the glass bends and tints as if it were five times larger; scaled up three times without a new Fit, as if it were three times smaller. On an instance the ripples and film bands grow with it, but their tilt ignores its rotation. The README lists the workarounds; a change that would let all three follow is recorded in [decisions.json](decisions.json) and waits for the user's decision.
- **Colour management is partial.** With Colour parameters on *Auto*, colours are converted from sRGB to linear in a linear working colour space; wide-gamut primaries (ACEScg, P3, Rec.2020) are not converted, so colours there look slightly more saturated. Not yet checked natively.
- **Opacity below 1, or no Refraction TOP:** the glass writes depth, so parts of one self-overlapping object can hide each other depending on triangle order. Use the render's Order Independent Transparency for those cases.
- **Instanced geometry:** position and normals go through `TDDeform`, so instances should work (not yet checked natively); see the previous point for their size.
- **Cost** grows with Samples (dispersion and frost), Reflection blur (8 extra lookups) and the back-face pass (a second render, plus 4 texel reads per sample).
- **Antialiased edges near the centre lines.** With antialiasing, a few silhouette pixels near the render's centre row or column still bend the wrong way: each is shaded at its centre, outside its own triangle, and its point projects to the other side of the centre line. In the preview they change at most 6 pixels in twelve frames, by up to 43/255. Whether that shows in TouchDesigner is an open family question, with a native check pending. A centroid-sampled position removed most of them in the usual raster in the Liquid Glass Lit study's preview, but no TouchDesigner build has run one.
- **Not yet run in TouchDesigner.** The shaders compile as GLSL 4.60 against stand-ins for TouchDesigner's built-ins (also with picking active and with three colour buffers), and the preview passes its tests. Native compile, render, the preset callback, the Render Pass TOP workflow and its occlusion, picking, extra colour buffers, fog, the screen orientation, Fit to Glass geometry and export are still to be checked on a real host; see [validation.json](validation.json).

## Credits

Screen-space refraction through a render of the scene, multi-sample dispersion, saturation, the squared Blinn-Phong specular, fresnel glow and back-face rendering come from Maxime Heckel, [Refraction, dispersion, and other shader light effects](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/). His article credits the sampling technique to the open-source Junni site by @ore_ukonpower, and the colour-channel split to research by Ravishankar Sundararaman. The frost disc uses Martin Roberts' R2 quasirandom sequence. The Refraction TOP's alpha and the fog handling come from the Liquid Glass Blobs study, the measured screen orientation and the type backdrop from Liquid Glass Prism, picking and extra colour buffers from Liquid Glass Flow, Lit and Prism, Dither off and the output cap from Liquid Glass Lit, and Fit to Glass geometry from Liquid Glass Flow. The TouchDesigner implementation is newly written; [sources.json](sources.json) lists each idea's source lines and how it was adapted. TouchDesigner API details follow Derivative's documentation (Write a GLSL MAT, GLSL MAT, Render TOP).
