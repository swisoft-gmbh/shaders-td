// Liquid Glass Blobs: GLSL MAT pixel shader for TouchDesigner (GLSL 4.60).
//
// Liquid-glass blobs that drift, merge and split, drawn inside a proxy box.
// The box is ordinary geometry, so TouchDesigner places it with any camera.
// For each pixel of the box this shader marches a ray to the blob surface,
// writes that surface's depth (so other objects pass in front and behind
// correctly), then shades it as glass.
//
// The marching loop, sphere distance, smooth minimum and distance-field
// normal follow Maxime Heckel, "Painting with Math: A Gentle Study of
// Raymarching" (2023), https://blog.maximeheckel.com/posts/painting-with-math-a-gentle-study-of-raymarching/
// The glass look (refraction through a render of the scene, dispersion,
// saturation, fresnel, squared Blinn-Phong) follows his "Refraction,
// dispersion, and other shader light effects" (2023), as adapted by this
// repository's liquid-glass study (commit a6f95c6). sources.json lists what
// was borrowed, what changed and what is new.
//
// Inputs (GLSL MAT > Samplers page):
//   sRefraction  the scene behind the blobs, rendered from the same camera.
//                Its alpha counts: where it is transparent, the glass lets the
//                final render's own background show through instead.
//   sReflection  a 360 panorama or any flat image to reflect
//   sLayout      optional blob layout: pixel i of row 0 = (x, y, z, radius)

// @begin uniforms
uniform sampler2D sRefraction;
uniform sampler2D sReflection;
uniform sampler2D sLayout;

// Lengths are in scene units: the component multiplies Backdrop distance and
// Frost by Object size and divides Tint density and the film swirl frequency
// by it. Object size is the box's size in the world over the family's
// reference radius 1.45 (Fit to Glass geometry counts the Geometry COMP's
// scale), so the shader multiplies the film lookup by that scale
// (worldScale()). The blob shape (radius, spread, merge, droplets, ripple)
// stays in box units: it follows the box, as a mesh follows its SOP.
uniform vec4 uGlass;      // rgb glass colour, a tint density (per scene unit)
uniform vec4 uBody;       // translucency, frost (scene units), opacity, edge tint
uniform vec4 uOptics;     // ior, backdrop distance (scene units), dispersion, saturation
uniform vec4 uReflect;    // rgb reflection tint, a reflection amount
uniform vec4 uEnv;        // map mode (0 panorama, 1 screen, 2 studio), rotation (radians), blur, screen warp
uniform vec4 uSurface;    // mirror, fresnel power, diffuse, energy conserving (0 or 1)
uniform vec4 uRim;        // rgb rim colour, a rim amount
uniform vec4 uLight;      // xyz direction toward the light, w specular amount
uniform vec4 uLightColor; // rgb light colour, w shininess
uniform vec4 uFilm;       // iridescence, film thickness (nm), film variation, film swirl frequency (2.5 / (1.45 x object size); 0 = one thickness, no swirl)
uniform vec4 uBlobs;      // count (a fraction grows the last blob in), radius, spread, merge smoothness
uniform vec4 uShape;      // stretch, droplets (fraction allowed), droplet size, seed
uniform vec4 uMotion;     // unused, ripple, ripple scale, unused
uniform vec4 uPhase;      // drift, added up every frame in Python (presets.py phase()):
                          //   x layout (Speed), wraps at 256 pi; y ripple (0.4 + Speed), wraps at 20 pi;
                          //   z film (0.015 + 0.045 x Speed), wraps at 256; w unused
uniform vec4 uMarch;      // march steps, layout source (0 procedural, 1 layout TOP), samples, flip V
uniform vec4 uState;      // teaching stage, has refraction TOP, has reflection TOP, colours are sRGB (1) or as typed (0)
// @end uniforms

in vec3 vWorldPos;
flat in vec3 vObjOrigin;
flat in vec3 vObjX;
flat in vec3 vObjY;
flat in vec3 vObjZ;
flat in int vCamIndex;
flat in int vInstance;

// One output per colour buffer of the Render TOP (Write a GLSL MAT, "Multiple
// Render Targets"). TouchDesigner defines the count; the fallback keeps the
// file valid in a compiler that does not.
#ifndef TD_NUM_COLOR_BUFFERS
#define TD_NUM_COLOR_BUFFERS 1
#endif
layout(location = 0) out vec4 fragColor[TD_NUM_COLOR_BUFFERS];

const float LG_PI = 3.14159265;

// Which way screen UV runs against projected x and y (+1 or -1 each).
// Measured at the top of main(); see screenSign().
vec2 gScreenSign = vec2(1.0);

