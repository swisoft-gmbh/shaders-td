// Liquid Glass Prism: GLSL MAT pixel shader for TouchDesigner (GLSL 4.60).
//
// The physically richer member of the Liquid Glass family. Light is bent
// twice, where it enters the glass and where it leaves, and every slice of
// the spectrum is bent with its own index of refraction at both surfaces.
// At the far surface light can be trapped (total internal reflection) and
// is then looked up once more after one bounce inside. An optional glow
// imitates light focused by the glass.
//
// Ideas from Maxime Heckel, "Refraction, dispersion, and other shader light
// effects" (2023) and "Shining a light on Caustics with Shaders and React
// Three Fiber" (2024), plus the two-surface image-space refraction those
// articles point to (Codrops 2019; Wyman 2005). The look controls, liquid
// ripples, thin film and reflections are the core Liquid Glass study's
// (commit a6f95c6). What was adapted and what is new is in sources.json.
//
// Inputs (GLSL MAT > Samplers page):
//   sRefraction  the scene behind the glass, rendered from the same camera
//   sReflection  a 360 panorama or any flat image to reflect
//   sBackface    optional back-face pass: rgb = outward normal of the far
//                side (world space), a = minus its eye distance (glass is
//                a < 0; 0 or more = no glass)

// @begin uniforms
uniform sampler2D sRefraction;
uniform sampler2D sReflection;
uniform sampler2D sBackface;

uniform vec4 uGlass;      // rgb glass colour, a tint density
uniform vec4 uBody;       // translucency, frost, opacity, edge tint
uniform vec4 uOptics;     // ior, thickness (scene units), dispersion, saturation
uniform vec4 uReflect;    // rgb reflection tint, a reflection amount
uniform vec4 uEnv;        // map mode (0 panorama, 1 screen, 2 studio), rotation (radians), blur, screen warp
uniform vec4 uSurface;    // mirror, fresnel power, diffuse, unused
uniform vec4 uRim;        // rgb rim colour, a rim amount
uniform vec4 uLight;      // xyz direction toward the light, w specular amount
uniform vec4 uLightColor; // rgb light colour, w shininess
uniform vec4 uFilm;       // iridescence, film thickness (nm), film variation, unused
uniform vec4 uWobble;     // amount, scale, speed, time (seconds)
uniform vec4 uState;      // debug stage, pass (0 front, 1 back), samples, flip V
uniform vec4 uInputs;     // has refraction TOP, has reflection TOP, use back-face TOP, unused
uniform vec4 uPrism;      // scene depth (scene units), exit tilt, inner reflection, unused
uniform vec4 uCaustic;    // caustic glow, caustic spread, unused, unused
// @end uniforms

in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vObjPos;
flat in int vCamIndex;

layout(location = 0) out vec4 fragColor;

const float LG_PI = 3.14159265;

// @begin screen
// The camera, gathered once per pixel.
struct PrismCamera {
    vec3 position;
    vec3 forward;    // viewing axis, world space
    mat4 viewProj;   // world space to clip space
    bool perspective;
    vec2 screenSign; // +1 or -1: does screen UV run the same way as projected x and y?
};

// Where this pixel sits on the render, 0..1 across and up.
// uTDGeneral.viewport holds (x, y, 1/width, 1/height) in pixels.
vec2 screenUV()
{
    vec2 uv = (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw;
    if (uState.w > 0.5) uv.y = 1.0 - uv.y;  // Flip V: escape hatch if the Refraction TOP is upside down
    return uv;
}

// Fold coordinates that leave the image back inside it (mirror repeat).
vec2 mirrorUV(vec2 uv)
{
    return 1.0 - abs(1.0 - mod(uv, 2.0));
}

// How far a point is from the camera: straight-line distance for a
// perspective camera, depth along the view axis for an orthographic one.
// The back-face pass stores the same measure, so the two can be subtracted.
float eyeDistance(vec3 p, PrismCamera cam)
{
    return cam.perspective ? length(p - cam.position) : dot(p - cam.position, cam.forward);
}

// How far point p lands from point `from` on screen, in 0..1 units.
// Working with offsets keeps "no bend" exact: two points on the same
// camera ray land on the same spot. screenSign turns projected directions
// into screen UV directions (see main()), so a build whose screen y runs
// the other way still bends the right way.
// A point near or behind the camera would project to a huge or mirrored
// offset, so p is first pulled back along the line toward `from` until it
// is at least half as far from the camera as `from` (perspective only;
// an unchanged result whenever p is already that far).
vec2 projectOffset(vec3 p, vec3 from, PrismCamera cam)
{
    vec4 a = cam.viewProj * vec4(p, 1.0);
    vec4 b = cam.viewProj * vec4(from, 1.0);
    b.w = max(b.w, 1e-4);
    float nearest = 0.5 * b.w;
    if (a.w < nearest) a = mix(b, a, (b.w - nearest) / (b.w - a.w));
    return 0.5 * (a.xy / a.w - b.xy / b.w) * cam.screenSign;
}

// The mip level for one lookup: at least `base`, and wide enough to cover
// the patch of the Refraction TOP that this pixel's lookup sweeps across
// (screen derivatives of the unfolded coordinate). Where the glass squeezes
// a large part of the scene into a few pixels, neighbouring pixels then
// read a smooth average instead of unrelated texels. Call it only where
// every pixel runs the same code (derivatives need that).
float footprintLod(vec2 unfolded, float base, vec2 size)
{
    vec2 dx = dFdx(unfolded) * size;
    vec2 dy = dFdy(unfolded) * size;
    return max(base, 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1.0)));
}

