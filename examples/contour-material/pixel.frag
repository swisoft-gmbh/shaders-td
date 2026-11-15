layout(location = 0) out vec4 fragColor;
in vec3 objectPosition;
in vec3 worldPosition;
uniform vec4 uControls; // contour count, warp, line half width, stage
uniform vec4 uClock;
void main() {
    // @begin field
    vec3 p = objectPosition;
    float field = p.y + uControls.y * 0.25
                * sin(5.0 * p.x + uClock.x * 0.3) * cos(4.0 * p.z);
    float phase = field * max(uControls.x, 1.0);
    float d = abs(fract(phase + 0.5) - 0.5);
    float aa = max(fwidth(phase), 0.0001);
    float line = 1.0 - smoothstep(uControls.z - aa, uControls.z + aa, d);
    // @end field
    // @begin normal
    vec3 crossNormal = cross(dFdx(worldPosition), dFdy(worldPosition));
    vec3 normal = crossNormal / max(length(crossNormal), 0.00001);
    normal *= gl_FrontFacing ? 1.0 : -1.0;
    float diffuse = 0.25 + 0.75 * max(dot(normal, normalize(vec3(-0.4, 0.7, 0.6))), 0.0);
    // @end normal
    // @begin compose
    vec3 clay = mix(vec3(0.055, 0.13, 0.16), vec3(0.20, 0.43, 0.46),
                    clamp(field * 0.5 + 0.5, 0.0, 1.0));
    vec3 color = mix(clay, vec3(0.95, 0.63, 0.27), line) * diffuse;
    int stage = int(uControls.w + 0.5);
    if (stage == 1) color = vec3(fract(field * 0.5 + 0.5));
    if (stage == 2) color = normal * 0.5 + 0.5;
    if (stage == 3) color = vec3(line);
    fragColor = TDOutputSwizzle(vec4(color, 1.0));
    // @end compose
}