// @begin screen
// Where this pixel sits on the render, 0..1 across and up.
// uTDGeneral.viewport holds (x, y, 1/width, 1/height) in pixels.
vec2 screenUV()
{
    vec2 uv = (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw;
    if (uMarch.w > 0.5) uv.y = 1.0 - uv.y;  // escape hatch if a build flips V
    return uv;
}

// Fold coordinates that leave the image back inside it (mirror repeat),
// so strong refraction near the frame edge never smears a border pixel.
vec2 mirrorUV(vec2 uv)
{
    return 1.0 - abs(1.0 - mod(uv, 2.0));
}

// Which way screenUV() runs against the projection's x and y: +1 or -1
// each. TouchDesigner's usual orientation gives +1, +1; a build whose screen
// y (or x) runs the other way would bend light the wrong way without this.
// It is measured per pixel, without guessing: the box point this pixel shows,
// projected by the camera, lands at ndc; the raster says the pixel sits at
// `raster` (same -1..1 range, from gl_FragCoord). Same sign: the raster
// follows the projection; opposite: it is mirrored. On the centre line of a
// render with an odd width or height, both are 0 and cannot be told apart.
// There the sign of `ndcStep`, how ndc changes to the next pixel (screen
// derivatives, taken at the top of main()), decides instead. A derivative is
// only trusted where the box face is not nearly edge-on: `depthStep`, how
// much 1/w changes to the next pixel, stays under 10%. Otherwise, and for a
// value that is not a number, the result is +1. From the Liquid Glass Prism
// study. Flip V turns the measured y around too: it is there for a
// Refraction TOP that arrives upside down, and then every vertical shift
// must turn with the image.
vec2 screenSign(vec2 ndc, vec2 ndcStep, vec2 depthStep)
{
    vec2 raster = 2.0 * (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw - 1.0;
    vec2 runs = vec2(abs(ndc.x + raster.x) < abs(ndc.x - raster.x) ? -1.0 : 1.0,
                     abs(ndc.y + raster.y) < abs(ndc.y - raster.y) ? -1.0 : 1.0);
    // Neighbouring pixel centres are 2 x viewport.zw apart in raster units;
    // only a pixel exactly on a centre line comes within 0.5 x viewport.zw of 0.
    vec2 useStep = step(abs(raster), 0.5 * uTDGeneral.viewport.zw) * step(depthStep, vec2(0.1));
    runs = mix(runs, vec2(ndcStep.x < 0.0 ? -1.0 : 1.0, ndcStep.y < 0.0 ? -1.0 : 1.0), useStep);
    if (uMarch.w > 0.5) runs.y = -runs.y;
    return runs;
}

// Where a world point lands on screen, in the units of screenUV() (only
// differences are used, so the 0.5 offset is left out). The camera's own
// matrix does the work, so every projection works: perspective, orthographic
// or anything in between. gScreenSign turns projected directions into
// screen UV directions, so a shift points the way screenUV() counts even in
// a build whose raster or projection runs the other way.
vec2 toScreen(vec3 p, mat4 camProj)
{
    vec4 c = camProj * vec4(p, 1.0);
    return 0.5 * c.xy / max(c.w, 1e-4) * gScreenSign;
}

// How far apart two world points land on screen (in 0..1 units).
// Zero when both lie on one camera ray.
vec2 screenShift(vec3 target, vec3 origin, mat4 camProj)
{
    return toScreen(target, camProj) - toScreen(origin, camProj);
}

// How far one scene unit moves on screen at a point whose clip-space w is w
// (its depth along the view for a perspective camera, 1 for orthographic).
vec2 unitsToUV(mat4 proj, float w)
{
    return 0.5 * abs(vec2(proj[0][0], proj[1][1])) / max(w, 1e-4);
}
// @end screen

// @begin layout
const float BOX = 1.0;        // the proxy box spans -1..1 in object space (Box SOP, size 2)
const int MAX_BLOBS = 12;
const int MAX_DROPS = 6;

vec4 gBlob[MAX_BLOBS];        // xyz centre, w radius (object units)
vec3 gAxis[MAX_BLOBS];        // half-length axis of each capsule (zero length = sphere)
float gBlend[MAX_BLOBS];      // merge width of each blob
vec4 gDrop[MAX_DROPS];        // droplets: xyz centre, w radius
float gDropBlend[MAX_DROPS];
int gBlobCount;
int gDropCount;

// Repeatable pseudo-random number in 0..1 from three integers.
float hash(int a, int b, int c)
{
    uint h = (uint(a) * 73856093u) ^ (uint(b) * 19349663u) ^ (uint(c) * 83492791u);
    h ^= h >> 16; h *= 0x7feb352du;
    h ^= h >> 15; h *= 0x846ca68bu;
    h ^= h >> 16;
    return float(h) * (1.0 / 4294967295.0);
}

vec3 hash3(int i, int salt, int seed)
{
    return vec3(hash(i, salt, seed), hash(i, salt + 1, seed), hash(i, salt + 2, seed));
}

// A unit vector from any vector; falls back to +Y if it is (nearly) zero.
vec3 safeDirection(vec3 v)
{
    float l = length(v);
    return l > 1e-4 ? v / l : vec3(0.0, 1.0, 0.0);
}

// A unit vector from a direction moved between the box's space and world
// space. Its length follows the object's scale (1 / scale for a normal), so a
// fixed threshold would fail on big objects: only an exact zero falls back.
vec3 movedDirection(vec3 v)
{
    float l2 = dot(v, v);
    return l2 > 0.0 ? v * inversesqrt(l2) : vec3(0.0, 1.0, 0.0);
}

// Clamp a centre so a shape reaching `extent` around it stays inside the box.
// A shape too big for the box is centred, and the box walls cut it flat
// (see blobField).
vec3 keepInside(vec3 c, float extent)
{
    float room = max(BOX - extent, 0.0);
    return clamp(c, vec3(-room), vec3(room));
}

// Drift speeds rounded to whole multiples of 1/128. Every wave below then
// repeats after 256 pi of drift phase, so uPhase.x can wrap there (in Python,
// in double precision) without a jump, and the shader never sees a large,
// imprecise time value.
float loopRate(float r) { return floor(r * 128.0 + 0.5) / 128.0; }
vec3 loopRate(vec3 r) { return floor(r * 128.0 + 0.5) / 128.0; }

// Work out every blob and droplet once per pixel, before marching.
// Each blob drifts on its own slow three-axis wave; a fractional count
// grows the last blob in from nothing, so Count can be animated or morphed.
// t is the drift phase: Speed added up over time by presets.py phase().
void buildLayout()
{
    float count = clamp(uBlobs.x, 0.0, float(MAX_BLOBS));
    float radius = uBlobs.y;
    float spread = uBlobs.z;
    float k = uBlobs.w;
    float stretch = uShape.x;
    int seed = int(uShape.w + 0.5) + 7919 * vInstance;  // each instance gets its own layout
    bool useTop = uMarch.y > 0.5;
    int topCount = useTop ? textureSize(sLayout, 0).x : 0;
    float t = uPhase.x;

    gBlobCount = int(ceil(count));
    for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= gBlobCount) break;
        float fade = clamp(count - float(i), 0.0, 1.0);
        vec3 freq = 0.35 + 0.65 * hash3(i, 1, seed);
        vec3 phase = 6.2831853 * hash3(i, 4, seed);
        vec3 c = spread * sin(loopRate(freq) * t + phase);
        float r = radius * (i == 0 ? 1.0 : 0.55 + 0.45 * hash(i, 7, seed));
        if (useTop && i < topCount) {
            vec4 row = texelFetch(sLayout, ivec2(i, 0), 0);
            c = row.xyz;
            r = max(row.w, 0.0);
        }
        r *= fade;
        vec3 axis = safeDirection(sin(loopRate(0.6 * freq.yzx) * t + phase.zxy)) * stretch * r;
        gBlob[i] = vec4(keepInside(c, r + length(axis) + 0.25 * k + 0.01), r);
        gAxis[i] = axis;
        gBlend[i] = k * fade;
    }

    // Droplets circle the box's centre, mostly in its XY plane (the plane
    // facing a camera on +Z), with a small wobble in depth. Their orbit sits
    // just outside where the main blob is at Spread 0: there each one's gap
    // breathes between touching (it merges in) and about two droplet radii
    // (it splits off). With more Spread the body wanders, so the gap varies more.
    float drops = clamp(uShape.y, 0.0, float(MAX_DROPS));
    gDropCount = int(ceil(drops));
    for (int j = 0; j < MAX_DROPS; j++) {
        if (j >= gDropCount) break;
        float fade = clamp(drops - float(j), 0.0, 1.0);
        vec3 freq = 0.45 + 0.75 * hash3(j, 10, seed);
        vec3 phase = 6.2831853 * hash3(j, 13, seed);
        float angle = phase.x + loopRate(0.6 * (freq.y - 0.8)) * t;
        vec3 dir = safeDirection(vec3(cos(angle), sin(angle), 0.35 * sin(loopRate(freq.z) * t + phase.z)));
        float r = uShape.z * radius * (0.6 + 0.4 * hash(j, 17, seed)) * fade;
        float gap = r * (2.2 * (0.5 + 0.5 * sin(loopRate(1.1 * freq.x) * t + phase.y)) - 0.2);
        float orbit = 0.7 * spread + radius + r + gap;
        gDrop[j] = vec4(keepInside(dir * orbit, r + 0.125 * k + 0.01), r);
        gDropBlend[j] = 0.5 * k * fade;
    }
}
// @end layout

