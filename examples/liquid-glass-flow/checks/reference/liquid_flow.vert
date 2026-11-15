// Liquid Glass Flow: GLSL MAT vertex shader for TouchDesigner (GLSL 4.60).
//
// Moves every vertex of any mesh with an animated liquid field (swell,
// ripples, travelling waves and a gravity sag), then rebuilds the normal of
// the moved surface. The silhouette itself flows, and the glass look in
// liquid_flow.frag refracts and reflects off the new shape.
//
// Grounding (details in sources.json):
//   displacement by a noise of the position, Maxime Heckel, "The Study of
//   Shaders with React Three Fiber" (Blob); normals rebuilt from displaced
//   neighbours (Marco Fugaro's method), Heckel, "Caustics in WebGL" and
//   "Field Guide to TSL and WebGPU". The TouchDesigner code is new.

// @begin flow_uniforms
uniform vec4 uFlow;        // amplitude (x object size), unused, direction (0 normal, 1 from centre), flow time (seconds at speed 1, wraps at 25600)
uniform vec4 uFlowShape;   // swell, swell scale, ripples, ripple scale (features per object size)
uniform vec4 uFlowWave;    // waves, wave length (object sizes), sag, drip
uniform vec4 uFlowAxis;    // xyz wave direction (object space), w correct normals (1 on, 0 off)
uniform vec4 uFlowSpace;   // xyz flow centre (object space), w object size (SOP units)
uniform vec4 uFlowGravity; // xyz gravity direction (world space), w instance variation
// @end flow_uniforms

out vec3 vWorldPos;     // moved surface position in world space
out vec3 vWorldNormal;  // its normal in world space (zero if the SOP has none)
out vec3 vObjPos;       // rest position in the object's own space (surface ripples and film stick to it)
out float vFlow;        // how far the point moved outward, in units of Amplitude (teaching stage)
flat out int vCamIndex; // which camera of this render pass (pixel stage cannot ask)

// @begin noise
// Smooth 3D gradient noise, roughly -1..1. Each corner of an integer lattice
// gets a random slope from a hash; the noise blends the slopes smoothly.
// The lattice repeats every 256 cells (cells -128 to 127 keep their own
// slopes), so the noise repeats too. driftNoise() below relies on that.
float latticeHash(ivec3 c)
{
    uint h = (uint(c.x) * 73856093u) ^ (uint(c.y) * 19349663u) ^ (uint(c.z) * 83492791u);
    h ^= h >> 16; h *= 0x7feb352du;
    h ^= h >> 15; h *= 0x846ca68bu;
    h ^= h >> 16;
    return float(h) * (1.0 / 4294967295.0);
}

vec3 latticeSlope(ivec3 c)
{
    c = ((c + 128) & 255) - 128;  // repeat every 256 cells
    return vec3(latticeHash(c), latticeHash(c + ivec3(101, 211, 307)),
                latticeHash(c + ivec3(401, 503, 601))) * 2.0 - 1.0;
}

// The noise at p, with the lattice moved by a whole number of cells.
float gradientNoise(vec3 p, ivec3 cells)
{
    vec3 corner = floor(p);
    ivec3 i = ivec3(corner) + cells;
    vec3 f = p - corner;
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n000 = dot(latticeSlope(i),                    f);
    float n100 = dot(latticeSlope(i + ivec3(1, 0, 0)), f - vec3(1.0, 0.0, 0.0));
    float n010 = dot(latticeSlope(i + ivec3(0, 1, 0)), f - vec3(0.0, 1.0, 0.0));
    float n110 = dot(latticeSlope(i + ivec3(1, 1, 0)), f - vec3(1.0, 1.0, 0.0));
    float n001 = dot(latticeSlope(i + ivec3(0, 0, 1)), f - vec3(0.0, 0.0, 1.0));
    float n101 = dot(latticeSlope(i + ivec3(1, 0, 1)), f - vec3(1.0, 0.0, 1.0));
    float n011 = dot(latticeSlope(i + ivec3(0, 1, 1)), f - vec3(0.0, 1.0, 1.0));
    float n111 = dot(latticeSlope(i + ivec3(1, 1, 1)), f - vec3(1.0, 1.0, 1.0));
    float n = mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
                  mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
    return 1.4 * n;
}

