// Liquid Glass: GLSL MAT pixel shader for TouchDesigner (GLSL 4.60).
//
// An original material for any 3D object. The refraction, dispersion,
// saturation, specular, fresnel and back-face ideas follow Maxime Heckel,
// "Refraction, dispersion, and other shader light effects" (2023),
// https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/
// What was adapted and what is new is listed in sources.json.
//
// Inputs (GLSL MAT > Samplers page):
//   sRefraction  the scene behind the glass, rendered from the same camera
//                (premultiplied alpha; transparent where the scene is empty)
//   sReflection  a 360 panorama or any flat image to reflect
//   sBackface    optional back-face pass (rgb colour, alpha = distance along the view ray)

// @begin uniforms
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
// @end uniforms

in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vObjPos;
flat in int vCamIndex;

// TouchDesigner sets TD_NUM_COLOR_BUFFERS to the render's number of colour
// buffers (Render TOP > # of Color Buffers); the fallback covers a compile
// without it. The glass goes to buffer 0; see the end of main().
#ifndef TD_NUM_COLOR_BUFFERS
#define TD_NUM_COLOR_BUFFERS 1
#endif
layout(location = 0) out vec4 fragColor[TD_NUM_COLOR_BUFFERS];

const float LG_PI = 3.14159265;

// @begin screen
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
// @end screen

// @begin surface
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
// @end surface

// @begin liquid
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
// @end liquid

// @begin film
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
// @end film

// @begin backface
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
// @end backface

// @begin bend
// Refract the view ray at the surface and measure how far it moves sideways
// (in camera space) after crossing `thickness` scene units of glass.
vec2 bendOffset(vec3 eye, vec3 n, float ior, float thickness, mat3 view, vec2 toUV)
{
    vec3 refracted = refract(eye, n, 1.0 / ior);
    if (dot(refracted, refracted) < 0.5) refracted = eye;  // total internal reflection guard
    vec3 sideways = view * (refracted - eye);
    return sideways.xy * thickness * toUV;
}
// @end bend

// @begin dispersion
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
// @end dispersion

// @begin body
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
// @end body

// @begin reflection
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
// @end reflection

// @begin light
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
// @end light

void main()
{
    // @begin setup
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
    // @end setup

    // @begin compose
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
    // @end compose

    // @begin stages
    int stage = int(uState.x + 0.5);
    if (stage > 0) {
        if (stage == 1) colour = n * 0.5 + 0.5;
        else if (stage == 2) colour = through;
        else if (stage == 3) colour = mix(body, through * tint, translucency);
        else if (stage == 4) colour = reflection;
        else if (stage == 5) colour = vec3(fresnel);
        else if (stage == 6) colour = vec3(thickness / max(2.0 * uOptics.y, 1e-3));
        else if (stage == 7) colour = film;
        else colour = vec3(uv, 0.0);
        if (!backPass) alpha = 1.0;
    }
    // A tiny, very bright highlight (or a huge colour value) can exceed what a
    // 16-bit float render stores (65504) and turn into infinity. 1024 is far
    // above anything a display shows. Colour only: the back-face pass keeps
    // its distance in alpha.
    colour = min(colour, vec3(1024.0));
    fragColor[0] = TDOutputSwizzle(vec4(colour, alpha));
    // @end stages

    // @begin buffers
    // A render with extra colour buffers (normals, IDs, ...) gets zeros from the
    // glass: with the material's premultiplied blending, zeros leave what is
    // already there. Each index is a constant, as some GPU backends require,
    // and none goes past the buffer count (writing past it can corrupt output).
#if TD_NUM_COLOR_BUFFERS > 1
    fragColor[1] = vec4(0.0);
#endif
#if TD_NUM_COLOR_BUFFERS > 2
    fragColor[2] = vec4(0.0);
#endif
#if TD_NUM_COLOR_BUFFERS > 3
    fragColor[3] = vec4(0.0);
#endif
#if TD_NUM_COLOR_BUFFERS > 4
    fragColor[4] = vec4(0.0);
#endif
#if TD_NUM_COLOR_BUFFERS > 5
    fragColor[5] = vec4(0.0);
#endif
#if TD_NUM_COLOR_BUFFERS > 6
    fragColor[6] = vec4(0.0);
#endif
#if TD_NUM_COLOR_BUFFERS > 7
    fragColor[7] = vec4(0.0);
#endif
    // @end buffers
}