// @begin field
// Distance from p to a capsule: a segment of half-length |halfAxis| around c,
// thickened by r. With halfAxis = 0 it is Heckel's sphere: length(p - c) - r.
float sdCapsule(vec3 p, vec3 c, vec3 halfAxis, float r)
{
    vec3 pa = p - (c - halfAxis);
    vec3 ba = 2.0 * halfAxis;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

// Heckel's polynomial smooth minimum: shapes closer than k melt together.
// k = 0 is a plain union; it is handled first so nothing divides by zero.
float smoothMin(float a, float b, float k)
{
    if (k < 1e-4) return min(a, b);
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Small travelling ripples on the surface (0 = smooth). t is the ripple
// phase; 1.7, 1.3 and 1.1 times 20 pi are whole turns, so it wraps at 20 pi.
// Ripple and Ripple scale are in box units, like Radius and Merge: the ripple
// moves the surface (the silhouette, the depth and the measured path), so it
// is part of the shape, and the shape follows the box. Object size does not
// change it (the film below, a colour pattern, does follow Object size).
float ripple(vec3 p)
{
    float a = 0.04 * uMotion.y;
    float s = uMotion.z;
    float t = uPhase.y;
    return a * sin(s * p.x + 1.7 * t) * sin(s * p.y - 1.3 * t) * sin(s * p.z + 1.1 * t);
}

// Distance to the proxy box's walls, pulled in by a hair: negative inside.
float sdBox(vec3 p)
{
    vec3 q = abs(p) - vec3(BOX - 0.001);
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// The whole scene as one distance: negative inside the glass, positive outside.
float blobField(vec3 p)
{
    float d = 2.0 * BOX + 1.0;  // farther than anything in the box
    for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= gBlobCount) break;
        d = smoothMin(d, sdCapsule(p, gBlob[i].xyz, gAxis[i], gBlob[i].w), gBlend[i]);
    }
    for (int j = 0; j < MAX_DROPS; j++) {
        if (j >= gDropCount) break;
        d = smoothMin(d, length(p - gDrop[j].xyz) - gDrop[j].w, gDropBlend[j]);
    }
    if (uMotion.y > 0.0) d += ripple(p);
    // Keep only the glass inside the box: a blob too big for the box gets a
    // flat glass face where a wall cuts it, instead of a hole.
    return max(d, sdBox(p));
}

// Ripples make the field change faster than distance: their slope is at most
// 0.04 x Ripple x Ripple scale. Steps are divided by a safe bound on that
// (1 + 1.75 times it), then shortened by another 10 %. The smooth minimum and
// the box cut never need this (their slope is at most 1).
float stepScale()
{
    return 0.9 / (1.0 + 0.04 * uMotion.y * uMotion.z * 1.75);
}
// @end field

// @begin normal
// The field grows fastest straight out of the surface, so its gradient is
// the normal. Four samples on a tetrahedron estimate it (Inigo Quilez).
vec3 fieldNormal(vec3 p)
{
    const float h = 0.002;
    const vec2 k = vec2(1.0, -1.0);
    return safeDirection(k.xyy * blobField(p + k.xyy * h) + k.yyx * blobField(p + k.yyx * h)
                       + k.yxy * blobField(p + k.yxy * h) + k.xxx * blobField(p + k.xxx * h));
}
// @end normal

// @begin march
const float SURFACE_EPS = 0.0015;  // "close enough", in object units (the box is 2 wide)

// Where a ray enters and leaves the proxy box (slab method).
vec2 boxInterval(vec3 ro, vec3 rd)
{
    vec3 s = vec3(rd.x < 0.0 ? -1.0 : 1.0, rd.y < 0.0 ? -1.0 : 1.0, rd.z < 0.0 ? -1.0 : 1.0);
    vec3 inv = 1.0 / (s * max(abs(rd), vec3(1e-7)));
    vec3 t0 = (vec3(-BOX) - ro) * inv;
    vec3 t1 = (vec3(BOX) - ro) * inv;
    vec3 near = min(t0, t1);
    vec3 far = max(t0, t1);
    return vec2(max(max(near.x, near.y), near.z), min(min(far.x, far.y), far.z));
}

// Sphere tracing: step forward by the distance to the nearest surface until
// that distance is tiny (a hit) or the ray leaves the box (a miss). It also
// remembers how close a missing ray came, for the antialiased silhouette.
bool marchSurface(vec3 ro, vec3 rd, vec2 span, out float t, out int steps,
                  out float nearMiss, out float nearT)
{
    int budget = clamp(int(uMarch.x + 0.5), 8, 256);
    float scale = stepScale();
    t = span.x;
    steps = 0;
    nearMiss = 1e9;
    nearT = span.x;
    for (int i = 0; i < 256; i++) {
        if (i >= budget || t > span.y) break;
        float d = blobField(ro + rd * t);
        steps = i + 1;
        if (d < SURFACE_EPS) {
            // Already inside glass at the first step: the ray starts at the
            // near plane inside a blob (a box wall never starts inside, as the
            // field cuts the glass just inside the walls). Draw nothing.
            if (i == 0 && d < 0.0) return false;
            // Settle onto the surface: two Newton steps along the ray (the field
            // falls at rate dot(normal, rd) as the ray goes in).
            for (int j = 0; j < 2; j++) {
                vec3 p = ro + rd * t;
                t -= blobField(p) / min(dot(fieldNormal(p), rd), -0.05);
            }
            return true;
        }
        if (d < nearMiss) { nearMiss = d; nearT = t; }
        t += d * scale;
    }
    return false;
}
// @end march


// @begin interior
// Inside the glass the field is negative and -field is the distance to the
// nearest wall. March until it reaches zero again: that is where the ray
// leaves the glass. Returns the distance travelled inside (object units).
float marchInside(vec3 p, vec3 d, float limit)
{
    int budget = clamp(int(uMarch.x + 0.5), 8, 256);
    float scale = stepScale();
    float t = SURFACE_EPS;
    bool entered = false;     // deeper than SURFACE_EPS at least once
    float previous = -1e9;
    for (int i = 0; i < 256; i++) {
        if (i >= budget || t >= limit) break;
        float inside = -blobField(p + d * t);
        if (inside > SURFACE_EPS) {
            entered = true;
        } else if (entered) {
            // Back at a wall: settle onto it with two Newton steps, as on the way in.
            for (int j = 0; j < 2; j++) {
                vec3 q = p + d * t;
                t -= blobField(q) / max(dot(fieldNormal(q), d), 0.05);
            }
            return clamp(t, 0.0, limit);
        } else if (inside < previous) {
            return clamp(t, 0.0, limit);  // never got in: the ray only grazed the glass
        }
        previous = inside;
        t += max(abs(inside) * scale, SURFACE_EPS);
    }
    return clamp(t, 0.0, limit);
}
// @end interior

// @begin bend
// Follow one colour of light through the glass: it bends in at the front
// surface (normal n), crosses `chord` scene units, bends out at the back
// surface (normal nExit, pointing out), then travels `backdrop` units to the
// scene behind. Returns where that point lands on screen, relative to here.
vec2 lensShift(vec3 eye, vec3 n, vec3 P, float chord, vec3 nExit, float ior, float backdrop,
               mat4 camProj)
{
    vec3 inside = refract(eye, n, 1.0 / ior);
    if (dot(inside, inside) < 0.5) inside = eye;
    vec3 exitPoint = P + inside * chord;
    vec3 outside = refract(inside, -nExit, ior);
    if (dot(outside, outside) < 0.5) outside = reflect(inside, -nExit);  // total internal reflection
    return screenShift(exitPoint + outside * backdrop, P, camProj);
}
// @end bend

// @begin dispersion
// Weight of one spectrum sample in R, G and B: w = 0 is red, w = 1 is violet.
vec3 spectrum(float w)
{
    vec3 c = clamp(1.0 - abs(w - vec3(0.1, 0.45, 0.8)) * vec3(2.4, 2.8, 2.4), 0.0, 1.0);
    c.r += 0.6 * clamp(1.0 - abs(w - 1.0) * 5.0, 0.0, 1.0);  // violet also excites red
    return c * c * (3.0 - 2.0 * c) + 0.02;
}

// Point i of N on a unit disc, spread evenly for any N: angle and area come
// from two different irrational steps (Martin Roberts' "R2" sequence, built
// on the plastic number), so the points never line up on one spiral arm and
// their average stays near the centre (frost blurs without shifting).
vec2 discPoint(int i)
{
    vec2 f = fract(0.5 + float(i) * vec2(0.7548776662, 0.5698402910));
    float angle = 2.0 * LG_PI * f.x;
    return vec2(cos(angle), sin(angle)) * sqrt(f.y);
}

// Many slightly different paths through the glass, one per spectrum sample:
// violet bends more than red (dispersion). discPoint() spreads the same
// samples over a disc, which blurs the view (frost). Every sample reads a
// mipmap level as wide as the gap to its neighbours on the frost disc, or a
// quarter of the gap to its neighbours on the rainbow fan, so colours and
// blur blend continuously instead of showing separate copies. (A level as
// wide as the whole fan gap also blurs across the fan; against a 64-sample
// reference, a quarter of it measured closest: see decisions.json.)
// The result keeps the Refraction TOP's alpha:
// rgb stays premultiplied, and a says how much of the view through the
// glass that TOP actually covers. The Samples control stops at 32; the loop
// accepts 64, so a test can render a finer reference.
vec4 transmitted(vec3 eye, vec3 n, vec3 P, float chord, vec3 nExit, vec2 uv, vec2 toUV,
                 mat4 camProj)
{
    int count = clamp(int(uMarch.z + 0.5), 1, 64);
    float spread = uOptics.z * 0.3;
    float colourSplit = clamp(uOptics.z * 4.0, 0.0, 1.0);
    vec2 texSize = vec2(textureSize(sRefraction, 0));
    vec2 blurPixels = uBody.y * 0.25 * abs(toUV) * texSize;
    float frostGap = 2.0 * max(blurPixels.x, blurPixels.y) / sqrt(float(count));
    float red = max(uOptics.x - 0.5 * spread, 1.0);
    float violet = max(uOptics.x + 0.5 * spread, 1.0);
    vec2 fan = lensShift(eye, n, P, chord, nExit, violet, uOptics.y, camProj)
             - lensShift(eye, n, P, chord, nExit, red, uOptics.y, camProj);
    float fanGap = 0.25 * length(fan * texSize) / float(count);
    float lod = log2(max(max(frostGap, fanGap), 1.0));
    vec3 sum = vec3(0.0);
    vec3 weightSum = vec3(0.0);
    float alphaSum = 0.0;
    for (int i = 0; i < 64; i++) {
        if (i >= count) break;
        float w = (float(i) + 0.5) / float(count);
        // Never below 1: below it the bend flips and snaps to zero past the critical angle.
        float ior = max(uOptics.x + spread * (w - 0.5), 1.0);
        vec2 offset = lensShift(eye, n, P, chord, nExit, ior, uOptics.y, camProj);
        offset += discPoint(i) * uBody.y * 0.25 * toUV;
        vec3 weight = mix(vec3(1.0), spectrum(w), colourSplit);
        vec4 seen = textureLod(sRefraction, mirrorUV(uv + offset), lod);
        sum += seen.rgb * weight;
        weightSum += weight;
        alphaSum += seen.a;
    }
    return vec4(sum / weightSum, alphaSum / float(count));
}

vec3 saturateColour(vec3 c, float amount)
{
    float luma = dot(c, vec3(0.2125, 0.7154, 0.0721));
    return max(mix(vec3(luma), c, amount), 0.0);
}
// @end dispersion

// @begin body
// Colour parameters reach the shader as typed. In a project with a linear
// working colour space, uState.w asks for the sRGB-to-linear conversion that
// TouchDesigner applies to its own colour parameters (Inputs > Colour parameters).
vec3 paramColour(vec3 c)
{
    if (uState.w < 0.5) return c;
    vec3 low = c / 12.92;
    vec3 high = pow((max(c, 0.0) + 0.055) / 1.055, vec3(2.4));
    return mix(low, high, step(vec3(0.04045), c));
}

// Light that crossed the glass loses the colours the glass absorbs
// (Beer-Lambert): a longer path through tinted glass gives a deeper tint.
// The colour is clamped to 0..1 here: a glass colour above 1 can brighten the
// body, but it never amplifies the light passing through.
vec3 absorption(float path)
{
    vec3 passes = clamp(paramColour(uGlass.rgb), 0.0, 1.0);
    return exp(-(1.0 - passes) * uGlass.a * path);
}

// The glass's own colour where it scatters light instead of passing it.
vec3 bodyColour(vec3 n, vec3 lightDir)
{
    float wrap = clamp((dot(n, lightDir) + 0.5) / 1.5, 0.0, 1.0);
    return paramColour(uGlass.rgb) * paramColour(uLightColor.rgb) * (0.25 + 0.75 * wrap);
}
// @end body

// @begin reflection
// Built-in studio: a dark room with soft white light strips. Used when the
// map mode is Studio, or when no reflection TOP is connected.
// (env.frag bakes the same studio into the demo panorama; keep them in sync.)
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

// soft > 0 widens every light edge, which is how the studio blurs.
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

// Equirectangular lookup in this study's convention: u = 0 faces +X, then +Z;
// v = 0 is straight down. env.frag bakes the demo panorama the same way.
// Not yet compared with TouchDesigner's own environment lighting; Panorama
// rotation turns the map if your panorama is offset.
vec2 panoramaUV(vec3 d)
{
    float u = azimuth(d) / (2.0 * LG_PI);
    float v = 0.5 + asin(clamp(d.y, -1.0, 1.0)) / LG_PI;
    return vec2(fract(u), v);
}

// viewSign: which way camera-space x and y run in screen UV (see main()).
vec3 environmentSample(vec3 d, vec2 uv, mat3 view, vec2 viewSign, float blur)
{
    int mode = int(uEnv.x + 0.5);
    float c = cos(uEnv.y);
    float s = sin(uEnv.y);
    vec3 r = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);  // rotate around +Y
    if (uState.z < 0.5 || mode == 2) return studio(r, 0.15 * blur);
    // Mipmap level about as wide as the gap between the 8 blur directions.
    // A flat image moves 2.5 x Flat image warp times further per direction than
    // a panorama, so its level widens by that factor.
    float spread = mode == 1 ? max(1.0, 2.5 * uEnv.w) : 1.0;
    float lod = log2(max(blur * 0.05 * spread * float(textureSize(sReflection, 0).x), 1.0));
    if (mode == 1) {
        vec3 rv = view * d;  // reflection direction as seen by the camera
        return textureLod(sReflection, mirrorUV(uv + rv.xy * viewSign * uEnv.w * 0.5), lod).rgb;
    }
    return textureLod(sReflection, panoramaUV(r), lod).rgb;
}