// How far one scene unit moves on screen at this pixel's depth (for blur sizes).
vec2 unitsToUV(mat4 proj, float depth)
{
    float perspective = abs(proj[2][3]) > 0.5 ? depth : 1.0;
    return 0.5 * abs(vec2(proj[0][0], proj[1][1])) / perspective;
}
// @end screen

// @begin surface
// The near side: the interpolated normal, or the faceted normal (from
// screen derivatives, computed at the top of main()) when the geometry
// carries no normals. Always faces the camera.
vec3 facingNormal(vec3 eye, vec3 faceted)
{
    vec3 n = vWorldNormal;
    if (dot(n, n) < 1e-8) {
        n = dot(faceted, faceted) < 1e-12 ? -eye : normalize(faceted);
        return dot(n, eye) > 0.0 ? -n : n;
    }
    n = normalize(n);
    n = TDFrontFacing(vWorldPos, n) ? n : -n;
    // Near silhouettes an interpolated normal can tilt slightly away from the
    // camera; lay it back into the view plane so refraction stays continuous.
    float away = dot(n, eye);
    if (away > -0.01) n = normalize(n - eye * (away + 0.01));
    return n;
}
// @end surface

// @begin backnormal
// The far side, drawn by the back-face pass: its normal points out of the
// glass, which for a back face means away from the camera.
vec3 outwardBackNormal(vec3 eye, vec3 faceted)
{
    vec3 n = vWorldNormal;
    if (dot(n, n) < 1e-8) {
        n = dot(faceted, faceted) < 1e-12 ? eye : normalize(faceted);
    } else {
        n = normalize(n);
    }
    if (dot(n, eye) < 0.0) n = -n;
    float toward = dot(n, eye);
    if (toward < 0.01) n = normalize(n + eye * (0.01 - toward));
    return n;
}
// @end backnormal

