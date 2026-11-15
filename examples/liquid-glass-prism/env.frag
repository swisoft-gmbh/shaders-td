// Demo reflection input (GLSL TOP, 2:1, 16-bit float): the material's
// built-in studio baked into an equirectangular panorama, plus two coloured
// gel lights so you can see that the reflection TOP is in use.
// This study's convention (as in liquid_prism.frag and the core study): u = 0
// faces +X, then +Z; v = 0 is straight down. Not yet compared with
// TouchDesigner's own environment lighting.
// Replace it with your own HDRI, movie or render in real use.

layout(location = 0) out vec4 fragColor;

const float LG_PI = 3.14159265;

// Same studio as liquid_prism.frag (and the core liquid_glass.frag); keep them in sync.
float band(float x, float centre, float halfWidth, float soft)
{
    return 1.0 - smoothstep(halfWidth - soft, halfWidth + soft, abs(x - centre));
}

float angleDelta(float a, float b)
{
    return mod(a - b + LG_PI, 2.0 * LG_PI) - LG_PI;
}

// atan(0, 0) is undefined, so straight up and straight down get 0.
float azimuth(vec3 d)
{
    return dot(d.xz, d.xz) > 1e-12 ? atan(d.z, d.x) : 0.0;
}

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

void main()
{
    vec2 uv = vUV.st;
    float az = uv.x * 2.0 * LG_PI;
    float el = (uv.y - 0.5) * LG_PI;
    vec3 d = vec3(cos(az) * cos(el), sin(el), sin(az) * cos(el));
    vec3 c = studio(d, 0.0);
    c += vec3(0.25, 0.45, 1.6) * band(angleDelta(azimuth(d), -0.7), 0.0, 0.35, 0.2) * band(d.y, -0.15, 0.3, 0.2);
    c += vec3(1.3, 0.25, 1.1) * band(angleDelta(azimuth(d), 1.9), 0.0, 0.3, 0.2) * band(d.y, 0.1, 0.25, 0.2);
    fragColor = TDOutputSwizzle(vec4(c, 1.0));
}
