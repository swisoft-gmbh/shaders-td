// Original toolkit study. See sources.json for conceptual references.
// TouchDesigner supplies version, vUV and uTDOutputInfo.
layout(location = 0) out vec4 fragColor;
uniform vec4 uControls; // bands, warp, line half-width in phase units, stage
uniform vec4 uClock;    // seconds, simulation step, pause, unused

// @begin field
float field(vec2 p, float time) {
    vec2 a = p - vec2(-0.30, 0.13);
    vec2 b = p - vec2(0.32, -0.20);
    float hills = 0.68 * exp(-3.8 * dot(a, a))
                + 0.46 * exp(-7.0 * dot(b, b));
    float fold = sin(4.5 * p.x + 2.1 * p.y + 0.35 * time)
               * cos(3.0 * p.y - 0.22 * time);
    return hills + 0.23 * uControls.y * fold;
}
// @end field

void main() {
    // @begin coordinates
    vec2 uv = vUV.st;
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uTDOutputInfo.res.z / uTDOutputInfo.res.w;
    float height = field(p, uClock.x);
    // @end coordinates

    // @begin contours
    float phase = height * max(uControls.x, 1.0);
    float distanceToLine = abs(fract(phase + 0.5) - 0.5);
    float aa = max(fwidth(phase), 0.0001);
    float line = 1.0 - smoothstep(uControls.z - aa,
                                 uControls.z + aa, distanceToLine);
    // @end contours

    // @begin compose
    float weave = 0.5 + 0.5 * sin(10.0 * p.x - 7.0 * p.y + height * 5.0);
    vec3 paper = mix(vec3(0.018, 0.033, 0.055),
                     vec3(0.045, 0.095, 0.12), clamp(height, 0.0, 1.0));
    vec3 ink = mix(vec3(0.12, 0.54, 0.62), vec3(0.95, 0.57, 0.22), weave);
    vec3 color = mix(paper, ink, line);
    int stage = int(uControls.w + 0.5);
    if (stage == 1) color = vec3(clamp(height, 0.0, 1.0));
    if (stage == 2) color = vec3(line);
    if (stage == 3) color = vec3(uv, 0.0);
    fragColor = TDOutputSwizzle(vec4(color, 1.0));
    // @end compose
}