// @begin liquid
// Smooth 3D value noise in 0..1, built from an integer lattice hash.
float latticeHash(ivec3 c)
{
    uint h = (uint(c.x) * 73856093u) ^ (uint(c.y) * 19349663u) ^ (uint(c.z) * 83492791u);
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
float liquidField(vec3 p, float t)
{
    return valueNoise(p + vec3(0.0, 0.6 * t, 0.0))
         + 0.5 * valueNoise(2.03 * p + vec3(0.4 * t, 0.0, -0.3 * t));
}

// Tilt a normal along the field's slope, like ripples on a liquid.
// Shading only: the silhouette does not change. Used on both sides.
vec3 wobbleNormal(vec3 n)
{
    float amount = uWobble.x;
    if (amount <= 0.0) return n;
    float t = uWobble.w * uWobble.z;
    vec3 p = vObjPos * uWobble.y;
    const float h = 0.04;
    float f0 = liquidField(p, t);
    vec3 slope = vec3(liquidField(p + vec3(h, 0.0, 0.0), t) - f0,
                      liquidField(p + vec3(0.0, h, 0.0), t) - f0,
                      liquidField(p + vec3(0.0, 0.0, h), t) - f0) / h;
    slope = uTDMats[vCamIndex].worldForNormals * slope;  // object space to world space
    slope -= dot(slope, n) * n;                          // keep only the sideways part
    return normalize(n - amount * 0.35 * slope);
}
// @end liquid

// @begin film
// Thin-film interference, as on a soap bubble or an oil slick.
vec3 thinFilm(float cosView, float thicknessNm)
{
    const float filmIor = 1.33;
    float sinT2 = (1.0 - cosView * cosView) / (filmIor * filmIor);
    float cosT = sqrt(max(1.0 - sinT2, 0.0));
    float path = 2.0 * filmIor * thicknessNm * cosT;          // optical path difference, nm
    vec3 wavelength = vec3(650.0, 532.0, 450.0);              // red, green, blue, nm
    return 0.5 - 0.5 * cos(2.0 * LG_PI * path / wavelength);  // half-wave shift at the top surface
}

// Film thickness swirls over the object so the colours form bands.
float filmThickness()
{
    float t = uWobble.w * uWobble.z;
    float swirl = valueNoise(vObjPos * 2.5 + vec3(0.0, 0.15 * t, 0.0)) * 2.0 - 1.0;
    return uFilm.y * (1.0 + uFilm.z * swirl);
}
// @end film

// @begin spectrum
// Index of refraction for one slice of the spectrum, from w = 0 (red,
// 680 nm) to w = 1 (violet, 400 nm). Cauchy's law, n = A + B / wavelength^2,
// spaces the slices like real glass: violet bends most, and the blue-violet
// end spreads more than the red end. The 530 nm wavelength (w = MIDDLE_W)
// keeps the Ior value; Dispersion 1 spreads red to violet over 0.3.
const float MIDDLE_W = 150.0 / 280.0;  // 530 nm on the 680..400 nm scale

float sliceIor(float w)
{
    float nm = mix(680.0, 400.0, w);
    const float red = 1.0 / (680.0 * 680.0);
    const float mid = 1.0 / (530.0 * 530.0);
    const float violet = 1.0 / (400.0 * 400.0);
    float curve = (1.0 / (nm * nm) - mid) / (violet - red);  // -0.34 (red) .. 0.66 (violet)
    return max(uOptics.x + 0.3 * uOptics.z * curve, 1.0);
}

// Weight of one slice in R, G and B: w = 0 is red, w = 1 is violet.
vec3 spectrum(float w)
{
    vec3 c = clamp(1.0 - abs(w - vec3(0.1, 0.45, 0.8)) * vec3(2.4, 2.8, 2.4), 0.0, 1.0);
    c.r += 0.6 * clamp(1.0 - abs(w - 1.0) * 5.0, 0.0, 1.0);  // violet also excites red
    return c * c * (3.0 - 2.0 * c) + 0.02;
}

vec3 saturateColour(vec3 c, float amount)
{
    float luma = dot(c, vec3(0.2125, 0.7154, 0.0721));
    return max(mix(vec3(luma), c, amount), 0.0);
}
// @end spectrum

// @begin interfaces
// Entering glass from air: GLSL's refract() with the ratio 1 / n. Light
// coming from air can always enter, so there is no special case here.
vec3 enterGlass(vec3 eye, vec3 n, float ior)
{
    return refract(eye, n, 1.0 / ior);
}

// Leaving glass into air through a surface whose normal points out of the
// glass. Returns the outgoing direction in xyz and, in w, the share of light
// the surface reflects back inside (Fresnel equations, unpolarised light).
// Past the critical angle sin(angle) > 1 / n nothing gets out: the share is
// 1, total internal reflection. The share climbs smoothly to 1 as the angle
// nears the critical angle, so the image never jumps.
vec4 leaveGlass(vec3 inside, vec3 outward, float ior)
{
    float cosI = clamp(dot(inside, outward), 0.0, 1.0);
    float sin2T = ior * ior * (1.0 - cosI * cosI);
    if (sin2T > 1.0) return vec4(inside, 1.0);       // trapped: total internal reflection
    float cosT = sqrt(1.0 - sin2T);
    vec3 leaving = ior * inside + (cosT - ior * cosI) * outward;  // Snell's law, vector form
    float rs = (ior * cosI - cosT) / max(ior * cosI + cosT, 1e-6);
    float rp = (cosI - ior * cosT) / max(cosI + ior * cosT, 1e-6);
    return vec4(normalize(leaving), 0.5 * (rs * rs + rp * rp));
}
// @end interfaces

// @begin exit
// Where the bent ray reaches the far side of the glass, and that side's normal.
struct PrismExit {
    vec3 point;     // world space
    vec3 normal;    // points out of the glass
    float path;     // distance travelled inside the glass (scene units)
    float measured; // 1 = from the back-face pass, 0 = estimated
    vec3 ray;       // the traced (530 nm) ray inside the glass
};

// Without the back-face pass. Locally the glass is treated as a ball whose
// near side matches this pixel and whose diameter is Thickness. A ray that
// enters a ball at refraction angle a travels Thickness x cos(a) and leaves
// where the ball's normal is n + 2 cos(a) x ray. In a ball the exit angle
// always equals the entry angle, so a ball never traps light, at any
// wavelength (each slice gets its own exit normal; see sliceExitNormal()).
// Exit tilt bends the guess both ways: toward 1 it blends toward the near
// normal mirrored through the view direction, a steeper far wall as in
// flattened or twisted shapes, so rims can trap light; toward -1 it blends
// toward a far wall parallel to the near one, a flat sheet of thickness
// Thickness that shifts but does not turn the view (windows, ribbons, open
// surfaces). A sheet's path grows as the ray tilts (Thickness / cos(a));
// a ball's shrinks (Thickness x cos(a)).
PrismExit estimateExit(vec3 p, vec3 n, vec3 eye, vec3 ray)
{
    float cosA = max(-dot(ray, n), 0.0);
    float tilt = clamp(uPrism.y, -1.0, 1.0);
    PrismExit e;
    e.path = uOptics.y * mix(cosA, 1.0 / max(cosA, 0.2), max(-tilt, 0.0));
    e.point = p + ray * e.path;
    vec3 ball = n + 2.0 * cosA * ray;
    vec3 mirrored = n - 2.0 * dot(n, eye) * eye;
    vec3 blend = tilt >= 0.0 ? mix(ball, mirrored, tilt) : mix(ball, -n, -tilt);
    e.normal = dot(blend, blend) > 1e-6 ? normalize(blend) : ball;
    e.measured = 0.0;
    e.ray = ray;
    return e;
}
// @end exit

// @begin backpass
// Read the back-face pass with bilinear weights, skipping empty texels, so
// silhouettes never mix in garbage. The pass stores minus the eye distance
// in alpha: glass is alpha < 0, and any background (0, or whatever
// non-negative alpha a camera's background colour adds) reads as empty.
// Returns the outward normal in xyz and the eye distance in w; `coverage`
// is how much real data was found (0..1).
vec4 backSample(vec2 uv, out float coverage)
{
    ivec2 size = textureSize(sBackface, 0);
    vec2 texel = uv * vec2(size) - 0.5;
    ivec2 base = ivec2(floor(texel));
    vec2 f = texel - vec2(base);
    vec4 sum = vec4(0.0);
    float weightSum = 0.0;
    for (int i = 0; i < 4; i++) {
        ivec2 corner = ivec2(i - 2 * (i / 2), i / 2);
        vec4 b = texelFetch(sBackface, clamp(base + corner, ivec2(0), size - 1), 0);
        vec2 g = mix(1.0 - f, f, vec2(corner));
        if (b.a < 0.0) {
            sum += vec4(b.xyz, -b.a) * (g.x * g.y);
            weightSum += g.x * g.y;
        }
    }
    coverage = weightSum;
    if (weightSum < 1e-4) return vec4(0.0);
    sum /= weightSum;
    float len = length(sum.xyz);
    return vec4(len > 1e-4 ? sum.xyz / len : vec3(0.0, 0.0, -1.0), sum.w);
}

// With the back-face pass. First guess: the longer of the glass's
// thickness along the view ray (which shrinks to 0 at the silhouette) and
// the ball guess's path. Then up to four times: see where the guess lands
// on screen, read the far side's distance there, and move the guess onto
// it. It stops early once a step is tiny.
PrismExit measureExit(vec3 p, vec3 ray, vec2 uv, PrismCamera cam, float frontDistance, PrismExit fallback)
{
    float coverage;
    vec4 back = backSample(uv, coverage);
    if (coverage < 0.5 || back.w <= frontDistance) return fallback;
    float viewThickness = back.w - frontDistance;
    float limit = 4.0 * viewThickness + uOptics.y;
    float t = min(max(viewThickness, fallback.path), limit);
    for (int i = 0; i < 4; i++) {
        vec3 q = p + ray * t;
        float c;
        vec4 s = backSample(uv + projectOffset(q, p, cam), c);
        if (c < 0.5) break;
        vec3 along = cam.perspective ? normalize(q - cam.position) : cam.forward;
        float rate = max(dot(ray, along), 0.2);  // how fast the eye distance grows along the ray
        float next = clamp(t + (s.w - eyeDistance(q, cam)) / rate, 0.0, limit);
        float moved = abs(next - t);
        t = next;
        if (moved < 1e-4 * (1.0 + t)) break;
    }
    float c;
    vec4 s = backSample(uv + projectOffset(p + ray * t, p, cam), c);
    PrismExit e;
    e.path = t;
    e.point = p + ray * t;
    e.normal = c >= 0.5 ? s.xyz : back.xyz;
    e.measured = 1.0;
    e.ray = ray;
    return e;
}
// @end backpass

// @begin sliceexit
// Each slice of the spectrum enters at its own angle, so it reaches the far
// side at its own point, where the far side may face another way. Sharing
// the traced ray's exit normal would let a violet slice meet the far side
// more steeply than its own path does, and be trapped where no light is
// (a ball, for example). Ball guess: the closed form for this slice's ray.
// Back-face pass: read the far side again where this slice's ray reaches
// it, with the path scaled as in a ball (exact for a ball; a flat far side
// has one normal everywhere, so there the scale does not matter). Without
// dispersion every slice is the traced ray.
vec3 sliceExitNormal(vec3 inside, vec3 n, vec3 eye, vec2 uv, PrismExit exit, PrismCamera cam)
{
    if (uOptics.z <= 0.0) return exit.normal;
    if (exit.measured < 0.5) return estimateExit(vWorldPos, n, eye, inside).normal;
    float scale = clamp(max(-dot(inside, n), 0.0) / max(-dot(exit.ray, n), 1e-3), 0.5, 2.0);
    float c;
    vec4 s = backSample(uv + projectOffset(vWorldPos + inside * exit.path * scale, vWorldPos, cam), c);
    return c >= 0.5 ? s.xyz : exit.normal;
}
// @end sliceexit

// @begin caustic
// Light focused by the glass. Heckel's caustics compare the area a bundle
// of light rays covers before and after refraction: a smaller area means
// brighter light. For a ball lens that ratio has a closed form. Parallel
// light focuses f = n R / (2 (n - 1)) from the centre, so on the far wall
// the bundle shrinks to an angle of |2 - n| / n around the point facing
// away from the light. The glow is a soft spot of that size, as bright as
// the area shrank (1 at IOR 1.5, brighter toward IOR 2). Violet focuses
// sooner than red, so the spot has coloured edges. The spot never shrinks
// below 0.1 radians: real objects are not perfect balls, and a pin-point
// spot would vanish between their normals. Caustic spread widens the spot
// without dimming it (an artistic control; 1 is the ball-lens size).
vec3 causticGlow(vec3 exitNormal, vec3 lightDir, float ior)
{
    float radius = max(abs(2.0 - ior) / ior, 0.1);
    float concentration = min((1.0 / 9.0) / (radius * radius), 4.0);
    float angle = acos(clamp(dot(exitNormal, -lightDir), -1.0, 1.0)) / (radius * uCaustic.y);
    return uLightColor.rgb * uCaustic.x * concentration * exp(-angle * angle);
}
// @end caustic

// @begin body
// Light that crossed the glass loses the colours the glass absorbs
// (Beer-Lambert): a longer path through tinted glass gives a deeper tint.
vec3 absorption(float path)
{
    return exp(-(1.0 - uGlass.rgb) * uGlass.a * path);
}

// The glass's own colour where it scatters light instead of passing it.
vec3 bodyColour(vec3 n, vec3 lightDir)
{
    float wrap = clamp((dot(n, lightDir) + 0.5) / 1.5, 0.0, 1.0);
    return uGlass.rgb * uLightColor.rgb * (0.25 + 0.75 * wrap);
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

vec3 studio(vec3 d, float soft)
{
    float az = atan(d.z, d.x);
    float el = d.y;
    vec3 c = vec3(0.015) + vec3(0.05) * smoothstep(-0.1, 0.7, el);
    c += vec3(2.2) * band(angleDelta(az, 0.6), 0.0, 0.10, 0.03 + soft) * band(el, 0.15, 0.55, 0.15 + soft);
    c += vec3(1.6, 1.7, 1.9) * band(angleDelta(az, 2.6), 0.0, 0.06, 0.02 + soft) * band(el, 0.0, 0.65, 0.15 + soft);
    c += vec3(1.5, 1.25, 1.0) * band(angleDelta(az, -1.8), 0.0, 0.22, 0.06 + soft) * band(el, 0.3, 0.3, 0.1 + soft);
    c += vec3(1.8) * band(el, 0.93, 0.02, 0.015 + soft);
    c += vec3(0.06) * smoothstep(0.0, -0.7, el);
    return c;
}

// Equirectangular lookup in TouchDesigner's convention: u = 0 faces +X, then +Z.
vec2 panoramaUV(vec3 d)
{
    float u = atan(d.z, d.x) / (2.0 * LG_PI);
    float v = 0.5 + asin(clamp(d.y, -1.0, 1.0)) / LG_PI;
    return vec2(fract(u), v);
}

// screenSign: as in projectOffset(), for the flat-image mode's screen offset.
vec3 environmentSample(vec3 d, vec2 uv, mat3 view, vec2 screenSign, float blur)
{
    int mode = int(uEnv.x + 0.5);
    float c = cos(uEnv.y);
    float s = sin(uEnv.y);
    vec3 r = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);  // rotate around +Y
    if (uInputs.y < 0.5 || mode == 2) return studio(r, 0.15 * blur);
    float lod = log2(max(blur * 0.05 * float(textureSize(sReflection, 0).x), 1.0));
    if (mode == 1) {
        vec3 rv = view * d;  // reflection direction as seen by the camera
        return textureLod(sReflection, mirrorUV(uv + rv.xy * screenSign * uEnv.w * 0.5), lod).rgb;
    }
    return textureLod(sReflection, panoramaUV(r), lod).rgb;
}

// Average a few nearby directions for blurry (rough) reflections.
vec3 environment(vec3 R, vec2 uv, mat3 view, vec2 screenSign)
{
    float blur = uEnv.z;
    if (blur <= 0.001) return environmentSample(R, uv, view, screenSign, 0.0);
    vec3 t = normalize(cross(abs(R.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), R));
    vec3 b = cross(R, t);
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        float a = float(i) * 2.39996;
        float r = sqrt((float(i) + 0.5) / 8.0) * blur * 0.4;
        sum += environmentSample(normalize(R + (t * cos(a) + b * sin(a)) * r), uv, view, screenSign, blur);
    }
    return sum / 8.0;
}
// @end reflection

