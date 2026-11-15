// Liquid Glass Flow: GLSL MAT pixel shader for TouchDesigner (GLSL 4.60).
//
// This is the Liquid Glass pixel shader (studies/liquid-glass, commit a6f95c6)
// with three additions: the vFlow input, the "displacement" teaching stage,
// and zeros for any extra colour buffers of the Render TOP.
// The vertex shader liquid_flow.vert moves the surface; everything here works
// on the moved surface without knowing it moved.
//
// An original material for any 3D object. The refraction, dispersion,
// saturation, specular, fresnel and back-face ideas follow Maxime Heckel,
// "Refraction, dispersion, and other shader light effects" (2023),
// https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/
// What was adapted and what is new is listed in sources.json.
//
// Inputs (GLSL MAT > Samplers page):
//   sRefraction  the scene behind the glass, rendered from the same camera
//   sReflection  a 360 panorama or any flat image to reflect
//   sBackface    optional back-face pass (rgb colour, alpha = eye distance)

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
// @end uniforms

in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vObjPos;
in float vFlow;   // outward motion in units of Amplitude (displacement stage)
flat in int vCamIndex;

layout(location = 0) out vec4 fragColor[TD_NUM_COLOR_BUFFERS];  // TouchDesigner sets the count

const float LG_PI = 3.14159265;

