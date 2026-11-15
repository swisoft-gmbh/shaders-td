// Demo environment map (GLSL TOP, 2:1, 16-bit float) for the demo
// Environment Light COMP. It is the material's built-in studio plus a few
// coloured panels, so you can tell at a glance whether reflections come from
// the Environment Light COMP (colour) or the built-in studio (white only).
// TouchDesigner equirectangular convention: u = 0 faces +X, then +Z; v = 0 is
// straight down. Derived from the core study's env.frag (commit a6f95c6).
// Replace it with your own HDRI or movie in real use.

layout(location = 0) out vec4 fragColor;

const float LG_PI = 3.14159265;

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

// Same studio as liquid_glass_lit.frag (without its rotation); keep in sync.
vec3 studio(vec3 d)
{
    float az = azimuth(d);
    float el = d.y;
    vec3 c = vec3(0.015) + vec3(0.05) * smoothstep(-0.1, 0.7, el);
    c += vec3(2.2) * band(angleDelta(az, 0.6), 0.0, 0.10, 0.03) * band(el, 0.15, 0.55, 0.15);
    c += vec3(1.6, 1.7, 1.9) * band(angleDelta(az, 2.6), 0.0, 0.06, 0.02) * band(el, 0.0, 0.65, 0.15);
    c += vec3(1.5, 1.25, 1.0) * band(angleDelta(az, -1.8), 0.0, 0.22, 0.06) * band(el, 0.3, 0.3, 0.1);
    c += vec3(1.8) * band(el, 0.93, 0.02, 0.015);
    c += vec3(0.06) * (1.0 - smoothstep(-0.7, 0.0, el));
    return c;
}

void main()
{
    vec2 uv = vUV.st;
    float az = uv.x * 2.0 * LG_PI;
    float el = (uv.y - 0.5) * LG_PI;
    vec3 d = vec3(cos(az) * cos(el), sin(el), sin(az) * cos(el));
    float a = azimuth(d);
    vec3 c = studio(d);
    // Coloured panels: blue-violet and magenta gels, a warm window, a cyan floor glow.
    c += vec3(0.30, 0.40, 1.80) * band(angleDelta(a, -0.7), 0.0, 0.35, 0.12) * band(d.y, -0.05, 0.35, 0.12);
    c += vec3(1.50, 0.25, 1.20) * band(angleDelta(a, 1.9), 0.0, 0.30, 0.12) * band(d.y, 0.10, 0.25, 0.12);
    c += vec3(1.80, 0.95, 0.35) * band(angleDelta(a, -2.6), 0.0, 0.25, 0.04) * band(d.y, 0.35, 0.20, 0.04);
    c += vec3(0.04, 0.14, 0.16) * (1.0 - smoothstep(-0.8, -0.2, d.y));
    fragColor = TDOutputSwizzle(vec4(c, 1.0));
}