// @begin bounce
// Light the far wall reflects back inside (all of it past the critical
// angle). It is followed for one mirror bounce, then looked up without a
// second exit: an approximated internal bounce. Heading away from the
// camera or sideways, it meets the scene behind (a mirrored copy of the
// Refraction TOP, read at `unfolded`, the bounced ray's point Scene depth
// further on); heading back toward the camera, it meets the environment.
// The two blend smoothly in between.
vec3 bounceLight(vec3 bounced, vec3 eye, vec2 uv, vec2 unfolded, PrismCamera cam, mat3 view, float lod)
{
    vec3 seen = environmentSample(bounced, uv, view, cam.screenSign, uEnv.z);
    float towardScene = uInputs.x * smoothstep(-0.6, 0.2, dot(bounced, eye));
    if (towardScene > 0.0) seen = mix(seen, textureLod(sRefraction, mirrorUV(unfolded), lod).rgb, towardScene);
    return seen;
}
// @end bounce

// @begin trace
// Every slice of the spectrum, through both surfaces. Each slice enters
// with its own IOR, crosses to the exit, and either leaves (then travels
// Scene depth further and reads the Refraction TOP there) or is reflected
// back inside, in proportion to the Fresnel share. Frost spreads the
// lookups over a small disc, read from a mipmap level as wide as the gap
// between them, so the blur stays continuous. Each lookup also reads a
// level wide enough for its own footprint (footprintLod), so a strongly
// shrunk view turns smooth instead of grainy. The bounce lookup is worked
// out for every slice, not only trapped ones, because its footprint needs
// screen derivatives, which every pixel must compute together.
void throughGlass(vec3 eye, vec3 n, vec2 uv, PrismExit exit, PrismCamera cam, mat3 view,
                  vec2 toUV, vec3 lightDir, out vec3 behind, out vec3 bounce, out vec3 glow)
{
    int count = clamp(int(uState.z + 0.5), 1, 32);
    float colourSplit = clamp(uOptics.z * 4.0, 0.0, 1.0);
    vec2 size = vec2(textureSize(sRefraction, 0));
    vec2 blurPixels = uBody.y * 0.25 * abs(toUV) * size;
    float lod = log2(max(2.0 * max(blurPixels.x, blurPixels.y) / sqrt(float(count)), 1.0));
    mat3 toWorld = transpose(view);  // camera right and up, in world space
    vec3 sumBehind = vec3(0.0);
    vec3 sumBounce = vec3(0.0);
    vec3 sumGlow = vec3(0.0);
    vec3 weightSum = vec3(0.0);
    for (int i = 0; i < 32; i++) {
        if (i >= count) break;
        float w = (float(i) + 0.5) / float(count);
        float ior = sliceIor(w);
        vec3 inside = enterGlass(eye, n, ior);
        vec3 farNormal = sliceExitNormal(inside, n, eye, uv, exit, cam);
        vec4 leave = leaveGlass(inside, farNormal, ior);
        float angle = float(i) * 2.39996;
        float radius = sqrt(fract(float(i) * 0.618034 + 0.5)) * uBody.y * 0.25;
        vec3 hit = exit.point + leave.xyz * uPrism.x
                 + (toWorld[0] * cos(angle) + toWorld[1] * sin(angle)) * radius;
        vec2 unfolded = uv + projectOffset(hit, vWorldPos, cam);
        vec3 weight = mix(vec3(1.0), spectrum(w), colourSplit);
        sumBehind += (1.0 - leave.w) * weight
                   * textureLod(sRefraction, mirrorUV(unfolded), footprintLod(unfolded, lod, size)).rgb;
        if (uPrism.z > 0.0) {
            vec3 bounced = inside - 2.0 * max(dot(inside, farNormal), 0.0) * farNormal;
            vec2 bounceAt = uv + projectOffset(exit.point + bounced * uPrism.x, vWorldPos, cam);
            float bounceLod = footprintLod(bounceAt, lod, size);
            if (leave.w > 0.001) sumBounce += leave.w * weight * bounceLight(bounced, eye, uv, bounceAt, cam, view, bounceLod);
        }
        sumGlow += causticGlow(exit.normal, lightDir, ior) * weight;
        weightSum += weight;
    }
    behind = sumBehind / weightSum;
    bounce = uPrism.z * sumBounce / weightSum;
    glow = sumGlow / weightSum;
}
// @end trace

