layout(location = 0) out vec4 fragColor;
uniform vec4 uControls;
void main() {
    vec2 uv = vUV.st;
    vec3 source = texture(sTD2DInputs[0], uv).rgb;
    vec4 state = texture(sTD2DInputs[1], uv);
    // @begin representation
    vec2 pixels = uv * uTDOutputInfo.res.zw;
    float phase = (pixels.x + pixels.y) / max(uControls.z, 2.0);
    float d = abs(fract(phase + 0.5) - 0.5);
    float aa = max(fwidth(phase), 0.0001);
    float hatch = 1.0 - smoothstep(0.16 - aa, 0.16 + aa, d);
    vec3 color = vec3(0.012, 0.020, 0.035) + source * 0.12;
    color += state.g * mix(vec3(0.04, 0.25, 0.28),
                           vec3(0.90, 0.35, 0.12), hatch);
    color += state.b * vec3(0.12, 0.45, 0.52);
    // @end representation
    // @begin diagnostics
    int stage = int(uControls.w + 0.5);
    if (stage == 1) color = source;
    if (stage == 2) color = vec3(state.b);
    if (stage == 3) color = vec3(state.g);
    fragColor = TDOutputSwizzle(vec4(color, 1.0));
    // @end diagnostics
}