// The noise at p + drift, for a drift of any size. A GPU float keeps about
// seven digits: after hours of motion the drift is in the thousands, and
// p + drift would lose the tiny steps that rebuild the normals. So fold the
// drift into one repeat of the lattice, move its whole cells into the
// lattice index, and add only its fraction to p. Every float stays small.
float driftNoise(vec3 p, vec3 drift)
{
    drift = mod(drift, 256.0);
    vec3 whole = floor(drift);
    return gradientNoise(p + (drift - whole), ivec3(whole));
}
// @end noise

// @begin field
// The liquid's height at q (measured in object sizes) at flow time t.
// Swell: two slow octaves. Ripples: one finer, faster octave.
// Waves: a sine that travels along the wave direction.
// seed moves an instance to another place in the field (Instance variation).
// Each noise reads q * scale, shifted by a drift that grows with time.
float liquidHeight(vec3 q, vec3 seed, float t)
{
    float height = 0.0;
    if (uFlowShape.x != 0.0) {
        float s = uFlowShape.y;
        float swell = driftNoise(q * s, seed * s + vec3(0.0, 0.35 * t, 0.0))
                    + 0.3 * driftNoise(q * (1.9 * s), seed * (1.9 * s) + vec3(0.27 * t, 0.0, -0.21 * t));
        height += uFlowShape.x * swell;
    }
    if (uFlowShape.z != 0.0) {
        float r = uFlowShape.w;
        height += uFlowShape.z * driftNoise(q * r, seed * r + vec3(0.8 * t, -0.6 * t, 0.5 * t));
    }
    if (uFlowWave.x != 0.0) {
        vec3 dir = uFlowAxis.xyz / max(length(uFlowAxis.xyz), 1e-6);
        float wavelength = max(uFlowWave.y, 1e-3);
        float crest = fract(dot(seed, dir) / wavelength - 0.5 * t);  // where the crests are now, 0..1
        height += uFlowWave.x * sin(6.2831853 * (dot(q, dir) / wavelength + crest));
    }
    return height;
}
// @end field

// @begin direction
// Which way a point moves.
// Along the normal: the classic blob. Vertices that share a position but not
// a normal (hard edges, some UV seams) move apart and open cracks.
// Away from the centre: depends on the position only, so vertices that share
// a position always move together (crack-free). The price: where the surface
// does not face away from the centre, part of the motion slides sideways.
// Within 0.05 object sizes of the centre the direction fades smoothly to
// zero, so a point at the centre stays put instead of spiking out.
// Geometry without normals always uses the centre direction.
vec3 flowDirection(vec3 q, vec3 n)
{
    bool fromCentre = uFlow.z > 0.5 || dot(n, n) < 0.5;
    if (!fromCentre) return n;
    float len = length(q);
    return q / max(len, 1e-6) * smoothstep(0.0, 0.05, len);
}
// @end direction

// @begin sag
// Gravity: the part of the object below the centre sinks along `down`.
// Drip gathers the sinking into a few hanging drops instead of one bulge.
vec3 sagOffset(vec3 q, vec3 down, vec3 seed, float t)
{
    if (uFlowWave.z == 0.0) return vec3(0.0);
    float below = max(dot(q, down), 0.0);
    vec3 across = q - dot(q, down) * down;
    float lumps = 0.5 + 0.5 * driftNoise(across * 1.3, seed + vec3(0.0, 0.0, 0.08 * t));
    float pull = below * below * (1.0 + uFlowWave.w * (2.0 * lumps * lumps - 0.5));
    return down * (uFlowWave.z * pull);
}
// @end sag

// @begin offset
// How far the point at q moves, in object sizes. Every input is a position
// or a uniform, except the normal n in "along the normal" mode.
vec3 flowOffset(vec3 q, vec3 n, vec3 down, vec3 seed, float t)
{
    float height = liquidHeight(q, seed, t);
    return uFlow.x * (height * flowDirection(q, n) + sagOffset(q, down, seed, t));
}
// @end offset