// @begin diagnostics
// One wavelength through both surfaces, exactly as in throughGlass():
// the outgoing direction in xyz and the trapped share in w.
vec4 traceSlice(float w, vec3 eye, vec3 n, vec2 uv, PrismExit exit, PrismCamera cam)
{
    vec3 inside = enterGlass(eye, n, sliceIor(w));
    return leaveGlass(inside, sliceExitNormal(inside, n, eye, uv, exit, cam), sliceIor(w));
}

// Exit directions for red (680 nm), the middle (530 nm, the Ior value) and
// violet (400 nm), as angles away from the view direction (1 = 90 degrees).
// A trapped slice shows 1.
vec3 deviation(vec3 eye, vec3 n, vec2 uv, PrismExit exit, PrismCamera cam)
{
    vec4 r = traceSlice(0.0, eye, n, uv, exit, cam);
    vec4 g = traceSlice(MIDDLE_W, eye, n, uv, exit, cam);
    vec4 v = traceSlice(1.0, eye, n, uv, exit, cam);
    vec3 d = vec3(atan(length(cross(r.xyz, eye)), dot(r.xyz, eye)),
                  atan(length(cross(g.xyz, eye)), dot(g.xyz, eye)),
                  atan(length(cross(v.xyz, eye)), dot(v.xyz, eye))) / (0.5 * LG_PI);
    return mix(d, vec3(1.0), step(vec3(1.0), vec3(r.w, g.w, v.w)));
}

