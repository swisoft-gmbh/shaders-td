// Liquid Glass Lit: GLSL MAT pixel shader for TouchDesigner (GLSL 4.60).
//
// The member of the Liquid Glass family that takes its light from the scene.
// Light COMPs reach it through TDLightingPBR() (highlights and body light).
// Environment Light COMPs reach it through TDEnvLightTextureLod() (reflections)
// and TDEnvLightingPBR() (ambient light on the body). With no Light COMP or no
// Environment Light COMP in the render, it falls back to a built-in key light
// and a built-in studio, so it always renders.
//
// Refraction, dispersion, saturation, fresnel and the glass highlight follow
// Maxime Heckel, "Refraction, dispersion, and other shader light effects"
// (2023), https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/
// The refraction, body, liquid and film code is derived from the core Liquid
// Glass study (commit a6f95c6). What was adapted and what is new is listed in
// sources.json.
//
// Input (GLSL MAT > Samplers page):
//   sRefraction  the scene behind the glass, rendered from the same camera
// Lights come from the Lights parameter of the render that draws the glass
// (a Render Pass TOP built on the scene render, or a Render TOP); nothing else to wire.

// @begin uniforms
uniform sampler2D sRefraction;

uniform vec4 uGlass;     // rgb glass colour, a tint density
uniform vec4 uBody;      // translucency, frost, opacity, edge tint
uniform vec4 uOptics;    // ior, thickness (scene units), dispersion, saturation
uniform vec4 uReflect;   // rgb reflection tint, a reflection amount
uniform vec4 uSurface;   // mirror, fresnel power, reflection roughness, highlight size (roughness)
uniform vec4 uRim;       // rgb rim colour, a rim amount
uniform vec4 uShade;     // specular, surface diffuse, ambient, shadow strength
uniform vec4 uSources;   // light source (0 auto, 1 scene, 2 built-in), environment source (same), env intensity, env mip levels
uniform vec4 uKey;       // built-in key light: xyz direction toward the light, w intensity
uniform vec4 uKeyColor;  // built-in key light rgb colour, w studio rotation (radians)
uniform vec4 uFilm;      // iridescence, film thickness (nm), film variation, unused
uniform vec4 uWobble;    // amount, scale, speed, time (seconds)
uniform vec4 uState;     // teaching stage, samples, flip V, has refraction TOP
// @end uniforms

in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vObjPos;
flat in int vCamIndex;

// One output per colour buffer of the Render TOP (# of Color Buffers). Buffer 0
// gets the glass; any extra buffers get zero instead of undefined values.
// TouchDesigner defines TD_NUM_COLOR_BUFFERS; the fallback covers a compile without it.
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
    if (uState.z > 0.5) uv.y = 1.0 - uv.y;  // escape hatch if a build flips V
    return uv;
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
    float away = dot(n, eye);
    if (away > -0.01) n = normalize(n - eye * (away + 0.01));
    return n;
}
// @end surface

// @begin liquid
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
    float x00 = mix(latticeHash(i),                  latticeHash(i + ivec3(1, 0, 0)), u.x);
    float x10 = mix(latticeHash(i + ivec3(0, 1, 0)), latticeHash(i + ivec3(1, 1, 0)), u.x);
    float x01 = mix(latticeHash(i + ivec3(0, 0, 1)), latticeHash(i + ivec3(1, 0, 1)), u.x);
    float x11 = mix(latticeHash(i + ivec3(0, 1, 1)), latticeHash(i + ivec3(1, 1, 1)), u.x);
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

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
    slope = uTDMats[vCamIndex].worldForNormals * slope;
    slope -= dot(slope, n) * n;
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
    float path = 2.0 * filmIor * thicknessNm * cosT;
    vec3 wavelength = vec3(650.0, 532.0, 450.0);
    return 0.5 - 0.5 * cos(2.0 * LG_PI * path / wavelength);
}

float filmThickness()
{
    float t = uWobble.w * uWobble.z;
    float swirl = valueNoise(vObjPos * 2.5 + vec3(0.0, 0.15 * t, 0.0)) * 2.0 - 1.0;
    return uFilm.y * (1.0 + uFilm.z * swirl);
}
// @end film

// @begin transmission
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

// One refraction per spectrum sample (dispersion), spread over a golden-angle
// disc for frost. Each frost sample reads a mipmap level as wide as the gap
// between samples, so the blur stays continuous.
vec3 transmitted(vec3 eye, vec3 n, vec2 uv, float thickness, mat3 view, vec2 toUV)
{
    int count = clamp(int(uState.y + 0.5), 1, 32);
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
        sum += textureLod(sRefraction, mirrorUV(uv + offset), lod).rgb * weight;
        weightSum += weight;
    }
    return sum / weightSum;
}

vec3 saturateColour(vec3 c, float amount)
{
    float luma = dot(c, vec3(0.2125, 0.7154, 0.0721));
    return max(mix(vec3(luma), c, amount), 0.0);
}

// Beer-Lambert: a longer path through tinted glass gives a deeper tint.
vec3 absorption(float path)
{
    return exp(-(1.0 - uGlass.rgb) * uGlass.a * path);
}
// @end transmission

// @begin sources
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
// @end sources

// @begin keylight
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
    vec3 light = uKeyColor.rgb * uKey.w * NdotL;
    return Lit(light, light * spec);
}
// @end keylight

// @begin gather
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
// @end gather

// @begin studio
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

