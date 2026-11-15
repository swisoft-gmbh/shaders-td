// Demo refraction input (GLSL TOP): a backdrop that makes bending, colour
// splitting and blur easy to read through the blobs. Replace it with a render
// of your own scene in real use.
//   uBackdrop.x = 0, Checker (this study's default): bold white type on black
//     across the top 40 %, a grey checkerboard with a violet logo tile and
//     coloured discs below. Adapted from the liquid-glass study's
//     backdrop.frag (commit a6f95c6).
//   uBackdrop.x = 1, Type: bold white type and thin lines on black, the same
//     image as the liquid-glass-prism study's backdrop (commit 6a58487), so
//     the presets of every study in the family can be compared on one image.
// Shapes are filled with 1 - smoothstep(-px, px, d): smoothstep needs its
// first edge below the second.

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

// 1 inside a shape whose signed distance is d, 0 outside, soft over a pixel.
float fill(float d, float px)
{
    return 1.0 - smoothstep(-px, px, d);
}

// The Checker backdrop (this study's own).
vec3 checker(vec2 p, float px)
{
    // Lower part: grey checkerboard, like a transparency grid.
    vec2 cell = floor(p * 14.0);
    vec3 c = mix(vec3(0.82), vec3(0.62), mod(cell.x + cell.y, 2.0));

    // Coloured discs.
    c = mix(c, vec3(0.95, 0.15, 0.55), fill(length(p - vec2(-0.55, -0.22)) - 0.12, px));
    c = mix(c, vec3(0.10, 0.75, 0.95), fill(length(p - vec2(0.58, -0.30)) - 0.14, px));
    c = mix(c, vec3(1.00, 0.80, 0.10), fill(length(p - vec2(0.30, -0.36)) - 0.07, px));

    // A violet logo tile with a white bar, like the badge in reference 3.
    float tile = roundBox(p, vec2(-0.06, -0.22), vec2(0.15, 0.13), 0.04);
    c = mix(c, vec3(0.20, 0.12, 0.45), fill(tile, px));
    c = mix(c, vec3(0.78, 0.72, 1.00), fill(roundBox(p, vec2(-0.06, -0.22), vec2(0.09, 0.025), 0.01), px));

    // Upper part: black band with rows of bold white "words", like heavy type.
    float band = smoothstep(-px, px, p.y - 0.1);
    c = mix(c, vec3(0.015), band);
    for (int row = 0; row < 3; row++) {
        float y = 0.17 + 0.125 * float(row);
        float shift = hash21(vec2(float(row), 7.0)) * 0.4;
        float slot = floor((p.x + shift) * 2.6);
        float start = (slot + 0.06) / 2.6 - shift;
        float len = (0.45 + 0.5 * hash21(vec2(float(row), slot))) / 2.6;
        if (hash21(vec2(slot, float(row) + 3.0)) > 0.15) {
            float d = roundBox(p, vec2(start + 0.5 * len, y), vec2(0.5 * len, 0.045), 0.01);
            c = mix(c, vec3(0.96), fill(d, px) * band);
        }
    }

    // A thin white line across the middle, for checking curvature.
    return mix(c, vec3(1.0), fill(abs(p.y + 0.02) - 0.004, px));
}

// Rows of bold "words", like a block of heavy type: 1 on ink, 0 off it.
// Each word is a run of heavy letter blocks; some letters get a counter
// (the hole in an O or an A) or a split stem, so edges come in many sizes.
// From the liquid-glass-prism study's backdrop.frag (commit 6a58487).
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
        ink = max(ink, fill(d, px));
    }
    return ink;
}

// The Type backdrop (the family's shared comparison image): black page, soft
// grey glow, heavy white type, thin rules and a few thin white arcs, so bending
// shows even between the words.
vec3 typePage(vec2 p, float px)
{
    vec3 c = vec3(0.012) + vec3(0.05) * exp(-4.0 * dot(p, p));
    c = mix(c, vec3(0.94), typeBlock(p, px, 0.13, 5.0, 0.36));
    float rule = abs(abs(p.y + 0.445) - 0.025) - 0.003;
    c = mix(c, vec3(0.85), fill(rule, px));
    float arc = abs(length(p - vec2(-0.55, -0.05)) - 0.22) - 0.004;
    c = mix(c, vec3(1.0), fill(arc, px));
    arc = abs(length(p - vec2(0.62, 0.10)) - 0.16) - 0.004;
    return mix(c, vec3(1.0), fill(arc, px));
}

void main()
{
    vec2 uv = vUV.st;
    float aspect = uTDOutputInfo.res.z / uTDOutputInfo.res.w;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float px = 1.5 * uTDOutputInfo.res.y;  // about one pixel, for soft edges
    vec3 c = uBackdrop.x < 0.5 ? checker(p, px) : typePage(p, px);
    fragColor = TDOutputSwizzle(vec4(c, 1.0));
}