// Share of light reflected back inside at the exit, for red, middle, violet.
vec3 trapped(vec3 eye, vec3 n, vec2 uv, PrismExit exit, PrismCamera cam)
{
    return vec3(traceSlice(0.0, eye, n, uv, exit, cam).w,
                traceSlice(MIDDLE_W, eye, n, uv, exit, cam).w,
                traceSlice(1.0, eye, n, uv, exit, cam).w);
}
// @end diagnostics

// @begin light
// Heckel-style Blinn-Phong: squaring the half-vector term gives a tight,
// glassy highlight. The rim is a fresnel glow toward the silhouette.
vec3 highlights(vec3 n, vec3 eye, vec3 lightDir, float fresnel)
{
    vec3 h = normalize(lightDir - eye);
    float nh = max(dot(n, h), 0.0);
    float spec = pow(nh * nh, uLightColor.w) * uLight.w;
    float diffuse = max(dot(n, lightDir), 0.0) * uSurface.z;
    return uLightColor.rgb * (spec + diffuse) + uRim.rgb * uRim.a * fresnel;
}
// @end light

void main()
{
    // @begin setup
    // Screen derivatives come first, while every pixel runs the same code:
    // inside a branch that neighbouring pixels take differently, GLSL leaves
    // them undefined. The faceted normal stands in when the geometry has no
    // normals. The pixel's own projected position tells which way screen x
    // and y run against the projection's x and y (+-2/width per pixel), so
    // bent lookups go the right way whatever the build's screen convention.
    vec3 faceted = cross(dFdx(vWorldPos), dFdy(vWorldPos));
    PrismCamera cam;
    cam.viewProj = uTDMats[vCamIndex].proj * uTDMats[vCamIndex].cam;
    vec4 clip = cam.viewProj * vec4(vWorldPos, 1.0);
    vec2 ndc = clip.xy / clip.w;
    cam.screenSign = vec2(dFdx(ndc.x) < 0.0 ? -1.0 : 1.0, dFdy(ndc.y) < 0.0 ? -1.0 : 1.0);
    if (uState.w > 0.5) cam.screenSign.y = -cam.screenSign.y;  // Flip V flips every offset too
    TDCheckDiscard();

    cam.position = uTDMats[vCamIndex].camInverse[3].xyz;
    cam.forward = normalize(-uTDMats[vCamIndex].camInverse[2].xyz);
    cam.perspective = abs(uTDMats[vCamIndex].proj[2][3]) > 0.5;
    mat3 view = mat3(uTDMats[vCamIndex].cam);
    vec3 eye = cam.perspective ? normalize(vWorldPos - cam.position) : cam.forward;
    float surfaceDistance = eyeDistance(vWorldPos, cam);
    float depth = max(-(uTDMats[vCamIndex].cam * vec4(vWorldPos, 1.0)).z, 1e-3);
    vec2 toUV = unitsToUV(uTDMats[vCamIndex].proj, depth);
    vec2 uv = screenUV();

    // The back-face pass only records the far side: outward normal, and the
    // distance stored negative, so that any background (alpha >= 0) is empty.
    if (uState.y > 0.5) {
        fragColor = TDOutputSwizzle(vec4(wobbleNormal(outwardBackNormal(eye, faceted)), -surfaceDistance));
        return;
    }
    bool useBack = uInputs.z > 0.5;
    bool hasRefraction = uInputs.x > 0.5;

    vec3 n = wobbleNormal(facingNormal(eye, faceted));
    vec3 lightDir = normalize(uLight.xyz);
    float NdotV = clamp(dot(n, -eye), 0.0, 1.0);
    float fresnel = pow(1.0 - NdotV, uSurface.y);
    // @end setup

    // @begin compose
    // The exit is traced once, with the Ior value (530 nm); each slice then
    // gets its own exit normal in throughGlass().
    vec3 centreRay = enterGlass(eye, n, max(uOptics.x, 1.0));
    PrismExit exit = estimateExit(vWorldPos, n, eye, centreRay);
    if (useBack) exit = measureExit(vWorldPos, centreRay, uv, cam, surfaceDistance, exit);

    vec3 behind, bounce, glow;
    throughGlass(eye, n, uv, exit, cam, view, toUV, lightDir, behind, bounce, glow);
    // Bounced light crosses the glass again, so it is tinted twice as deep.
    vec3 inner = bounce * absorption(exit.path) + glow;
    vec3 through = saturateColour((hasRefraction ? behind : vec3(0.0)) + inner, uOptics.w);

    // Edge tint lengthens the light path at grazing angles (deep-coloured rims).
    float path = exit.path * (1.0 + uBody.w * (1.0 / max(NdotV, 0.15) - 1.0));
    vec3 tint = absorption(path);
    vec3 body = bodyColour(n, lightDir);
    float translucency = uBody.x;

    vec3 film = thinFilm(NdotV, filmThickness());
    vec3 filmTint = mix(vec3(1.0), 2.0 * film, uFilm.x);

    float f0 = pow((uOptics.x - 1.0) / (uOptics.x + 1.0), 2.0);
    float reflectance = mix(mix(f0, 1.0, fresnel), 1.0, uSurface.x);
    vec3 env = environment(reflect(eye, n), uv, view, cam.screenSign);
    vec3 reflection = env * uReflect.rgb * uReflect.a * reflectance * filmTint;
    vec3 shine = highlights(n, eye, lightDir, fresnel)
               + film * uFilm.x * 0.3 * (0.3 + 0.7 * fresnel);

    vec3 colour;
    float alpha;
    if (hasRefraction) {
        colour = mix(body, through * tint, translucency) + reflection + shine;
        alpha = 1.0;
    } else {
        // Nothing to refract: let the real background show through by blending.
        // Bounce and glow do not need the Refraction TOP, so they stay.
        float seeThrough = translucency * dot(tint, vec3(1.0 / 3.0));
        colour = body * (1.0 - translucency) + uGlass.rgb * (translucency - seeThrough)
               + through * tint * translucency + reflection + shine;
        alpha = 1.0 - seeThrough;
    }

    // Premultiplied output: opacity fades the whole glass, reflections included.
    colour *= uBody.z;
    alpha *= uBody.z;
    // @end compose

    // @begin stages
    int stage = int(uState.x + 0.5);
    if (stage > 0) {
        if (stage == 1) colour = n * 0.5 + 0.5;
        else if (stage == 2) colour = through;
        else if (stage == 3) colour = mix(body, through * tint, translucency);
        else if (stage == 4) colour = reflection;
        else if (stage == 5) colour = vec3(fresnel);
        else if (stage == 6) colour = vec3(exit.path / max(2.0 * uOptics.y, 1e-3));
        else if (stage == 7) colour = film;
        else if (stage == 8) colour = vec3(uv, 0.0);
        else if (stage == 9) colour = exit.normal * 0.5 + 0.5;
        else if (stage == 10) colour = deviation(eye, n, uv, exit, cam);
        else if (stage == 11) colour = trapped(eye, n, uv, exit, cam);
        else if (stage == 12) colour = bounce;
        else colour = glow;
        alpha = 1.0;
    }
    fragColor = TDOutputSwizzle(vec4(colour, alpha));
    // @end stages
}
