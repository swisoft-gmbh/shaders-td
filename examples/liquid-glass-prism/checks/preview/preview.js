// WebGL2 preview of the Liquid Glass Prism study.
//
// It compiles the delivered GLSL files unchanged, behind small stand-ins for
// TouchDesigner's built-ins, and packs uniforms by evaluating the binding
// expressions in study.json. It mirrors the demo network: backdrop GLSL TOP,
// panorama GLSL TOP, optional back-face pass (normal + distance in one
// 32-bit float target), glass rendered over the backdrop.
// It is a look-development and test aid. It does not verify TouchDesigner.
// Adapted from the core Liquid Glass preview (commit a6f95c6, then its family-sync
// state after 6a58487).
//
// checks/reference/ holds the shaders and study.json of commit 6a58487 (before
// the family sync). draw({ reference: true, ... }) renders with them, so tests
// can compare the synced material with the old one, and the whole test suite
// can run against the old material (preview_tests.cjs --reference).

const ROOT = '../../';

const ES_HEADER = `#version 300 es
precision highp float;
precision highp int;
`;

const TD_COMMON = `
#define TD_NUM_CAMERAS 1
struct TDMatrix { mat4 world; mat4 cam; mat4 camInverse; mat4 proj; mat3 worldForNormals; };
uniform TDMatrix uTDMats[TD_NUM_CAMERAS];
struct TDGeneral { vec4 ambientColor; vec4 viewport; };
uniform TDGeneral uTDGeneral;
`;

// Test-only stand-ins (uPreview), not TouchDesigner behaviour:
//   x scales the SOP's points (an object built at another size, not a Geometry COMP scale);
//   y = -1 emulates a build whose rasteriser runs screen y opposite to the y of
//   uTDMats[].proj (a test of the shader's orientation handling; TouchDesigner's
//   own convention is a native check). draw({ projFlipY }) instead mirrors the
//   projection matrix itself (a negative y scale in uTDMats[].proj).
const MAT_VERTEX_PRELUDE = ES_HEADER + TD_COMMON + `
in vec3 P;
in vec3 N;
uniform vec4 uPreview;
vec3 TDPos() { return P * uPreview.x; }
vec3 TDNormal() { return N; }
vec4 TDDeform(vec3 p) { return uTDMats[0].world * vec4(p, 1.0); }
vec3 TDDeformNorm(vec3 n) { return uTDMats[0].worldForNormals * n; }
int TDCameraIndex() { return 0; }
vec4 TDWorldToProj(vec4 v) { vec4 c = uTDMats[0].proj * (uTDMats[0].cam * v); c.y *= uPreview.y; return c; }
`;

// TDFog stand-in: uPreviewFog.a = 0 (the default) is a Camera COMP without fog, so
// TDFog returns the colour unchanged, as Derivative documents. With a > 0 it mixes
// in a constant fog colour (a test model of fog, not TouchDesigner's fog curve).
const matPixelPrelude = (buffers) => ES_HEADER + (buffers > 1 ? `#define TD_NUM_COLOR_BUFFERS ${buffers}\n` : '') + TD_COMMON + `
void TDCheckDiscard() {}
bool TDFrontFacing(vec3 position, vec3 normal) { return gl_FrontFacing; }
vec4 TDOutputSwizzle(vec4 c) { return c; }
uniform vec4 uPreviewFog;
vec4 TDFog(vec4 c, vec3 worldSpacePos, int cameraIndex) { return vec4(mix(c.rgb, uPreviewFog.rgb, uPreviewFog.a), c.a); }
`;

const TOP_VERTEX = ES_HEADER + `
in vec2 aPos;
out vec3 vUV;
void main() { vUV = vec3(aPos * 0.5 + 0.5, 0.0); gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const TOP_PIXEL_PRELUDE = ES_HEADER + `
in vec3 vUV;
struct TDTexInfo { vec4 res; vec4 depth; };
uniform TDTexInfo uTDOutputInfo;
vec4 TDOutputSwizzle(vec4 c) { return c; }
`;

const BLIT_PIXEL = TOP_PIXEL_PRELUDE + `
uniform sampler2D sTex;
uniform float uMirror;
layout(location = 0) out vec4 fragColor;
void main() { vec2 st = vUV.st; if (uMirror > 0.5) st.y = 1.0 - st.y; fragColor = texture(sTex, st); }
`;

// Test-only backdrops (not part of the TouchDesigner recipe): 'uv' stores
// the screen position, so a refraction reading shows where the lookup
// landed; 'ramp' is a left-to-right ramp in all three channels.
const TEST_BACKDROP_PIXEL = TOP_PIXEL_PRELUDE + `
uniform float uKind;
layout(location = 0) out vec4 fragColor;
void main() { vec2 st = vUV.st; fragColor = uKind < 0.5 ? vec4(st, 1.0, 1.0) : vec4(vec3(st.x), 1.0); }
`;

// A plain opaque object for the compositing (Render Pass TOP) test.
const OCCLUDER_VERTEX = ES_HEADER + `
uniform mat4 uMVP; uniform mat4 uWorld; uniform float uFlipY;
in vec3 P; in vec3 N; out vec3 vN;
void main() { vN = mat3(uWorld) * N; vec4 c = uMVP * vec4(P, 1.0); c.y *= uFlipY; gl_Position = c; }
`;
const OCCLUDER_PIXEL = ES_HEADER + `
in vec3 vN; layout(location = 0) out vec4 fragColor;
void main() { float l = 0.35 + 0.65 * max(dot(normalize(vN), normalize(vec3(-0.5, 0.8, 0.6))), 0.0);
  fragColor = vec4(vec3(0.9, 0.35, 0.1) * l, 1.0); }