// Average a few nearby directions for blurry (rough) reflections.
vec3 environment(vec3 R, vec2 uv, mat3 view, vec2 viewSign)
{
    float blur = uEnv.z;
    if (blur <= 0.001) return environmentSample(R, uv, view, viewSign, 0.0);
    vec3 t = normalize(cross(abs(R.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), R));
    vec3 b = cross(R, t);
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        float a = float(i) * 2.39996;
        float r = sqrt((float(i) + 0.5) / 8.0) * blur * 0.4;
        sum += environmentSample(normalize(R + (t * cos(a) + b * sin(a)) * r), uv, view, viewSign, blur);
    }
    return sum / 8.0;
}
// @end reflection

// @begin light
// Heckel-style Blinn-Phong: squaring the half-vector term gives a tight,
// glassy highlight. The rim is a fresnel glow toward the silhouette.
vec3 highlights(vec3 n, vec3 eye, vec3 lightDir, float fresnel)
{
    vec3 h = lightDir - eye;
    float hh = dot(h, h);
    h = hh > 1e-12 ? h * inversesqrt(hh) : vec3(0.0);  // light straight behind: no highlight
    float nh = max(dot(n, h), 0.0);
    float spec = pow(nh * nh, uLightColor.w) * uLight.w;
    float diffuse = max(dot(n, lightDir), 0.0) * uSurface.z;
    return paramColour(uLightColor.rgb) * (spec + diffuse) + paramColour(uRim.rgb) * uRim.a * fresnel;
}
// @end light