// @begin normals
// Any direction at right angles to v (from the archived neighbour method).
vec3 orthogonal(vec3 v)
{
    return normalize(abs(v.x) > abs(v.z) ? vec3(-v.y, v.x, 0.0) : vec3(0.0, -v.z, v.y));
}

// Nudge the point a tiny step both ways along two directions that lie in its
// surface, move each nudged copy with the same field, and cross the two
// moved steps. The result is the normal of the moved surface. Whatever the
// field does (noise, waves, sag), the normal follows it.
vec3 flowNormal(vec3 q, vec3 n, vec3 down, vec3 seed, float t)
{
    const float e = 1e-3;  // nudge, in object sizes
    vec3 tangent = orthogonal(n);
    vec3 bitangent = cross(n, tangent);
    vec3 step1 = 2.0 * e * tangent + flowOffset(q + e * tangent, n, down, seed, t)
                                   - flowOffset(q - e * tangent, n, down, seed, t);
    vec3 step2 = 2.0 * e * bitangent + flowOffset(q + e * bitangent, n, down, seed, t)
                                     - flowOffset(q - e * bitangent, n, down, seed, t);
    vec3 m = cross(step1, step2);
    return dot(m, n) < 0.0 ? -m : m;  // keep it on the outside, like the original
}
// @end normals

void main()
{
    // @begin rest
    vec3 p = TDPos();
    vec3 n = TDNormal();
    vObjPos = p;  // the rest position: the glass's own ripples and film stick to it
    vec3 moved = p;
    vec3 normal = n;
    float flow = 0.0;
    // @end rest

    // @begin move
    if (uFlow.x != 0.0) {  // Amplitude 0 skips everything: exactly the still glass
        bool hasNormal = dot(n, n) > 1e-12;
        vec3 unitNormal = hasNormal ? normalize(n) : vec3(0.0);
        float size = max(uFlowSpace.w, 1e-4);
        vec3 q = (p - uFlowSpace.xyz) / size;  // position in object sizes, from the centre
        float t = uFlow.w;  // flow time: Flow speed added up frame by frame on the CPU
        // Gravity is given in world space. Bring it into the object's space:
        // undo the Geometry COMP's transform, then this instance's own one.
        vec3 down = mat3(uTDMats[TDCameraIndex()].worldInverse) * uFlowGravity.xyz;
        mat3 instance = TDInstanceMat3();
        if (abs(determinant(instance)) > 1e-12) down = inverse(instance) * down;
        down = dot(down, down) > 1e-12 ? normalize(down) : vec3(0.0);
        // Instances can flow out of step: each one reads the field elsewhere.
        vec3 seed = uFlowGravity.w * 100.0 * fract(float(TDInstanceID()) * vec3(0.7548777, 0.5698403, 0.4142136));

        vec3 offset = flowOffset(q, unitNormal, down, seed, t);
        moved = p + size * offset;
        flow = dot(offset, flowDirection(q, unitNormal)) / uFlow.x;
        if (hasNormal && uFlowAxis.w > 0.5) {
            normal = normalize(flowNormal(q, unitNormal, down, seed, t));
        }
    }
    // @end move

    // @begin transforms
    vec4 world = TDDeform(moved);
    vWorldPos = world.xyz;
    vWorldNormal = TDDeformNorm(normal);
    vFlow = flow;
    vCamIndex = TDCameraIndex();
    gl_Position = TDWorldToProj(world);
    // @end transforms

    // @begin picking
#ifdef TD_PICKING_ACTIVE
    // Render Pick DAT/CHOP: write TouchDesigner's default pick values, then
    // replace positions and normals with those of the moved surface.
    TDWritePickingValues();
    vTDPickVert.sopSpacePosition = moved;
    vTDPickVert.worldSpacePosition = world.xyz;
    vTDPickVert.camSpacePosition = (uTDMats[TDCameraIndex()].cam * world).xyz;
    vTDPickVert.sopSpaceNormal = normal;
    vTDPickVert.worldSpaceNormal = vWorldNormal;
    vTDPickVert.camSpaceNormal = uTDMats[TDCameraIndex()].camForNormals * vWorldNormal;
#endif
    // @end picking
}
