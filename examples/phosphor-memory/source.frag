layout(location = 0) out vec4 fragColor;
uniform vec4 uClock;
// @begin source
void main() {
    vec2 p = (vUV.st - 0.5) * 2.0;
    p.x *= uTDOutputInfo.res.z / uTDOutputInfo.res.w;
    vec2 center = vec2(0.43 * cos(uClock.x * 0.8),
                       0.31 * sin(uClock.x * 1.1));
    float orb = exp(-65.0 * dot(p - center, p - center));
    float ring = exp(-600.0 * pow(length(p + center * 0.5) - 0.27, 2.0));
    vec3 color = vec3(clamp(orb + 0.65 * ring, 0.0, 1.0));
    fragColor = TDOutputSwizzle(vec4(color, 1.0));
}
// @end source