// @begin film
// The noise lattice repeats every 256 units (cells -128..127, then again),
// so shifting the noise by 256 changes nothing: the film drift in uPhase.z
// can wrap around without a jump.
float latticeHash(ivec3 c)
{
    ivec3 q = ((c + 128) & 255) - 128;
    return hash(q.x, q.y, q.z);
}

// Smooth 3D value noise in 0..1, for the film's swirl.
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

// Thin-film interference, as on a soap bubble or an oil slick. A film of a
// given thickness reflects some wavelengths strongly and cancels others.
vec3 thinFilm(float cosView, float thicknessNm)
{
    const float filmIor = 1.33;
    float sinT2 = (1.0 - cosView * cosView) / (filmIor * filmIor);
    float cosT = sqrt(max(1.0 - sinT2, 0.0));
    float path = 2.0 * filmIor * thicknessNm * cosT;          // optical path difference, nm
    vec3 wavelength = vec3(650.0, 532.0, 450.0);              // red, green, blue, nm
    return 0.5 - 0.5 * cos(2.0 * LG_PI * path / wavelength);  // half-wave shift at the top surface
}

// The Geometry COMP's scale (its parents' included) as one number: the cube
// root of how much its world transform changes a volume. 1 when unscaled.
// The same function as the family's (an instance's own scale is not in it).
float worldScale()
{
    return pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0);
}

