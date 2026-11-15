// Demo refraction input (GLSL TOP): a high-contrast backdrop that makes
// bending, colour splitting and blur easy to read through the glass.
// Replace it with a render of your own scene in real use.
//   uBackdrop.x = 0: grey checkerboard, coloured discs, black words (Study > Backdrop: Checker)
//   uBackdrop.x = 1: heavy white type and thin lines on black (Type; from the
//                    Liquid Glass Prism study, so contact sheets compare)

uniform vec4 uBackdrop;

layout(location = 0) out vec4 fragColor;

float hash21(vec2 p)
{
    return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
}

// Signed distance to a rounded box centred at c with half size b.
float roundBox(vec2 p, vec2 c, vec2 b, float r)
{
    vec2 q = abs(p - c) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Rows of bold "words", like a block of heavy type: 1 on ink, 0 off it.
// Each word is a run of heavy letter blocks; some letters get a counter
// (the hole in an O or an A) or a split stem, so edges come in many sizes.
float typeBlock(vec2 p, float px, float rowHeight, float rows, float top)
{
    float ink = 0.0;
    float letter = 0.62 * rowHeight;      // letter pitch
    for (int row = 0; row < 8; row++) {
        if (float(row) >= rows) break;
        float y = top - rowHeight * 1.35 * float(row);
        if (abs(p.y - y) > 0.6 * rowHeight) continue;
        float shift = hash21(vec2(float(row), 7.0)) * 0.4;
        float slot = floor((p.x + shift) * 3.2);
        float start = (slot + 0.08) / 3.2 - shift;
        float len = (0.35 + 0.55 * hash21(vec2(float(row), slot))) / 3.2;
        if (hash21(vec2(slot, float(row) + 3.0)) < 0.18) continue;
        float x = p.x - start;
        if (x < 0.0 || x > len) continue;
        float index = floor(x / letter);
        float cx = start + (index + 0.5) * letter;
        float h = hash21(vec2(index + 13.0 * slot, float(row)));
        float d = roundBox(p, vec2(cx, y), vec2(0.42 * letter, 0.5 * rowHeight), 0.12 * rowHeight);
        if (h > 0.55) {        // counter: a hole in the middle
            d = max(d, -roundBox(p, vec2(cx, y + 0.08 * rowHeight), vec2(0.13 * letter, 0.2 * rowHeight), 0.05 * rowHeight));
        } else if (h > 0.3) {  // split: an open stem from below
            d = max(d, -roundBox(p, vec2(cx, y - 0.3 * rowHeight), vec2(0.1 * letter, 0.3 * rowHeight), 0.03 * rowHeight));
        }
        ink = max(ink, 1.0 - smoothstep(-px, px, d));
    }
    return ink;
}

void main()
{
    vec2 uv = vUV.st;
    float aspect = uTDOutputInfo.res.z / uTDOutputInfo.res.w;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float px = 1.5 * uTDOutputInfo.res.y;  // about one pixel, for soft edges
    // Shapes are filled with 1 - smoothstep(-px, px, d): smoothstep needs its
    // first edge below the second.

    if (uBackdrop.x > 0.5) {
        // Black page, soft grey glow, heavy white type, thin rules.
        vec3 t = vec3(0.012) + vec3(0.05) * exp(-4.0 * dot(p, p));
        t = mix(t, vec3(0.94), typeBlock(p, px, 0.13, 5.0, 0.36));
        float rule = abs(abs(p.y + 0.445) - 0.025) - 0.003;
        t = mix(t, vec3(0.85), 1.0 - smoothstep(-px, px, rule));
        // A few thin white arcs, so bending shows even between the words.
        float arc = abs(length(p - vec2(-0.55, -0.05)) - 0.22) - 0.004;
        t = mix(t, vec3(1.0), 1.0 - smoothstep(-px, px, arc));
        arc = abs(length(p - vec2(0.62, 0.10)) - 0.16) - 0.004;
        t = mix(t, vec3(1.0), 1.0 - smoothstep(-px, px, arc));
        fragColor = TDOutputSwizzle(vec4(t, 1.0));
        return;
    }

    // Grey checkerboard, like a transparency grid.
    vec2 cell = floor(p * 12.0);
    vec3 c = mix(vec3(0.80), vec3(0.58), mod(cell.x + cell.y, 2.0));

    // Coloured discs behind everything.
    c = mix(c, vec3(0.95, 0.15, 0.55), 1.0 - smoothstep(-px, px, length(p - vec2(-0.45, 0.18)) - 0.17));
    c = mix(c, vec3(0.10, 0.75, 0.95), 1.0 - smoothstep(-px, px, length(p - vec2(0.42, -0.20)) - 0.20));
    c = mix(c, vec3(1.00, 0.80, 0.10), 1.0 - smoothstep(-px, px, length(p - vec2(0.05, 0.36)) - 0.11));

    // Rows of bold black "words", like a block of heavy type.
    for (int row = 0; row < 5; row++) {
        float y = -0.30 + 0.15 * float(row);
        float shift = hash21(vec2(float(row), 7.0)) * 0.4;
        float slot = floor((p.x + shift) * 3.2);
        float start = (slot + 0.08) / 3.2 - shift;
        float len = (0.35 + 0.55 * hash21(vec2(float(row), slot))) / 3.2;
        if (hash21(vec2(slot, float(row) + 3.0)) > 0.18) {
            float d = roundBox(p, vec2(start + 0.5 * len, y), vec2(0.5 * len, 0.045), 0.012);
            c = mix(c, vec3(0.02), 1.0 - smoothstep(-px, px, d));
        }
    }

    // A thin white ring for checking curvature.
    float ring = abs(length(p - vec2(0.0, -0.02)) - 0.33) - 0.006;
    c = mix(c, vec3(1.0), 1.0 - smoothstep(-px, px, ring));

    fragColor = TDOutputSwizzle(vec4(c, 1.0));
}
