layout(location = 0) out vec4 fragColor;
uniform vec4 uControls; // threshold, lifetime seconds, pattern pitch, display stage
uniform vec4 uClock; // time, fixed simulation step, pause, unused
void main() {
    vec2 uv = vUV.st;
    vec3 current = texture(sTD2DInputs[0], uv).rgb;
    vec4 old = texture(sTD2DInputs[1], uv);
    // @begin initialize
    float luminance = dot(current, vec3(0.2126, 0.7152, 0.0722));
    if (old.a < 0.5) {
        fragColor = TDOutputSwizzle(vec4(luminance, 0.0, 0.0, 1.0));
        return;
    }
    if (uClock.z > 0.5) {
        fragColor = TDOutputSwizzle(old);
        return;
    }
    // @end initialize
    // @begin motion
    float difference = abs(luminance - old.r);
    float threshold = max(uControls.x, 0.001);
    float motion = smoothstep(threshold, threshold * 3.0, difference);
    // @end motion
    // @begin decay
    float dt = clamp(uClock.y, 0.0, 0.1);
    float lifetime = max(uControls.y, 0.02);
    float trail = max(motion, old.g * exp(-dt / lifetime));
    fragColor = TDOutputSwizzle(vec4(luminance, trail, motion, 1.0));
    // @end decay
}