// @begin screen
// Where this pixel sits on the render, 0..1 across and up.
// uTDGeneral.viewport holds (x, y, 1/width, 1/height) in pixels.
vec2 screenUV()
{
    vec2 uv = (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw;
    if (uState.w > 0.5) uv.y = 1.0 - uv.y;  // escape hatch if a build flips V
    return uv;
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
// The interpolated normal, or a faceted one from screen derivatives when
// the geometry carries no normals. Always turned to face the camera.
vec3 facingNormal(vec3 eye)
{
    vec3 n = vWorldNormal;
    if (dot(n, n) < 1e-8) {
        n = cross(dFdx(vWorldPos), dFdy(vWorldPos));
        n = dot(n, n) < 1e-12 ? -eye : normalize(n);
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

// Tilt the normal along the field's slope, like ripples on a liquid.
// Shading only: the silhouette does not change.
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

// Film thickness swirls over the object so the colours form bands.
float filmThickness()
{
    float t = uWobble.w * uWobble.z;
    float swirl = valueNoise(vObjPos * 2.5 + vec3(0.0, 0.15 * t, 0.0)) * 2.0 - 1.0;
    return uFilm.y * (1.0 + uFilm.z * swirl);
}
// @end film

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

// What lies behind the glass at uv: the back-face pass where it exists,
// otherwise the refraction TOP. lod > 0 reads a pre-blurred mipmap level of the
// scene; the back-face pass is always read sharp, because blurring its edge
// would mix in empty texels and darken the silhouette.
vec3 sampleBehind(vec2 uv, float lod, bool useBack)
{
    uv = mirrorUV(uv);
    vec3 c = textureLod(sRefraction, uv, lod).rgb;
    if (useBack) {
        vec4 b = textureLod(sBackface, uv, 0.0);
        if (b.a > 0.0) c = b.rgb;
    }
    return c;
}

// Many slightly different refractions, one per sample of the spectrum.
// Violet bends more than red (dispersion). A golden-angle spiral spreads
// the same samples over a disc, which blurs the view (frost). Each frost
// sample reads a mipmap level as wide as the gap between samples, so the
// blur stays continuous instead of showing separate copies.
vec3 transmitted(vec3 eye, vec3 n, vec2 uv, float thickness, mat3 view, vec2 toUV, bool useBack)
{
    int count = clamp(int(uState.z + 0.5), 1, 32);
    float spread = uOptics.z * 0.3;
    float colourSplit = clamp(uOptics.z * 4.0, 0.0, 1.0);
    vec2 blurPixels = uBody.y * 0.25 * abs(toUV) * vec2(textureSize(sRefraction, 0));
    float lod = log2(max(2.0 * max(blurPixels.x, blurPixels.y) / sqrt(float(count)), 1.0));
    vec3 sum = vec3(0.0);
    vec3 weightSum = vec3(0.0);
    for (int i = 0; i < 32; i++) {
        if (i >= count) break;
        float w = (float(i) + 0.5) / float(count);
        float ior = uOptics.x + spread * (w - 0.5);
        vec2 offset = bendOffset(eye, n, ior, thickness, view, toUV);
        float angle = float(i) * 2.39996;
        float radius = sqrt(fract(float(i) * 0.618034 + 0.5)) * uBody.y * 0.25;
        offset += vec2(cos(angle), sin(angle)) * radius * toUV;
        vec3 weight = mix(vec3(1.0), spectrum(w), colourSplit);
        sum += sampleBehind(uv + offset, lod, useBack) * weight;
        weightSum += weight;
    }
    return sum / weightSum;
}

vec3 saturateColour(vec3 c, float amount)
{
    float luma = dot(c, vec3(0.2125, 0.7154, 0.0721));
    return max(mix(vec3(luma), c, amount), 0.0);
}
// @end dispersion

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

// soft > 0 widens every light edge, which is how the studio blurs.
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

vec3 environmentSample(vec3 d, vec2 uv, mat3 view, float blur)
{
    int mode = int(uEnv.x + 0.5);
    float c = cos(uEnv.y);
    float s = sin(uEnv.y);
    vec3 r = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);  // rotate around +Y
    if (uInputs.y < 0.5 || mode == 2) return studio(r, 0.15 * blur);
    // Mipmap level about as wide as the gap between the 8 blur directions.
    float lod = log2(max(blur * 0.05 * float(textureSize(sReflection, 0).x), 1.0));
    if (mode == 1) {
        vec3 rv = view * d;  // reflection direction as seen by the camera
        return textureLod(sReflection, mirrorUV(uv + rv.xy * uEnv.w * 0.5), lod).rgb;
    }
    return textureLod(sReflection, panoramaUV(r), lod).rgb;
}

// Average a few nearby directions for blurry (rough) reflections.
vec3 environment(vec3 R, vec2 uv, mat3 view)
{
    float blur = uEnv.z;
    if (blur <= 0.001) return environmentSample(R, uv, view, 0.0);
    vec3 t = normalize(cross(abs(R.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), R));
    vec3 b = cross(R, t);
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        float a = float(i) * 2.39996;
        float r = sqrt((float(i) + 0.5) / 8.0) * blur * 0.4;
        sum += environmentSample(normalize(R + (t * cos(a) + b * sin(a)) * r), uv, view, blur);
    }
    return sum / 8.0;
}
// @end reflection

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

// @begin backface
// With the optional back-face pass, its alpha holds how far the far side of
// the glass is from the camera, so thickness is measured instead of guessed.
float glassThickness(vec2 uv, float surfaceDistance, bool useBack)
{
    float thickness = uOptics.y;
    if (useBack) {
        float backDistance = textureLod(sBackface, uv, 0.0).a;
        if (backDistance > surfaceDistance) thickness = backDistance - surfaceDistance;
    }
    return thickness;
}
// @end backface

// @begin flowstage
// Teaching stage "displacement": orange where the surface moved out, blue
// where it moved in, dark grey where it stayed (like the archived blob demo,
// which colours the sphere by its displacement).
vec3 flowColour(float flow)
{
    vec3 out_ = vec3(1.0, 0.55, 0.12);
    vec3 in_ = vec3(0.15, 0.4, 1.0);
    return mix(vec3(0.12), flow > 0.0 ? out_ : in_, clamp(abs(flow), 0.0, 1.0));
}
// @end flowstage

void main()
{
    TDCheckDiscard();

    // @begin setup
    vec3 camPos = uTDMats[vCamIndex].camInverse[3].xyz;
    mat4 proj = uTDMats[vCamIndex].proj;
    mat3 view = mat3(uTDMats[vCamIndex].cam);
    bool perspective = abs(proj[2][3]) > 0.5;
    vec3 eye = perspective ? normalize(vWorldPos - camPos)
                           : normalize(-uTDMats[vCamIndex].camInverse[2].xyz);
    float surfaceDistance = length(vWorldPos - camPos);
    float depth = max(-(uTDMats[vCamIndex].cam * vec4(vWorldPos, 1.0)).z, 1e-3);
    vec2 toUV = unitsToUV(proj, depth);
    vec2 uv = screenUV();

    bool backPass = uState.y > 0.5;
    bool useBack = uInputs.z > 0.5 && !backPass;
    bool hasRefraction = uInputs.x > 0.5;

    vec3 n = wobbleNormal(facingNormal(eye));
    vec3 lightDir = normalize(uLight.xyz);
    float NdotV = clamp(dot(n, -eye), 0.0, 1.0);
    float fresnel = pow(1.0 - NdotV, uSurface.y);
    // @end setup

    // @begin compose
    float thickness = glassThickness(uv, surfaceDistance, useBack);
    vec3 through = vec3(0.0);
    if (hasRefraction) {
        through = saturateColour(transmitted(eye, n, uv, thickness, view, toUV, useBack), uOptics.w);
    }

    // Edge tint lengthens the light path at grazing angles (deep-coloured rims).
    float path = thickness * (1.0 + uBody.w * (1.0 / max(NdotV, 0.15) - 1.0));
    vec3 tint = absorption(path);
    vec3 body = bodyColour(n, lightDir);
    float translucency = uBody.x;

    vec3 film = thinFilm(NdotV, filmThickness());
    vec3 filmTint = mix(vec3(1.0), 2.0 * film, uFilm.x);

    float f0 = pow((uOptics.x - 1.0) / (uOptics.x + 1.0), 2.0);
    float reflectance = mix(mix(f0, 1.0, fresnel), 1.0, uSurface.x);
    vec3 env = environment(reflect(eye, n), uv, view);
    vec3 reflection = env * uReflect.rgb * uReflect.a * reflectance * filmTint;
    vec3 glow = highlights(n, eye, lightDir, fresnel)
              + film * uFilm.x * 0.3 * (0.3 + 0.7 * fresnel);

    vec3 colour;
    float alpha;
    if (backPass) {
        // Inner surfaces: refracted scene plus softer reflections. Alpha carries
        // this surface's distance for the front pass (blending must be off).
        colour = through + 0.5 * (reflection + glow);
        alpha = surfaceDistance;
    } else if (hasRefraction) {
        colour = mix(body, through * tint, translucency) + reflection + glow;
        alpha = 1.0;
    } else {
        // Nothing to refract: let the real background show through by blending.
        float seeThrough = translucency * dot(tint, vec3(1.0 / 3.0));
        colour = body * (1.0 - translucency)
               + uGlass.rgb * (translucency - seeThrough) + reflection + glow;
        alpha = 1.0 - seeThrough;
    }

    // Premultiplied output: opacity fades the whole glass, reflections included.
    if (!backPass) {
        colour *= uBody.z;
        alpha *= uBody.z;
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
        else if (stage == 8) colour = vec3(uv, 0.0);
        else colour = flowColour(vFlow);
        if (!backPass) alpha = 1.0;
    }
    fragColor[0] = TDOutputSwizzle(vec4(colour, alpha));
    // A Render TOP with more than one colour buffer gets zeros in buffers 1-7
    // instead of undefined values. Each index is a constant, as some GPU
    // backends require, and never goes past the buffer count.
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
    // @end stages
}