// Film thickness swirls over the blobs so the colours form bands; the swirl
// drifts upward by uPhase.z. pObj x worldScale() is the position in scene
// units and uFilm.w the swirls per scene unit, 2.5 / (1.45 x Object size).
// So a box fitted to its size shows 2.5 swirls per box unit at any scale,
// and a hand-set Object size scales the swirl like the lengths. uFilm.w = 0
// gives one film thickness over all the blobs, which still drifts with
// uPhase.z; Pause stops the drift.
float filmThickness(vec3 pObj)
{
    float swirl = valueNoise(pObj * uFilm.w * worldScale() + vec3(0.0, uPhase.z, 0.0)) * 2.0 - 1.0;
    return uFilm.y * (1.0 + uFilm.z * swirl);
}
// @end film

// True for NaN or infinity: all exponent bits set. isnan() and isinf() can be
// folded away by compilers that assume finite maths (Metal's fast math, which
// MoltenVK uses by default on macOS), so the finite-check stage tests bits.
bool notFinite(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
bool notFinite(vec3 v) { return notFinite(v.x) || notFinite(v.y) || notFinite(v.z); }

// The world point on this pixel's camera ray at a depth (0 = near plane, 1 = far).
vec3 rayPoint(vec2 ndc, float depth)
{
    vec4 p = uTDMats[vCamIndex].camProjInverse * vec4(ndc, depth, 1.0);
    return p.xyz / p.w;
}

// Near a silhouette a normal can tilt slightly away from the camera, and then
// refract() bends even at IOR 1. Lay any such normal back into the view plane
// (a flip would reverse its sideways part as well).
vec3 faceCamera(vec3 n, vec3 eye)
{
    float away = dot(n, eye);
    return away > -0.01 ? safeDirection(n - eye * (away + 0.01)) : n;
}

// Every output goes through here: the glass to colour buffer 0, zeros to any
// extra buffers of the Render TOP. Colour is capped at 1024 so a 16-bit float
// target (largest value 65,504) never overflows; alpha is left alone.
void writeOutput(vec4 c)
{
    fragColor[0] = TDOutputSwizzle(vec4(min(c.rgb, vec3(1024.0)), c.a));
    // Each index is a constant, as some GPU backends require, and never goes
    // past the buffer count (Write a GLSL MAT warns that writing beyond it can
    // corrupt the output).
#if TD_NUM_COLOR_BUFFERS > 1
    fragColor[1] = vec4(0.0);
#endif
#if TD_NUM_COLOR_BUFFERS > 2
    fragColor[2] = vec4(0.0);
#endif
#if TD_NUM_COLOR_BUFFERS > 3
    fragColor[3] = vec4(0.0);
#endif
#if TD_NUM_COLOR_BUFFERS > 4
    fragColor[4] = vec4(0.0);
#endif
#if TD_NUM_COLOR_BUFFERS > 5
    fragColor[5] = vec4(0.0);
#endif
#if TD_NUM_COLOR_BUFFERS > 6
    fragColor[6] = vec4(0.0);
#endif
#if TD_NUM_COLOR_BUFFERS > 7
    fragColor[7] = vec4(0.0);
#endif
}

void main()
{
    // @begin setup
    mat4 cam = uTDMats[vCamIndex].cam;
    mat4 proj = uTDMats[vCamIndex].proj;
    mat4 camProj = uTDMats[vCamIndex].camProj;

    // This pixel's camera ray, from the camera's own matrices, so any
    // projection works (perspective, orthographic, blended or custom).
    // vWorldPos, the box point this pixel shows, lies on the ray. The ray
    // starts where it crosses the near plane, so nothing nearer than the near
    // plane is drawn, just as with ordinary geometry.
    vec4 clipBox = camProj * vec4(vWorldPos, 1.0);
    vec2 ndc = clipBox.xy / clipBox.w;
    // Screen derivatives come first, while all four pixels of each 2 x 2 block
    // still run the same code: inside a branch they are undefined. They decide
    // the screen orientation on a centre line (screenSign()).
    float invW = 1.0 / clipBox.w;
    vec2 ndcStep = vec2(dFdx(ndc.x), dFdy(ndc.y));
    vec2 depthStep = abs(vec2(dFdx(invW), dFdy(invW)) / invW);
    gScreenSign = screenSign(ndc, ndcStep, depthStep);
    TDCheckDiscard();

    vec3 rayStart = rayPoint(ndc, 0.0);
    // Depth 0 is the near plane (Write a GLSL MAT: "Vulkan style"). Should a
    // build ever reverse that, depth 0 lies beyond the box point: use depth 1.
    if ((cam * vec4(rayStart, 1.0)).z < (cam * vec4(vWorldPos, 1.0)).z) rayStart = rayPoint(ndc, 1.0);
    vec3 eye = safeDirection(vWorldPos - rayStart);  // view direction, world space

    // The box's own space ("object space"): the blobs live here.
    mat3 toWorld = mat3(vObjX, vObjY, vObjZ);
    mat3 toObject = inverse(toWorld);
    vec3 ro = toObject * (rayStart - vObjOrigin);
    vec3 rd = normalize(toObject * eye);
    vec2 span = boxInterval(ro, rd);
    span.x = max(span.x, 0.0);  // camera inside the box: start at the near plane

    buildLayout();
    int stage = int(uState.x + 0.5);
    // @end setup

    // @begin hit
    float t = 0.0;
    int steps = 0;          // stays 0 if the ray misses the box (no march runs)
    float nearMiss = 1e9;
    float nearT = 0.0;
    bool hit = span.x < span.y && marchSurface(ro, rd, span, t, steps, nearMiss, nearT);

    // Antialiased silhouette (final image only): a ray that misses by less than
    // half a pixel still covers part of the pixel. Shade it at its closest point
    // and fade it by that fraction. Teaching stages keep the hard edge.
    float coverage = 1.0;
    if (!hit && stage == 0 && span.x < span.y) {
        // One pixel's size in scene units at the closest point: it grows with
        // clip-space w (depth, for a perspective camera; 1 for orthographic).
        float w = (camProj * vec4(vObjOrigin + toWorld * (ro + rd * nearT), 1.0)).w;
        float pixel = 2.0 * uTDGeneral.viewport.w * max(w, 1e-4) / abs(proj[1][1]);
        float rayScale = length(toWorld * rd);  // scene units per object unit along this ray
        coverage = clamp(0.5 - nearMiss * rayScale / pixel, 0.0, 1.0);
        hit = coverage > 0.0;
        t = nearT;
    }
    if (!hit) {
        // Teaching stages 1, 2 and 12 also show the empty part of the box.
        if (stage == 1 || stage == 2 || stage == 12) {
            float cost = float(steps) / clamp(uMarch.x, 8.0, 256.0);
            vec3 c = stage == 2 ? vec3(cost, cost * cost, 0.35) : vec3(0.10, 0.13, 0.20);
            gl_FragDepth = gl_FragCoord.z;
            writeOutput(vec4(c, 1.0));
            return;
        }
        discard;
    }
    vec3 pObj = ro + rd * t;                         // the hit, in object space
    vec3 P = vObjOrigin + toWorld * pObj;            // the hit, in world space
    vec3 n = faceCamera(movedDirection(transpose(toObject) * fieldNormal(pObj)), eye);

    // Write the depth a rasterized surface at P would have, so other objects
    // sort correctly against the blobs. TouchDesigner's projection matrices
    // map depth to 0..1 (Vulkan style), the range gl_FragDepth expects.
    vec4 clip = camProj * vec4(P, 1.0);
    float depth = clamp(clip.z / clip.w, 0.0, 1.0);
    gl_FragDepth = depth;
    // @end hit

    // @begin through
    // Bend into the glass, march to the far wall, measure the real path.
    float ior = max(uOptics.x, 1.0);
    vec3 inside = refract(eye, n, 1.0 / ior);
    vec3 insideObj = movedDirection(toObject * inside);
    float s = marchInside(pObj, insideObj, max(boxInterval(pObj, insideObj).y, 0.0));
    vec3 qObj = pObj + insideObj * s;
    float chord = length(toWorld * (qObj - pObj));   // path inside the glass, scene units
    vec3 nExit = movedDirection(transpose(toObject) * fieldNormal(qObj));
    if (dot(nExit, inside) < 0.0) nExit = -nExit;    // point it out of the glass
    // @end through

    // @begin compose
    vec2 uv = screenUV();
    vec2 toUV = unitsToUV(proj, clip.w);
    bool hasRefraction = uState.y > 0.5;
    mat3 view = mat3(cam);
    // Camera-space x and y to screen UV directions, for the flat-image reflection.
    vec2 viewSign = gScreenSign * vec2(proj[0][0] < 0.0 ? -1.0 : 1.0, proj[1][1] < 0.0 ? -1.0 : 1.0);
    vec3 lightDir = safeDirection(uLight.xyz);  // (0, 0, 0) means straight up
    float NdotV = clamp(dot(n, -eye), 0.0, 1.0);
    float fresnel = pow(1.0 - NdotV, uSurface.y);

    // The scene behind, bent through the glass. `covered` is the Refraction
    // TOP's alpha there: 0 where that TOP is transparent or not connected.
    vec3 through = vec3(0.0);
    float covered = 0.0;
    if (hasRefraction) {
        vec4 behind = transmitted(eye, n, P, chord, nExit, uv, toUV, camProj);
        through = saturateColour(behind.rgb, uOptics.w);
        covered = behind.a;
    }

    // Edge tint lengthens the light path at grazing angles (deep-coloured rims).
    float path = chord * (1.0 + uBody.w * (1.0 / max(NdotV, 0.15) - 1.0));
    vec3 tint = absorption(path);
    vec3 body = bodyColour(n, lightDir);
    float translucency = uBody.x;

    vec3 film = thinFilm(NdotV, filmThickness(pObj));
    vec3 filmTint = mix(vec3(1.0), 2.0 * film, uFilm.x);

    float r0 = (ior - 1.0) / (ior + 1.0);
    float reflectance = mix(mix(r0 * r0, 1.0, fresnel), 1.0, uSurface.x);
    vec3 env = environment(reflect(eye, n), uv, view, viewSign);
    vec3 reflection = env * paramColour(uReflect.rgb) * uReflect.a * reflectance * filmTint;
    vec3 glow = highlights(n, eye, lightDir, fresnel)
              + film * uFilm.x * 0.3 * (0.3 + 0.7 * fresnel);
    // Energy conserving (off by default, like Heckel's additive glow): light the
    // surface reflects no longer also passes through it, so Mirror 1 is a mirror.
    float keep = 1.0 - uSurface.w * clamp(reflectance, 0.0, 1.0);

    // Light crossing the glass comes from the Refraction TOP where it has
    // content. For the rest (covered < 1) there is nothing to bend: the glass
    // lets whatever is behind it in this render show through by blending.
    // Alpha drops by the share that passes; the tint can only darken it as a whole.
    float seeThrough = translucency * (1.0 - covered) * dot(tint, vec3(1.0 / 3.0));
    vec3 colour = (body * (1.0 - translucency) + through * tint * translucency
                   + paramColour(uGlass.rgb) * (translucency * (1.0 - covered) - seeThrough)) * keep
                + reflection + glow;
    float alpha = 1.0 - seeThrough * keep;

    // Premultiplied output: opacity fades the whole glass, reflections included;
    // coverage fades the antialiased edge.
    colour *= uBody.z * coverage;
    alpha *= uBody.z * coverage;

    // The Camera COMP's fog (TDFog changes nothing while fog is off). TDFog
    // takes an unpremultiplied colour; fogging black gives the fog colour it
    // adds, and the glass may only add its own share (alpha) of that.
    vec3 fogAdded = TDFog(vec4(0.0, 0.0, 0.0, 1.0), P, vCamIndex).rgb;
    colour = TDFog(vec4(colour, 1.0), P, vCamIndex).rgb - fogAdded * (1.0 - alpha);
    // @end compose

    // @begin stages
    if (stage > 0) {
        if (stage == 1) colour = vec3(0.92);
        else if (stage == 2) { float cost = float(steps) / clamp(uMarch.x, 8.0, 256.0); colour = vec3(cost, cost * cost, 1.0); }
        else if (stage == 3) colour = n * 0.5 + 0.5;
        else if (stage == 4) colour = vec3(depth);
        else if (stage == 5) colour = vec3(chord * 0.5);
        else if (stage == 6) colour = through;
        else if (stage == 7) colour = mix(body, through * tint, translucency);
        else if (stage == 8) colour = reflection;
        else if (stage == 9) colour = vec3(fresnel);
        else if (stage == 10) colour = film;
        else if (stage == 11) colour = vec3(uv, 0.0);
        else {
            bool finite = !(notFinite(depth) || notFinite(chord) || notFinite(n) || notFinite(colour));
            colour = finite ? vec3(0.1, 0.9, 0.3) : vec3(1.0, 0.0, 0.0);
        }
        alpha = 1.0;
    }
    writeOutput(vec4(colour, alpha));
    // @end stages
}