`;

// ------------------------------------------------------------------ math
const mat4 = {
  identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) { // column-major a * b
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  },
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
  scale(x, y, z) { return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]; },
  translate(x, y, z) { const m = mat4.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  },
  ortho(halfHeight, aspect, near, far) {
    const w = halfHeight * aspect;
    return [1 / w, 0, 0, 0, 0, 1 / halfHeight, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1];
  },
  normal3(m) { // inverse-transpose of the upper 3x3, column-major
    const a = [m[0], m[1], m[2]], b = [m[4], m[5], m[6]], c = [m[8], m[9], m[10]];
    const r0 = cross(b, c), r1 = cross(c, a), r2 = cross(a, b);
    const det = dot(a, r0);
    // inverse = [r0; r1; r2] / det as rows; its transpose has r0, r1, r2 as columns
    return [...r0, ...r1, ...r2].map((v) => v / det);
  },
};

// ------------------------------------------------------------------ meshes
const TAU = Math.PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Periodic parametric surface: f(u, v) -> point, core(u, v) -> a point inside (for normal orientation).
function surface(f, core, nu, nv) {
  const P = [], N = [], I = [];
  const e = 1e-4;
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = j / nv;
    const p = f(u, v);
    let n = norm(cross(sub(f(u + e, v), f(u - e, v)), sub(f(u, v + e), f(u, v - e))));
    if (!isFinite(n[0]) || Math.hypot(...n) < 0.5) n = norm(sub(p, core(u, v)));
    if (dot(n, sub(p, core(u, v))) < 0) n = [-n[0], -n[1], -n[2]];
    P.push(...p); N.push(...n);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = (i + 1) * (nv + 1) + j;
    I.push(a, b, a + 1, b, b + 1, a + 1);
  }
  // Make triangles counter-clockwise seen from outside (WebGL front faces).
  const at = (k) => [P[3 * k], P[3 * k + 1], P[3 * k + 2]];
  const face = cross(sub(at(I[1]), at(I[0])), sub(at(I[2]), at(I[0])));
  if (dot(face, [N[3 * I[0]], N[3 * I[0] + 1], N[3 * I[0] + 2]]) < 0) {
    for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
  }
  return { P: new Float32Array(P), N: new Float32Array(N), I: new Uint32Array(I) };
}

// Flat-faced solid from convex polygons (each a list of points); every face
// gets its own vertices and its outward normal, wound counter-clockwise.
function faceted(polygons, centre) {
  const P = [], N = [], I = [];
  for (const poly of polygons) {
    let n = norm(cross(sub(poly[1], poly[0]), sub(poly[2], poly[0])));
    let pts = poly;
    if (dot(n, sub(poly[0], centre)) < 0) { n = n.map((x) => -x); pts = [...poly].reverse(); }
    const base = P.length / 3;
    for (const p of pts) { P.push(...p); N.push(...n); }
    for (let k = 1; k + 1 < pts.length; k++) I.push(base, base + k, base + k + 1);
  }
  return { P: new Float32Array(P), N: new Float32Array(N), I: new Uint32Array(I) };
}

function box(hx, hy, hz) {
  const v = (x, y, z) => [x * hx, y * hy, z * hz];
  return faceted([
    [v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1)], [v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)],
    [v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1)], [v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)],
    [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)], [v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), v(1, -1, -1)],
  ], [0, 0, 0]);
}

const MESHES = {
  // Same as the TouchDesigner demo: Torus SOP, orient Z, radx 1, rady 0.5.
  torus: () => surface(
    (u, v) => { const a = u * TAU, b = v * TAU, R = 1.0, r = 0.5;
      return [(R + r * Math.cos(b)) * Math.cos(a), (R + r * Math.cos(b)) * Math.sin(a), r * Math.sin(b)]; },
    (u) => [Math.cos(u * TAU), Math.sin(u * TAU), 0], 128, 64),
  knot: () => {
    const c = (t) => { const a = t * TAU; const r = 2 + Math.cos(3 * a);
      return [0.42 * r * Math.cos(2 * a), 0.42 * r * Math.sin(2 * a), 0.42 * Math.sin(3 * a)]; };
    const frame = (t) => {
      const e = 1e-3; const T = norm(sub(c(t + e), c(t - e)));
      const acc = sub(sub(c(t + e), c(t)), sub(c(t), c(t - e)));
      const Nn = norm(sub(acc, T.map((x) => x * dot(acc, T))));
      return [T, Nn, cross(T, Nn)];
    };
    return surface((u, v) => { const [, Nn, B] = frame(u); const p = c(u), b = v * TAU, r = 0.26;
      return [0, 1, 2].map((k) => p[k] + r * (Math.cos(b) * Nn[k] + Math.sin(b) * B[k])); },
    (u) => c(u), 360, 48);
  },
  // Unit sphere: lets tests compare measured thickness with the exact chord.
  sphere: () => surface(
    (u, v) => { const a = u * TAU, b = v * Math.PI;
      return [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)]; },
    () => [0, 0, 0], 160, 120),
  blob: () => surface(
    (u, v) => { const a = u * TAU, b = v * Math.PI;
      const d = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
      const r = 1.15 + 0.16 * Math.sin(3 * d[0] + 1) * Math.sin(2.5 * d[1]) * Math.sin(3.2 * d[2] + 0.5) + 0.08 * Math.sin(5 * d[1] + 2 * d[0]);
      return d.map((x) => x * r); },
    () => [0, 0, 0], 128, 96),
  // A parallel-sided slab: 2 x 1.6 x 0.4 box.
  slab: () => box(1.0, 0.8, 0.2),
  // A 45-degree prism: front face z = 0.5 (normal +Z), far face tilted 45 degrees.
  // Cross-section A(-1, 0.5) B(1, 0.5) C(1, -1.5) in x-z, extruded over y = +-0.8.
  wedge: () => {
    const A = (y) => [-1, y, 0.5], B = (y) => [1, y, 0.5], C = (y) => [1, y, -1.5], h = 0.8;
    return faceted([
      [A(-h), B(-h), B(h), A(h)], [B(-h), C(-h), C(h), B(h)], [C(-h), A(-h), A(h), C(h)],
      [A(h), B(h), C(h)], [A(-h), B(-h), C(-h)],
    ], [1 / 3, 0, -1 / 6]);
  },
};

// ------------------------------------------------------------------ GL helpers
function compile(gl, type, source, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(label + ': ' + gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, label + ' vertex'));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, label + ' pixel'));
  gl.bindAttribLocation(p, 0, 'P');
  gl.bindAttribLocation(p, 1, 'N');
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(label + ' link: ' + gl.getProgramInfoLog(p));
  return p;
}

function target(gl, w, h, internal, withDepth, filter, buffers = 1) {
  const type = internal === gl.RGBA8 ? gl.UNSIGNED_BYTE : (internal === gl.RGBA32F ? gl.FLOAT : gl.HALF_FLOAT);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const texs = [];
  for (let i = 0; i < buffers; i++) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
    texs.push(tex);
  }
  if (buffers > 1) gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  if (withDepth) {
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  }
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex: texs[0], texs, fb, w, h };
}

// ------------------------------------------------------------------ study.json expressions
// Only the expression shapes study.json uses; anything else is an error, so a
// recipe change cannot silently fall out of the preview.
function evaluate(expr, ctx) {
  if (typeof expr === 'number') return expr;
  let m;
  const morphedPar = String.raw`op\('presets'\)\.module\.u\(parent\(\)\.par\.(\w+)\)`;
  if ((m = expr.match(new RegExp(`^${morphedPar}$`)))) return ctx.morphed(m[1]);
  // A morphed length control converted to scene units with Object size.
  if ((m = expr.match(new RegExp(String.raw`^${morphedPar} ([*/]) parent\(\)\.par\.(\w+)\.eval\(\)$`))))
    return m[2] === '*' ? ctx.morphed(m[1]) * Number(ctx.p[m[3]]) : ctx.morphed(m[1]) / Number(ctx.p[m[3]]);
  if ((m = expr.match(/^([\d.]+) \/ parent\(\)\.par\.(\w+)\.eval\(\)$/))) return parseFloat(m[1]) / Number(ctx.p[m[2]]);
  if ((m = expr.match(/^op\('presets'\)\.module\.menu\(parent\(\)\.par\.(\w+)\)$/))) return ctx.menuIndex(m[1]);
  if ((m = expr.match(/^op\('presets'\)\.module\.phase\(parent\(\), (-?[\d.]+)\)$/))) return ctx.phase(parseFloat(m[1]));
  if (expr === "op('presets').module.decode_colours(parent())") return ctx.decodeColours();
  if ((m = expr.match(/^parent\(\)\.par\.(\w+)\.menuIndex$/))) return ctx.menuIndex(m[1]);  // 6a58487 bindings
  if ((m = expr.match(/^parent\(\)\.par\.(\w+) \* ([\d.]+)$/))) return ctx.p[m[1]] * parseFloat(m[2]);
  if ((m = expr.match(/^parent\(\)\.par\.(\w+)$/))) return Number(ctx.p[m[1]]);
  // 6a58487 bindings: raw absolute time (paused: Fixed time).
  if (expr === 'parent().par.Time if parent().par.Pause.eval() else absTime.seconds') return ctx.p.Pause ? ctx.p.Time : ctx.time;
  if ((m = expr.match(/^1 if parent\(\)\.par\.(\w+)\.eval\(\) else 0$/)))  // TOP connected, or a toggle
    return (m[1] in ctx.connected ? ctx.connected[m[1]] : ctx.p[m[1]]) ? 1 : 0;
  throw new Error('preview cannot evaluate study.json expression: ' + expr);
}

// ------------------------------------------------------------------ preview
async function text(path) {
  const r = await fetch(ROOT + path, { cache: 'no-store' });
  if (!r.ok) throw new Error('fetch ' + path + ' ' + r.status);
  return r.text();
}

// patch: optional [[from, to], ...] applied to liquid_prism.frag before compiling
// (test instrumentation only); each anchor must occur exactly once. refPatch: the
// same for the 6a58487 reference copy, so an instrumented test can also run with
// --reference.
async function createPreview(canvas, patch, refPatch) {
  let [studyText, presetText, vert, frag, backdrop, env, refStudyText, refVert, refFrag, refBackdrop, coreBackdrop] = await Promise.all([
    text('study.json'), text('presets.json'), text('liquid_prism.vert'), text('liquid_prism.frag'),
    text('backdrop.frag'), text('env.frag'),
    text('checks/reference/study.json'), text('checks/reference/liquid_prism.vert'), text('checks/reference/liquid_prism.frag'),
    text('checks/reference/backdrop.frag'), text('checks/reference/core_backdrop.frag')]);
  for (const [from, to] of patch || []) {
    if (frag.split(from).length !== 2) throw new Error('instrumentation anchor not found exactly once: ' + from);
    frag = frag.replace(from, to);
  }
  for (const [from, to] of refPatch || []) {
    if (refFrag.split(from).length !== 2) throw new Error('reference instrumentation anchor not found exactly once: ' + from);
    refFrag = refFrag.replace(from, to);
  }
  const study = JSON.parse(studyText);
  const refStudy = JSON.parse(refStudyText);
  const presets = JSON.parse(presetText);
  const controls = Object.fromEntries(study.controls.map((c) => [c.name, c]));

  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
  if (!floatTargets) throw new Error('EXT_color_buffer_float unavailable: the back-face pass needs a float target');
  const HDR = gl.RGBA16F;

  // Glass programs, compiled on first use: the delivered shaders or the 6a58487
  // reference, with 1 or more colour buffers, and (tests only) a higher sample cap.
  const programs = {};
  function glassProgram(reference, buffers, sampleCap) {
    const key = [reference ? 'ref' : 'new', buffers, sampleCap || 0].join(':');
    if (programs[key]) return programs[key];
    let source = reference ? refFrag : frag;
    if (sampleCap) {  // a test-only copy that allows more than 32 spectrum slices
      const edits = [['clamp(int(uState.z + 0.5), 1, 32)', `clamp(int(uState.z + 0.5), 1, ${sampleCap})`],
        ['    for (int i = 0; i < 32; i++) {\n        if (i >= count) break;', `    for (int i = 0; i < ${sampleCap}; i++) {\n        if (i >= count) break;`]];
      for (const [from, to] of edits) {
        if (source.split(from).length !== 2) throw new Error('sampleCap patch did not apply: ' + from);
        source = source.replace(from, to);
      }
    }
    return (programs[key] = program(gl, MAT_VERTEX_PRELUDE + (reference ? refVert : vert), matPixelPrelude(buffers) + source,
      `liquid_prism${reference ? ' (6a58487)' : ''}`));
  }
  glassProgram(false, 1, 0);
  glassProgram(true, 1, 0);
  const backdropProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + backdrop, 'backdrop');
  const refBackdropProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + refBackdrop, 'backdrop (6a58487)');
  const coreBackdropProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + coreBackdrop, 'core backdrop (6a58487)');
  const envProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + env, 'env');
  const blit = program(gl, TOP_VERTEX, BLIT_PIXEL, 'blit');
  const testBackdropProg = program(gl, TOP_VERTEX, TEST_BACKDROP_PIXEL, 'test backdrop');
  const occluderProg = program(gl, OCCLUDER_VERTEX, OCCLUDER_PIXEL, 'occluder');

  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  const qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const meshCache = {};
  // noNormals: upload N = 0, like a SOP without a normal attribute.
  function mesh(name, noNormals) {
    const key = name + (noNormals ? ':nonormals' : '');
    if (meshCache[key]) return meshCache[key];
    const m = MESHES[name]();
    if (noNormals) m.N = new Float32Array(m.N.length);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    for (const [loc, data] of [[0, m.P], [1, m.N]]) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.I, gl.STATIC_DRAW);
    return (meshCache[key] = { vao, count: m.I.length });
  }

  const W = canvas.width, H = canvas.height;
  const backdropTargets = [target(gl, W, H, HDR, false), target(gl, W, H, HDR, false)];  // Study > Demo backdrop: checker, type
  const refBackdropTargets = [target(gl, W, H, HDR, false), target(gl, W, H, HDR, false)];  // 6a58487: type, light checker
  const coreCheckerTarget = target(gl, W, H, HDR, false);  // the core study's backdrop at 6a58487
  const flatTarget = target(gl, W, H, HDR, false);         // a flat (premultiplied) colour, maybe transparent
  const envTarget = target(gl, 1024, 512, HDR, false);
  // render_back: RGBA 32-bit float, read with texelFetch, so nearest filtering.
  const backTarget = target(gl, W, H, gl.RGBA32F, true, gl.NEAREST);
  const probeTarget = target(gl, W, H, gl.RGBA32F, true, gl.NEAREST);
  const mrtTarget = target(gl, W, H, gl.RGBA32F, true, gl.NEAREST, 3);  // a Render TOP with three colour buffers
  const blackTarget = target(gl, 4, 4, gl.RGBA8, false);  // 'blank': an unconnected sampler
  const testBackdrops = { uv: target(gl, W, H, HDR, false), ramp: target(gl, W, H, HDR, false) };
  const sceneTarget = target(gl, W, H, HDR, true);          // backdrop + occluder, or a mirrored backdrop
  let lastProbe = null;
  let lastBuffers = null;

  function fullscreen(prog, dst, w, h, setup) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(prog);
    const res = gl.getUniformLocation(prog, 'uTDOutputInfo.res');
    if (res) gl.uniform4f(res, 1 / w, 1 / h, w, h);
    if (setup) setup(prog);
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function mipmaps(t) {  // like the GLSL MAT sampler filter 'Mipmap Linear'
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  // demo_backdrop: evaluate its own study.json uniform (the Demo backdrop menu index) per style.
  const backdropNode = study.nodes.find((n) => n.id === 'demo_backdrop');
  const paintStyles = (prog, targets, uniforms) => targets.forEach((t, style) => {
    fullscreen(prog, t, W, H, (pr) => {
      for (const u of uniforms) {
        const v = u.values.map((e) => (typeof e === 'number' ? e : style));
        gl.uniform4f(gl.getUniformLocation(pr, u.name), v[0], v[1], v[2], v[3]);
      }
    });
    mipmaps(t);
  });
  paintStyles(backdropProg, backdropTargets, backdropNode.uniforms);
  paintStyles(refBackdropProg, refBackdropTargets, refStudy.nodes.find((n) => n.id === 'demo_backdrop').uniforms);
  fullscreen(coreBackdropProg, coreCheckerTarget, W, H);
  mipmaps(coreCheckerTarget);
  fullscreen(envProg, envTarget, 1024, 512);
  mipmaps(envTarget);
  Object.values(testBackdrops).forEach((t, kind) => {
    fullscreen(testBackdropProg, t, W, H, (prog) => gl.uniform1f(gl.getUniformLocation(prog, 'uKind'), kind));
    mipmaps(t);
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, blackTarget.fb);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Sampler settings from study.json, like the builder's samplerNfilter / extendu / extendv. A
  // reference (6a58487) draw uses the same settings, so comparisons isolate the shader.
  const FILTERS = { nearest: [gl.NEAREST, gl.NEAREST], linear: [gl.LINEAR, gl.LINEAR],
    mipmaplinear: [gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR] };
  const WRAPS = { hold: gl.CLAMP_TO_EDGE, repeat: gl.REPEAT, mirror: gl.MIRRORED_REPEAT };
  const SAMPLERS = Object.fromEntries(study.nodes.find((n) => n.id === 'material').uniforms
    .filter((u) => u.kind === 'sampler').map((u) => [u.name, u]));
  function samplerState(name) {
    const u = SAMPLERS[name];
    const f = FILTERS[u.filter || 'linear'], s = WRAPS[u.extendu || 'hold'], t = WRAPS[u.extendv || 'hold'];
    if (!f || !s || !t) throw new Error('preview cannot apply sampler settings of ' + name);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f[0]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f[1]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, s);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, t);
  }

  function parameters(opts) {
    const p = {};
    for (const c of study.controls) if (c.default !== null && c.default !== undefined) p[c.name] = c.default;
    const preset = opts.preset || presets.default;
    if (preset !== 'custom') Object.assign(p, presets.presets[preset].values);
    Object.assign(p, opts.overrides || {});
    return p;
  }

  // presets.py advance(): paused, rate x Fixed time; running, the previous value plus
  // rate x the seconds since the previous frame (rate x time on a first frame); rate 0
  // holds. Wrapped like Python's % (never negative). `time` stands for absTime.seconds.
  // Each draw is a first frame unless opts.drift === 'continue', so single renders
  // stay repeatable; 'continue' plays consecutive frames, as a running component does.
  let motion = {};
  function advance(name, rate, period, time, paused, fixedTime) {
    const wrap = (x) => ((x % period) + period) % period;
    if (paused) { const v = wrap(rate * fixedTime); motion[name] = [v, null]; return v; }
    let s = motion[name];
    if (rate === 0) { if (!s) s = motion[name] = [0, null]; s[1] = null; return s[0]; }
    if (!s) s = motion[name] = [wrap(rate * time), time];
    else if (s[1] === null || time < s[1]) s[1] = time;
    else { s[0] = wrap(s[0] + rate * (time - s[1])); s[1] = time; }
    return s[0];
  }

  // Draws one frame. opts: preset, overrides, mesh, time, drift ('continue': the next frame of a
  // running component), spin (degrees, fixed), tilt, scale [x,y,z] (Geometry COMP scale), sopScale
  // (the SOP itself built bigger or smaller), cameraZ, fov, ortho, near, far, refraction (false =
  // unconnected), reflection (false = unconnected), backdropOnly, showEnv, probe (render the glass
  // alone, unblended, into a 32-bit float target; the floats stay readable through lastProbe()),
  // buffers (the same into a target with this many colour buffers, cleared to clearBuffers; each
  // buffer's floats through lastBuffers()), readBack (the back-face pass's floats through
  // lastProbe()), backdrop ('uv' or 'ramp': test backdrops), flatBackdrop ([r, g, b] or [r, g, b, a],
  // premultiplied: a uniform or transparent scene), backdropFrom ('prism-6a58487-type',
  // 'prism-6a58487-checker' or 'core-6a58487': the old demo scenes, for the backdrop test),
  // reference (render with the 6a58487 shaders and bindings), sampleCap (tests: allow more than
  // 32 spectrum slices), fog ([r, g, b, amount], test model), noNormals (mesh with N = 0),
  // flipRaster (screen y runs opposite to the projection's y; the scene behind is mirrored to
  // match), projFlipY (the camera's projection matrix has a negative y scale; with flipRaster the
  // image is upright again, alone it is upside down, and the scene behind follows), reflectionFrom
  // ('uv': the Reflection TOP stores its own coordinates, so a flat-image reflection shows where
  // it read), occluder (an opaque ball in front of the glass, in the scene render; occluder.renderPass
  // draws the glass into the scene render keeping its depth, as the README's Render Pass TOP does;
  // without it the glass is laid over the scene, as an Over TOP does), roll (degrees about the view
  // axis, applied last), mirrorInputs (the Refraction TOP and the back-face pass arrive upside down,
  // the case Flip V exists for), backClear ([r, g, b, a] background of the back-face pass).
  function draw(opts = {}) {
    const p = parameters(opts);
    const time = opts.time ?? p.Time;
    if (opts.drift !== 'continue') motion = {};
    const paused = !!p.Pause;
    const connected = { Refractiontop: opts.refraction !== false, Reflectiontop: opts.reflection !== false };
    const morphTarget = presets.presets[p.Morphtarget].values;
    const morphed = (k) => (p.Morph > 0 ? p[k] + (morphTarget[k] - p[k]) * p.Morph : p[k]);
    const ctx = {
      p, time, connected, morphed,
      menuIndex: (k) => { const i = controls[k].names.indexOf(p[k]); if (i < 0) throw new Error('menu ' + k); return i; },
      // presets.py phase(): the integral of rate x morphed Wobble speed, wrapped to 0..256.
      phase: (rate) => advance('phase' + rate, rate * morphed('Wobblespeed'), 256, time, paused, p.Time),
      // presets.py decode_colours(): the preview stands in for a pass-through project.
      decodeColours: () => (p.Colourspace === 'srgb' ? 1 : 0),
    };
    const spec = opts.reference ? refStudy : study;
    const node = (id) => spec.nodes.find((n) => n.id === id);

    let backdropTarget;
    if (opts.flatBackdrop) {
      const c = opts.flatBackdrop;
      gl.bindFramebuffer(gl.FRAMEBUFFER, flatTarget.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(c[0], c[1], c[2], c[3] ?? 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      mipmaps(flatTarget);
      backdropTarget = flatTarget;
    } else if (opts.backdrop) backdropTarget = testBackdrops[opts.backdrop];
    else if (opts.backdropFrom === 'core-6a58487') backdropTarget = coreCheckerTarget;
    else if (opts.backdropFrom === 'prism-6a58487-type') backdropTarget = refBackdropTargets[0];
    else if (opts.backdropFrom === 'prism-6a58487-checker') backdropTarget = refBackdropTargets[1];
    else backdropTarget = backdropTargets[ctx.menuIndex('Backdrop')];
    const flipY = opts.flipRaster ? -1 : 1;
    // The scene render this build would make is upside down when exactly one of the two flips is on.
    const sceneMirrored = !!opts.flipRaster !== !!opts.projFlipY;

    const aspect = W / H;
    const camZ = opts.cameraZ ?? 5;
    const proj = opts.ortho ? mat4.ortho(opts.ortho, aspect, opts.near ?? 0.1, opts.far ?? 100)
                            : mat4.perspective((opts.fov ?? 45) * Math.PI / 180, aspect, opts.near ?? 0.1, opts.far ?? 100);
    if (opts.projFlipY) for (const i of [1, 5, 9, 13]) proj[i] = -proj[i];  // row 1 (y) of the column-major matrix
    const camInverse = mat4.translate(0, 0, camZ);
    const cam = mat4.translate(0, 0, -camZ);
    // demo_geo ry = presets.py spin(); opts.spin fixes the angle for tests (degrees).
    const spin = (opts.spin !== undefined ? opts.spin : advance('spin', p.Demospin, 360, time, paused, p.Time)) * Math.PI / 180;
    const s = opts.scale ?? [1, 1, 0.6];  // demo_geo: sz 0.6
    // TouchDesigner's default transform order: scale, then rotate x, y, z.
    const world = mat4.mul(mat4.rotZ((opts.roll ?? 0) * Math.PI / 180),
      mat4.mul(mat4.mul(mat4.rotY(spin), mat4.rotX((opts.tilt ?? 20) * Math.PI / 180)), mat4.scale(...s)));
    const m = mesh(opts.mesh || 'torus', opts.noNormals);
    const occluderWorld = mat4.mul(mat4.translate(0.75, 0.35, 1.6), mat4.scale(0.32, 0.32, 0.32));
    function drawOccluder(dst) {
      const o = mesh('sphere');
      gl.useProgram(occluderProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(occluderProg, 'uMVP'), false, mat4.mul(proj, mat4.mul(cam, occluderWorld)));
      gl.uniformMatrix4fv(gl.getUniformLocation(occluderProg, 'uWorld'), false, occluderWorld);
      gl.uniform1f(gl.getUniformLocation(occluderProg, 'uFlipY'), flipY);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND);
      gl.frontFace(sceneMirrored ? gl.CW : gl.CCW);
      gl.bindVertexArray(o.vao);
      gl.drawElements(gl.TRIANGLES, o.count, gl.UNSIGNED_INT, 0);
      gl.frontFace(gl.CCW);
    }
    const displayTarget = backdropTarget;  // what the final image shows behind the glass
    if (sceneMirrored || opts.occluder || opts.mirrorInputs) {  // the scene render, as this build would make it
      gl.useProgram(blit);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, backdropTarget.tex);
      gl.uniform1i(gl.getUniformLocation(blit, 'sTex'), 0);
      gl.uniform1f(gl.getUniformLocation(blit, 'uMirror'), sceneMirrored || opts.mirrorInputs ? 1 : 0);
      fullscreen(blit, sceneTarget, W, H);
      if (opts.occluder) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.fb);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        drawOccluder(sceneTarget);
      }
      mipmaps(sceneTarget);
      backdropTarget = sceneTarget;
    }

    function drawGlass(nodeId, dst, cull, rasterFlip = flipY, buffers = 1) {
      const n = node(nodeId);
      const glass = glassProgram(!!opts.reference, buffers, opts.sampleCap);
      gl.useProgram(glass);
      const loc = (name) => gl.getUniformLocation(glass, name);
      gl.uniformMatrix4fv(loc('uTDMats[0].world'), false, world);
      gl.uniformMatrix4fv(loc('uTDMats[0].cam'), false, cam);
      gl.uniformMatrix4fv(loc('uTDMats[0].camInverse'), false, camInverse);
      gl.uniformMatrix4fv(loc('uTDMats[0].proj'), false, proj);
      gl.uniformMatrix3fv(loc('uTDMats[0].worldForNormals'), false, mat4.normal3(world));
      gl.uniform4f(loc('uTDGeneral.viewport'), 0, 0, 1 / W, 1 / H);
      gl.uniform4f(loc('uPreview'), opts.sopScale ?? 1, rasterFlip, 0, 0);
      const fog = opts.fog || [0, 0, 0, 0];
      gl.uniform4f(loc('uPreviewFog'), fog[0], fog[1], fog[2], fog[3]);
      let unit = 0;
      for (const u of n.uniforms) {
        if (u.kind === 'sampler') {
          const expr = u.values[0];
          let tex = blackTarget.tex;
          if (expr.includes('Refractiontop') && connected.Refractiontop) tex = backdropTarget.tex;
          if (expr.includes('Reflectiontop') && connected.Reflectiontop) tex = opts.reflectionFrom === 'uv' ? testBackdrops.uv.tex : envTarget.tex;
          if (expr.includes('render_back') && p.Backface) tex = backTarget.tex;
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          if (tex !== blackTarget.tex) samplerState(u.name);
          gl.uniform1i(loc(u.name), unit++);
        } else {
          const v = u.values.map((e) => evaluate(e, ctx));
          while (v.length < 4) v.push(0);
          gl.uniform4f(loc(u.name), v[0], v[1], v[2], v[3]);
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      if (cull) { gl.enable(gl.CULL_FACE); gl.cullFace(cull); } else gl.disable(gl.CULL_FACE);
      // A flipped raster or a mirrored projection reverses winding (TDFrontFacing's job in TD).
      gl.frontFace((rasterFlip < 0) !== !!opts.projFlipY ? gl.CW : gl.CCW);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
      gl.disable(gl.CULL_FACE);
      gl.frontFace(gl.CCW);
      gl.activeTexture(gl.TEXTURE0);
    }

    if (p.Backface) {  // render_back: front faces culled, no blending, rgb = normal, alpha = distance
      gl.bindFramebuffer(gl.FRAMEBUFFER, backTarget.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(...(opts.backClear || [0, 0, 0, 0]));
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND);
      drawGlass('material_back', backTarget, gl.FRONT, opts.mirrorInputs ? -1 : flipY);
    }

    const readFloats = (fb, attachment) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
      const out = new Float32Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out;  // rows bottom to top
    };
    if (opts.readBack) {  // the back-face pass's floats (rgb normal, a = minus the distance)
      lastProbe = readFloats(backTarget.fb, 0);
      return { floatTargets };
    }
    if (opts.buffers) {  // the glass alone, unblended, into several colour buffers
      gl.bindFramebuffer(gl.FRAMEBUFFER, mrtTarget.fb);
      gl.viewport(0, 0, W, H);
      for (let i = 0; i < opts.buffers; i++) gl.clearBufferfv(gl.COLOR, i, opts.clearBuffers || [0, 0, 0, 0]);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND);
      drawGlass('material', mrtTarget, p.Culling === 'back' ? gl.BACK : null, flipY, opts.buffers);
      lastBuffers = Array.from({ length: opts.buffers }, (_, i) => readFloats(mrtTarget.fb, i));
      lastProbe = lastBuffers[0];
      return { floatTargets };
    }
    if (opts.probe) {  // the glass alone, unblended, in 32-bit float: for finiteness tests
      gl.bindFramebuffer(gl.FRAMEBUFFER, probeTarget.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(...(opts.clearBuffers || [0, 0, 0, 0]));
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND);
      drawGlass('material', probeTarget, p.Culling === 'back' ? gl.BACK : null);
      const out = readFloats(probeTarget.fb, 0);
      lastProbe = out;  // rows bottom to top
      let nonFinite = 0, covered = 0, maxAbs = 0;
      for (let i = 0; i < out.length; i += 4) {
        let pixelCovered = false;
        for (let k = 0; k < 4; k++) {
          const v = out[i + k];
          if (!Number.isFinite(v)) nonFinite++;
          else { maxAbs = Math.max(maxAbs, Math.abs(v)); if (v !== 0) pixelCovered = true; }
        }
        if (pixelCovered) covered++;
      }
      return { nonFinite, covered, maxAbs };
    }

    // over: backdrop, then the glass with premultiplied blending (One, One Minus Src Alpha).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(blit);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, opts.showEnv ? envTarget.tex : (opts.mirrorInputs ? displayTarget : backdropTarget).tex);
    gl.uniform1i(gl.getUniformLocation(blit, 'sTex'), 0);
    gl.uniform1f(gl.getUniformLocation(blit, 'uMirror'), 0);
    fullscreen(blit, null, W, H);
    if (opts.showEnv || opts.backdropOnly) return { floatTargets };
    // Render Pass TOP route: the glass is drawn into the scene render, whose depth is kept,
    // so the occluder's depth is in the buffer before the glass (the colour already is).
    if (opts.occluder && opts.occluder.renderPass) drawOccluder(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    drawGlass('material', null, p.Culling === 'back' ? gl.BACK : null);
    gl.disable(gl.BLEND);
    return { floatTargets };
  }

  function pixels() {
    const out = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;  // rows bottom to top
  }

  return { draw, pixels, lastProbe: () => lastProbe, lastBuffers: () => lastBuffers, study, presets, floatTargets, size: [W, H] };
}

window.createPreview = createPreview;