vec3 studio(vec3 d, float soft)
{
    float c0 = cos(uKeyColor.w);
    float s0 = sin(uKeyColor.w);
    d = vec3(c0 * d.x + s0 * d.z, d.y, -s0 * d.x + c0 * d.z);  // Studio rotation, around +Y
    float az = atan(d.z, d.x);
    float el = d.y;
    vec3 c = vec3(0.015) + vec3(0.05) * smoothstep(-0.1, 0.7, el);
    c += vec3(2.2) * band(angleDelta(az, 0.6), 0.0, 0.10, 0.03 + soft) * band(el, 0.15, 0.55, 0.15 + soft);
    c += vec3(1.6, 1.7, 1.9) * band(angleDelta(az, 2.6), 0.0, 0.06, 0.02 + soft) * band(el, 0.0, 0.65, 0.15 + soft);
    c += vec3(1.5, 1.25, 1.0) * band(angleDelta(az, -1.8), 0.0, 0.22, 0.06 + soft) * band(el, 0.3, 0.3, 0.1 + soft);
    c += vec3(1.8) * band(el, 0.93, 0.02, 0.015 + soft);
    c += vec3(0.06) * (1.0 - smoothstep(-0.7, 0.0, el));
    return c;
}
// @end studio

// @begin envlight
#if TD_NUM_ENV_LIGHTS > 0
// One Environment Light COMP seen in direction d, at a mipmap level.
// The light's Environment Map Rotate turns the direction first. Its map is
// either a 2D equirectangular image or a cube map; the lookup for the other
// kind returns black, so adding both covers whichever the light uses.
vec3 envLight(int i, vec3 d, float lod)
{
    vec3 m = normalize(uTDEnvLights[i].rotate * d);
    vec3 c = TDEnvLightTextureLod(i, m, lod).rgb
           + TDEnvLightTextureLod(i, TDCubeMapToEquirectangular(m), lod).rgb;
    return c * uTDEnvLights[i].color;
}
#endif
// @end envlight

// @begin roughness
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
// @end roughness

// @begin ambient
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
// @end ambient

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
    vec3 toCam = -eye;
    float depth = max(-(uTDMats[vCamIndex].cam * vec4(vWorldPos, 1.0)).z, 1e-3);
    vec2 toUV = unitsToUV(proj, depth);
    vec2 uv = screenUV();
    bool hasRefraction = uState.w > 0.5;

    vec3 n = wobbleNormal(facingNormal(eye));
    float NdotV = clamp(dot(n, toCam), 0.0, 1.0);
    float fresnel = pow(1.0 - NdotV, uSurface.y);
    // @end setup

    // @begin compose
    Lit lit = gatherLights(vWorldPos, n, toCam, clamp(uSurface.w, 0.02, 1.0));
    vec3 ambient = ambientLight(n, toCam);

    float thickness = uOptics.y;
    vec3 through = vec3(0.0);
    if (hasRefraction) {
        through = saturateColour(transmitted(eye, n, uv, thickness, view, toUV), uOptics.w);
    }
    float path = thickness * (1.0 + uBody.w * (1.0 / max(NdotV, 0.15) - 1.0));
    vec3 tint = absorption(path);
    vec3 body = uGlass.rgb * (lit.diffuse + ambient * uShade.z);
    float translucency = uBody.x;
    vec3 litBody = uGlass.rgb * lit.diffuse * (1.0 - translucency);  // the lit part of the body

    vec3 film = thinFilm(NdotV, filmThickness());
    vec3 filmTint = mix(vec3(1.0), 2.0 * film, uFilm.x);

    float f0 = pow((uOptics.x - 1.0) / (uOptics.x + 1.0), 2.0);
    float reflectance = mix(mix(f0, 1.0, fresnel), 1.0, uSurface.x);
    vec3 env = environment(reflect(eye, n), uSurface.z);
    vec3 reflection = env * uReflect.rgb * uReflect.a * reflectance * filmTint;
    vec3 fromLights = lit.specular * uShade.x * filmTint + lit.diffuse * uShade.y;
    vec3 glow = fromLights
              + uRim.rgb * uRim.a * fresnel
              + film * uFilm.x * 0.3 * (0.3 + 0.7 * fresnel);

    vec3 colour;
    float alpha;
    if (hasRefraction) {
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
    // A very small highlight can peak far above 1; capping at 1024 keeps it
    // finite in a 16-bit float render (largest value 65504).
    colour = min(colour, vec3(1024.0)) * uBody.z;
    alpha *= uBody.z;
    // @end compose

    // @begin stages
    int stage = int(uState.x + 0.5);
    if (stage > 0) {
        if (stage == 1) colour = n * 0.5 + 0.5;
        else if (stage == 2) colour = through;
        else if (stage == 3) colour = mix(body, through * tint, translucency);
        else if (stage == 4) colour = reflection;
        else if (stage == 5) colour = (fromLights + litBody) * uBody.z;  // everything the lights add
        else if (stage == 6) colour = env;
        else if (stage == 7) colour = ambient;
        else if (stage == 8) colour = vec3(fresnel);
        else if (stage == 9) colour = film;
        else if (stage == 10) colour = vec3(useSceneLights() ? 1.0 : 0.0,
                                            useSceneEnv() ? 1.0 : 0.0,
                                            useKeyLight() || useStudio() ? 1.0 : 0.0);
        else colour = vec3(uv, 0.0);
        alpha = 1.0;
    }
    // Teaching stages skip the cap in compose; apply it to whatever is shown.
    colour = min(colour, vec3(1024.0));
    fragColor[0] = TDOutputSwizzle(vec4(colour, alpha));
#if TD_NUM_COLOR_BUFFERS > 1
    for (int i = 1; i < TD_NUM_COLOR_BUFFERS; i++) fragColor[i] = vec4(0.0);
#endif
    // @end stages
}
