// WebGL2 preview of the Liquid Glass Flow study.
//
// It compiles the delivered GLSL files unchanged, behind small stand-ins for
// TouchDesigner's built-ins, and packs uniforms by evaluating the binding
// expressions in study.json. It mirrors the demo network: backdrop GLSL TOP,
// panorama GLSL TOP, optional back-face pass, glass rendered over the backdrop.
// It can also run only the vertex stage with transform feedback, so tests can
// read the moved positions and normals of every vertex.
//
// The same code renders the core study (checks/core_reference: the core
// working tree after the family-sync merge) when createPreview is given
// 'core', and the flow vertex shader with the core pixel shader when given
// 'hybrid' (a test of the "core plus documented additions" claim).
// checks/reference/ holds this study's shaders and study.json at commit
// 6a58487 (before the family sync) and the core's 6a58487 pixel shader:
// draw({ reference: true }) renders the old flow material with its old
// bindings, and draw({ pixelStage: 'core6a58487' }) feeds the delivered vertex
// shader and bindings to the core's 6a58487 pixel shader.
// It is a look-development and test aid. It does not verify TouchDesigner.

const STUDIES = {
  flow: { root: '../../', study: 'study.json', presets: 'presets.json',
          vert: 'liquid_flow.vert', frag: 'liquid_flow.frag' },
  core: { root: '../../', study: 'checks/core_reference/study.json', presets: 'checks/core_reference/presets.json',
          vert: 'checks/core_reference/liquid_glass.vert', frag: 'checks/core_reference/liquid_glass.frag' },
  hybrid: { root: '../../', study: 'study.json', presets: 'presets.json',
            vert: 'liquid_flow.vert', frag: 'checks/core_reference/liquid_glass.frag' },
};
const REFERENCE = { study: 'checks/reference/study.json', vert: 'checks/reference/liquid_flow.vert',
                    frag: 'checks/reference/liquid_flow.frag', backdrop: 'checks/reference/backdrop.frag',
                    coreFrag: 'checks/reference/core_liquid_glass.frag' };

const ES_HEADER = `#version 300 es
precision highp float;
precision highp int;
`;

const TD_COMMON = `
#define TD_NUM_CAMERAS 1
struct TDMatrix { mat4 world; mat4 worldInverse; mat4 cam; mat4 camInverse; mat4 proj; mat3 worldForNormals; };
uniform TDMatrix uTDMats[TD_NUM_CAMERAS];
struct TDGeneral { vec4 ambientColor; vec4 viewport; };
uniform TDGeneral uTDGeneral;
`;

// Instancing as TouchDesigner documents it: TDDeform applies the instance's
// transform first, then the Geometry COMP's (world * instance * P).
// Test-only stand-in (uPreview.y = -1): a build whose rasteriser runs screen y
// opposite to the projection's y. Not TouchDesigner behaviour.
const MAT_VERTEX_PRELUDE = ES_HEADER + TD_COMMON + `
in vec3 P;
in vec3 N;
uniform int uPreviewInstance;
uniform mat4 uPreviewInstanceMat;
uniform vec4 uPreview;
vec3 TDPos() { return P; }
vec3 TDNormal() { return N; }
vec4 TDDeform(vec3 p) { return uTDMats[0].world * (uPreviewInstanceMat * vec4(p, 1.0)); }
vec3 TDDeformNorm(vec3 n) { return uTDMats[0].worldForNormals * (transpose(inverse(mat3(uPreviewInstanceMat))) * n); }
mat3 TDInstanceMat3() { return mat3(uPreviewInstanceMat); }
int TDInstanceID() { return uPreviewInstance; }
int TDCameraIndex() { return 0; }
vec4 TDWorldToProj(vec4 v) { vec4 c = uTDMats[0].proj * (uTDMats[0].cam * v); c.y *= uPreview.y; return c; }
`;

// TDFog stand-in: uPreviewFog.a = 0 (the default) is a Camera COMP without fog, so
// TDFog returns the colour unchanged, as Derivative documents. With a > 0 it mixes
// in a constant fog colour (a test model of fog, not TouchDesigner's fog curve).
// TD_NUM_COLOR_BUFFERS stays undefined for one buffer, so the shader's own
// fallback compiles; the 6a58487 flow shader had no fallback and gets the define.
const matPixelPrelude = (buffers, define) => ES_HEADER
  + (buffers > 1 || define ? `#define TD_NUM_COLOR_BUFFERS ${buffers}\n` : '') + TD_COMMON + `
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

// A test backdrop whose colour is its own screen position (r = u, g = v): the
// refraction stage then shows where each pixel looked (frost shift test).
const UV_PIXEL = TOP_PIXEL_PRELUDE + `
layout(location = 0) out vec4 fragColor;
void main() { fragColor = vec4(vUV.st, 0.0, 1.0); }
`;

// A plain opaque object for the compositing (Render Pass TOP) test, as in the
// Liquid Glass Prism preview.
const OCCLUDER_VERTEX = ES_HEADER + `
uniform mat4 uMVP; uniform mat4 uWorld;
in vec3 P; in vec3 N; out vec3 vN;
void main() { vN = mat3(uWorld) * N; gl_Position = uMVP * vec4(P, 1.0); }
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
  translate(x, y, z) { const m = mat4.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
  scale(x, y, z) { return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]; },
  ortho(halfHeight, aspect, near, far) {  // proj[2][3] = 0: the shader's orthographic branch
    const w = halfHeight * aspect;
    return [1 / w, 0, 0, 0, 0, 1 / halfHeight, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1];
  },
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  },
  // Inverse of an affine transform (3x3 linear part plus translation).
  affineInverse(m) {
    const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];  // columns
    const inv = mat3inverse(a);
    const t = [m[12], m[13], m[14]];
    const it = [0, 1, 2].map((r) => -(inv[r] * t[0] + inv[3 + r] * t[1] + inv[6 + r] * t[2]));
    return [inv[0], inv[1], inv[2], 0, inv[3], inv[4], inv[5], 0, inv[6], inv[7], inv[8], 0, it[0], it[1], it[2], 1];
  },
  // Inverse transpose of the upper 3x3: how TouchDesigner's worldForNormals is defined.
  normal3(m) {
    const inv = mat3inverse([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
    return [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]];
  },
};

function mat3inverse(a) { // column-major 3x3
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22] = a;  // a{col}{row}
  const b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20;
  const det = a00 * b01 + a01 * b11 + a02 * b21;
  const id = 1 / det;
  return [b01 * id, (-a22 * a01 + a02 * a21) * id, (a12 * a01 - a02 * a11) * id,
          b11 * id, (a22 * a00 - a02 * a20) * id, (-a12 * a00 + a02 * a10) * id,
          b21 * id, (-a21 * a00 + a01 * a20) * id, (a11 * a00 - a01 * a10) * id];
}

// ------------------------------------------------------------------ meshes
const TAU = Math.PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Periodic parametric surface: f(u, v) -> point, core(u, v) -> a point inside (for normal orientation).
// Vertices form a (nu + 1) x (nv + 1) grid, index i * (nv + 1) + j; tests use that layout.
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
  return orient({ P, N, I, nu, nv });
}

// Make triangles counter-clockwise seen from the normal side (WebGL front faces).
function orient(m) {
  const at = (k) => [m.P[3 * k], m.P[3 * k + 1], m.P[3 * k + 2]];
  for (let k = 0; k < m.I.length; k += 3) {
    const face = cross(sub(at(m.I[k + 1]), at(m.I[k])), sub(at(m.I[k + 2]), at(m.I[k])));
    const n = [m.N[3 * m.I[k]], m.N[3 * m.I[k] + 1], m.N[3 * m.I[k] + 2]];
    if (dot(face, n) < 0) { const t = m.I[k + 1]; m.I[k + 1] = m.I[k + 2]; m.I[k + 2] = t; }
  }
  return { ...m, P: new Float32Array(m.P), N: new Float32Array(m.N), I: new Uint32Array(m.I) };
}

// A box made of six separate faces, like TouchDesigner's Box SOP by default:
// every edge and corner has several vertices at one position with different normals.
function box(size, divs) {
  const P = [], N = [], I = [];
  const h = size / 2;
  const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (const [axis, sign] of faces) {
    const a = (axis + 1) % 3, b = (axis + 2) % 3;
    const base = P.length / 3;
    for (let i = 0; i <= divs; i++) for (let j = 0; j <= divs; j++) {
      const p = [0, 0, 0];
      p[axis] = sign * h; p[a] = -h + size * i / divs; p[b] = -h + size * j / divs;
      const n = [0, 0, 0]; n[axis] = sign;
      P.push(...p); N.push(...n);
    }
    for (let i = 0; i < divs; i++) for (let j = 0; j < divs; j++) {
      const k = base + i * (divs + 1) + j, l = base + (i + 1) * (divs + 1) + j;
      I.push(k, l, k + 1, l, l + 1, k + 1);
    }
  }
  return orient({ P, N, I });
}

function grid(sx, sy, rows, cols) {  // open sheet in the XY plane, normals +Z
  const P = [], N = [], I = [];
  for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) {
    P.push(-sx / 2 + sx * i / cols, -sy / 2 + sy * j / rows, 0); N.push(0, 0, 1);
  }
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const a = i * (rows + 1) + j, b = (i + 1) * (rows + 1) + j;
    I.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return orient({ P, N, I, nu: cols, nv: rows });
}

function sphere(rows) {  // unit sphere, rows x 2 rows, like a Sphere SOP mesh
  return surface((u, v) => { const a = u * TAU, b = v * Math.PI;
    return [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)]; },
  () => [0, 0, 0], 2 * rows, rows);
}

const MESHES = {
  sphere: (detail) => sphere(detail || 128),
  // Same sphere with every normal zero: a SOP without normals.
  sphere_nonormals: (detail) => { const m = sphere(detail || 128); return { ...m, N: new Float32Array(m.N.length) }; },
  // Same as the TouchDesigner demo: Torus SOP, orient Z, radx 1, rady 0.45.
  torus: (detail) => surface(
    (u, v) => { const a = u * TAU, b = v * TAU, R = 1.0, r = 0.45;
      return [(R + r * Math.cos(b)) * Math.cos(a), (R + r * Math.cos(b)) * Math.sin(a), r * Math.sin(b)]; },
    (u) => [Math.cos(u * TAU), Math.sin(u * TAU), 0], detail || 128, (detail || 128) / 2),
  box: (detail) => box(1.5, Math.max(2, Math.floor((detail || 128) / 4))),
  grid: (detail) => grid(3, 2, detail || 128, Math.floor((detail || 128) * 1.5)),
  knot: () => {
    const c = (t) => { const a = t * TAU; const r = 2 + Math.cos(3 * a);
      return [0.42 * r * Math.cos(2 * a), 0.42 * r * Math.sin(2 * a), 0.42 * Math.sin(3 * a)]; };
    const frame = (t) => {
      const e = 1e-3; const T = norm(sub(c(t + e), c(t - e)));
      const acc = sub(sub(c(t + e), c(t)), sub(c(t), c(t - e)));
      const Nn = norm(sub(acc, T.map((x) => x * dot(acc, T))));
      return [T, Nn, cross(T, Nn)];
    };
    return surface((u, v) => { const [, Nn, B] = frame(u); const p = c(u), b = v * TAU, r = 0.24;
      return [0, 1, 2].map((k) => p[k] + r * (Math.cos(b) * Nn[k] + Math.sin(b) * B[k])); },
    (u) => c(u), 360, 48);
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

function program(gl, vs, fs, label, feedback) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, label + ' vertex'));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, label + ' pixel'));
  gl.bindAttribLocation(p, 0, 'P');
  gl.bindAttribLocation(p, 1, 'N');
  gl.bindAttribLocation(p, 0, 'aPos');
  if (feedback) gl.transformFeedbackVaryings(p, feedback, gl.SEPARATE_ATTRIBS);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(label + ' link: ' + gl.getProgramInfoLog(p));
  return p;
}

function target(gl, w, h, internal, withDepth, buffers = 1) {
  const type = internal === gl.RGBA8 ? gl.UNSIGNED_BYTE : internal === gl.RGBA32F ? gl.FLOAT : gl.HALF_FLOAT;
  const filter = internal === gl.RGBA32F ? gl.NEAREST : gl.LINEAR;  // 32-bit float is not filterable in WebGL2
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const texs = [];
  for (let i = 0; i < buffers; i++) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
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
// Covers the delivered bindings, the core's, and the 6a58487 forms (clock() with
// absTime, menuIndex) so the reference material can be drawn too.
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
  if (expr === "op('presets').module.flow_time(parent())") return ctx.flowTime();
  if (expr === "op('presets').module.decode_colours(parent())") return ctx.decodeColours();
  // 6a58487 forms (checks/reference/study.json)
  if ((m = expr.match(/^op\('presets'\)\.module\.clock\(parent\(\)\.par\.(\w+), absTime\.seconds(?:, (\d+))?\)$/)))
    return ctx.clock(m[1], m[2] ? Number(m[2]) : 0);
  if ((m = expr.match(/^parent\(\)\.par\.(\w+)\.menuIndex$/))) return ctx.menuIndex(m[1]);
  if ((m = expr.match(/^parent\(\)\.par\.(\w+) \* ([\d.]+)$/))) return ctx.p[m[1]] * parseFloat(m[2]);
  if ((m = expr.match(/^parent\(\)\.par\.(\w+)$/))) return Number(ctx.p[m[1]]);
  if ((m = expr.match(/^1 if parent\(\)\.par\.(\w+)\.eval\(\) else 0$/)))  // TOP connected, or a toggle
    return (m[1] in ctx.connected ? ctx.connected[m[1]] : ctx.p[m[1]]) ? 1 : 0;
  throw new Error('preview cannot evaluate study.json expression: ' + expr);
}

// ------------------------------------------------------------------ preview
async function createPreview(canvas, which = 'flow') {
  const files = STUDIES[which];
  const text = async (path) => {
    const r = await fetch(files.root + path, { cache: 'no-store' });
    if (!r.ok) throw new Error('fetch ' + path + ' ' + r.status);
    return r.text();
  };
  const [studyText, presetText, vert, frag, backdrop, env, refStudyText, refVert, refFrag, refBackdrop, refCoreFrag] = await Promise.all([
    text(files.study), text(files.presets), text(files.vert), text(files.frag),
    text('backdrop.frag'), text('env.frag'),
    text(REFERENCE.study), text(REFERENCE.vert), text(REFERENCE.frag), text(REFERENCE.backdrop), text(REFERENCE.coreFrag)]);
  const study = JSON.parse(studyText);
  const refStudy = JSON.parse(refStudyText);
  const presets = JSON.parse(presetText);

  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
  const HDR = floatTargets ? gl.RGBA16F : gl.RGBA8;
  const DATA = floatTargets ? gl.RGBA32F : gl.RGBA8;  // render_back: rgba32float

  // Glass programs, compiled on first use: the delivered shaders, the 6a58487
  // flow shaders (reference), or the delivered vertex shader with the core's
  // 6a58487 pixel shader; with 1 or more colour buffers, and (tests only) a
  // higher sample cap. A second set records the vertex outputs (transform feedback).
  const programs = {};
  function sources(opts) {
    if (opts.reference) return { vs: refVert, fs: refFrag, define: true, label: 'flow (6a58487)' };
    if (opts.pixelStage === 'core6a58487') return { vs: vert, fs: refCoreFrag, define: true, label: 'flow vertex + core pixel (6a58487)' };
    return { vs: vert, fs: frag, define: false, label: which };
  }
  function glassProgram(opts, buffers = 1, feedback = null) {
    const src = sources(opts);
    const key = [src.label, buffers, opts.sampleCap || 0, feedback ? feedback.join() : ''].join(':');
    if (programs[key]) return programs[key];
    let fs = src.fs;
    if (opts.sampleCap) {  // a test-only copy that allows more than 32 spectrum samples
      const edits = [['clamp(int(uState.z + 0.5), 1, 32)', `clamp(int(uState.z + 0.5), 1, ${opts.sampleCap})`],
        ['for (int i = 0; i < 32; i++)', `for (int i = 0; i < ${opts.sampleCap}; i++)`]];
      for (const [from, to] of edits) {
        if (fs.split(from).length !== 2) throw new Error('sampleCap patch did not apply: ' + from);
        fs = fs.replace(from, to);
      }
    }
    return (programs[key] = program(gl, MAT_VERTEX_PRELUDE + src.vs, matPixelPrelude(buffers, src.define) + fs,
      src.label + ' material', feedback));
  }
  glassProgram({});
  const feedbackNames = ['vWorldPos', 'vWorldNormal'].concat(vert.includes('out float vFlow;') ? ['vFlow'] : []);
  const backdropProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + backdrop, 'backdrop');
  const refBackdropProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + refBackdrop, 'backdrop (6a58487)');
  const envProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + env, 'env');
  const blit = program(gl, TOP_VERTEX, BLIT_PIXEL, 'blit');
  const uvProg = program(gl, TOP_VERTEX, UV_PIXEL, 'uv ramp');
  const occluderProg = program(gl, OCCLUDER_VERTEX, OCCLUDER_PIXEL, 'occluder');

  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  const qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const meshCache = {};
  // rest: optional { scale, offset } applied to the rest positions (a bigger
  // model away from the SOP origin); normals are unchanged.
  function mesh(name, detail, rest) {
    const key = name + ':' + (detail || '') + ':' + JSON.stringify(rest || null);
    if (meshCache[key]) return meshCache[key];
    let m = MESHES[name](detail);
    if (rest) {
      const k = rest.scale ?? 1, o = rest.offset || [0, 0, 0];
      m = { ...m, P: m.P.map((x, i) => x * k + o[i % 3]) };
    }
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
    gl.bindVertexArray(null);
    return (meshCache[key] = { vao, count: m.I.length, vertices: m.P.length / 3, data: m });
  }

  const W = canvas.width, H = canvas.height;
  const backdropTarget = target(gl, W, H, HDR, false);
  const sceneTarget = target(gl, W, H, HDR, false);       // the backdrop as a mirrored build would deliver it
  const occluderScene = target(gl, W, H, HDR, true);      // the scene render with an opaque ball in front of the glass
  const envTarget = target(gl, 1024, 512, HDR, false);
  const envMirrored = target(gl, 1024, 512, HDR, false);  // a flat-image Reflection TOP delivered upside down
  const backTarget = target(gl, W, H, DATA, true);        // render_back: rgba32float, read with texelFetch
  const backMirrored = target(gl, W, H, DATA, false);     // the back-face pass delivered upside down
  const backHalf = target(gl, W, H, HDR, true);           // the 6a58487 back-face pass (rgba16float, mipmapped)
  const probeTarget = target(gl, W, H, HDR, true);        // the glass alone, unblended (rgba16float, like the demo render)
  const mrtTarget = target(gl, W, H, HDR, true, 3);       // a Render TOP with three colour buffers
  const blackTarget = target(gl, 4, 4, gl.RGBA8, false);  // an unconnected sampler

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
  const blitFrom = (tex, mirror) => (prog) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, 'sTex'), 0);
    gl.uniform1f(gl.getUniformLocation(prog, 'uMirror'), mirror ? 1 : 0);
  };

  function mipmaps(t) {  // like the GLSL MAT sampler filter 'Mipmap Linear'
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  // The demo backdrop (its uniforms evaluated from study.json, so the Backdrop menu
  // works), the 6a58487 backdrop, a flat premultiplied colour (opts.flatBackdrop,
  // [r, g, b] or [r, g, b, a]) for tests that need a uniform or transparent scene,
  // or a UV ramp (opts.uvBackdrop) for tests that measure where a pixel looked.
  let backdropState = null;
  function paintBackdrop(opts, ctx, spec) {
    const colour = opts.flatBackdrop;
    const node = spec.nodes.find((n) => n.id === 'demo_backdrop');
    const values = (node.uniforms || []).map((u) => u.values.map((e) => evaluate(e, ctx)));
    const key = opts.uvBackdrop ? 'uv' : colour ? 'flat:' + colour.join(',') : (opts.reference ? 'ref' : 'demo:' + JSON.stringify(values));
    if (key === backdropState) return;
    if (opts.uvBackdrop) {
      fullscreen(uvProg, backdropTarget, W, H);
    } else if (colour) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, backdropTarget.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(colour[0], colour[1], colour[2], colour[3] ?? 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else {
      fullscreen(opts.reference ? refBackdropProg : backdropProg, backdropTarget, W, H, (prog) => {
        (node.uniforms || []).forEach((u, i) => {
          const v = [...values[i]]; while (v.length < 4) v.push(0);
          gl.uniform4f(gl.getUniformLocation(prog, u.name), v[0], v[1], v[2], v[3]);
        });
      });
    }
    mipmaps(backdropTarget);
    backdropState = key;
  }
  fullscreen(envProg, envTarget, 1024, 512);
  mipmaps(envTarget);
  fullscreen(blit, envMirrored, 1024, 512, blitFrom(envTarget.tex, true));
  mipmaps(envMirrored);

  // Sampler settings from study.json, like the builder's samplerNfilter / extendu / extendv.
  const FILTERS = { nearest: [gl.NEAREST, gl.NEAREST], linear: [gl.LINEAR, gl.LINEAR],
    mipmaplinear: [gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR] };
  const WRAPS = { hold: gl.CLAMP_TO_EDGE, repeat: gl.REPEAT, mirror: gl.MIRRORED_REPEAT };
  function samplerState(u) {
    const f = FILTERS[u.filter || 'linear'], s = WRAPS[u.extendu || 'hold'], t = WRAPS[u.extendv || 'hold'];
    if (!f || !s || !t) throw new Error('preview cannot apply sampler settings of ' + u.name);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f[0]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f[1]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, s);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, t);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, blackTarget.fb);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  // Unbind it again: a framebuffer whose texture is also bound to a sampler
  // makes every later draw fail with INVALID_OPERATION.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const glCheck = (what) => { const e = gl.getError(); if (e !== gl.NO_ERROR) throw new Error(what + ': GL error ' + e); };
  glCheck('preview setup');

  // presets.py advance(): paused, rate x Fixed time; running, the previous value plus
  // rate x the seconds since the previous frame (rate x time on a first frame); rate 0
  // holds. Wrapped like Python's % (never negative). `time` stands for absTime.seconds.
  // Each call is a first frame unless opts.drift === 'continue' (or the older
  // integrate: true), so single renders stay repeatable; 'continue' plays
  // consecutive frames, as a running component does.
  let motion = {};
  function advanceValue(name, rate, period, time, paused, fixedTime) {
    const wrap = (x) => (period === Infinity ? x : ((x % period) + period) % period);
    if (paused) { const v = wrap(rate * fixedTime); motion[name] = [v, null]; return v; }
    let s = motion[name];
    if (rate === 0) { if (!s) s = motion[name] = [0, null]; s[1] = null; return s[0]; }
    if (!s) s = motion[name] = [wrap(rate * time), time];
    else if (s[1] === null || time < s[1]) s[1] = time;
    else { s[0] = wrap(s[0] + rate * (time - s[1])); s[1] = time; }
    return s[0];
  }

  function parameters(opts) {
    const spec = opts.reference ? refStudy : study;
    const p = {};
    for (const c of spec.controls) if (c.default !== null && c.default !== undefined) p[c.name] = c.default;
    const preset = opts.preset || presets.default;
    if (preset !== 'custom') Object.assign(p, presets.presets[preset].values);
    Object.assign(p, opts.overrides || {});
    return p;
  }

  // Everything one draw needs: parameters, expression context and transforms.
  function setup(opts) {
    const spec = opts.reference ? refStudy : study;
    const controls = Object.fromEntries(spec.controls.map((c) => [c.name, c]));
    const p = parameters(opts);
    const time = opts.time ?? p.Time;
    if (opts.drift !== 'continue' && !opts.integrate) motion = {};
    const paused = !!p.Pause;
    const connected = { Refractiontop: opts.refraction !== false, Reflectiontop: opts.reflection !== false };
    const morphTarget = presets.presets[p.Morphtarget].values;
    const morphed = (k) => (p.Morph > 0 ? p[k] + ((morphTarget[k] ?? p[k]) - p[k]) * p.Morph : p[k]);
    const ctx = {
      p, time, connected, morphed,
      menuIndex: (k) => { const i = controls[k].names.indexOf(p[k]); if (i < 0) throw new Error('menu ' + k); return i; },
      // presets.py phase(): the integral of rate x morphed Wobble speed, wrapped to 0..256.
      phase: (rate) => advanceValue('phase' + rate, rate * morphed('Wobblespeed'), 256, time, paused, p.Time),
      // presets.py flow_time(): the integral of morphed Flow speed, wrapped to 0..25600.
      flowTime: () => advanceValue('flow', morphed('Flowspeed'), 25600, time, paused, p.Time),
      // presets.py decode_colours(): the preview stands in for a pass-through project.
      decodeColours: () => (p.Colourspace === 'srgb' ? 1 : 0),
      // 6a58487 presets.py clock(speed, absTime.seconds, wrap): the same integral.
      clock: (k, wrap) => advanceValue('clock' + k, morphed(k), wrap > 0 ? wrap : Infinity, time, paused, p.Time),
    };
    const aspect = W / H;
    const proj = opts.ortho
      ? mat4.ortho(opts.ortho, aspect, opts.near ?? 0.01, opts.far ?? 100)
      : mat4.perspective((opts.fov ?? 45) * Math.PI / 180, aspect, opts.near ?? 0.1, opts.far ?? 100);
    const camZ = opts.cameraZ ?? spec.nodes.find((n) => n.id === 'demo_cam').parameters.tz;  // the demo camera's distance
    const camInverse = mat4.translate(0, 0, camZ);
    const cam = mat4.translate(0, 0, -camZ);
    // demo_geo ry = presets.py spin(); opts.spin fixes the rate for tests (stateless).
    const spin = (opts.spin !== undefined ? opts.spin * time
      : advanceValue('spin', p.Demospin, 360, time, paused, p.Time)) * Math.PI / 180;
    const sc = opts.scale ? (Array.isArray(opts.scale) ? opts.scale : [opts.scale, opts.scale, opts.scale]) : [1, 1, 1];
    // The Geometry COMP's transform (TouchDesigner's uTDMats[].world).
    const base = mat4.mul(mat4.mul(mat4.rotY(spin), mat4.rotX((opts.tilt ?? 20) * Math.PI / 180)), mat4.scale(...sc));
    return { spec, p, ctx, time, connected, proj, cam, camInverse, base, uniforms: opts.uniforms || null };
  }

  // Binds one material's uniforms and samplers. textures: what each sampler reads this draw.
  function bindMaterial(prog, nodeId, s, world, instance, instanceMat, textures, raster) {
    const n = s.spec.nodes.find((x) => x.id === nodeId);
    gl.useProgram(prog);
    const loc = (name) => gl.getUniformLocation(prog, name);
    gl.uniformMatrix4fv(loc('uPreviewInstanceMat'), false, instanceMat || mat4.identity());
    gl.uniformMatrix4fv(loc('uTDMats[0].world'), false, world);
    gl.uniformMatrix4fv(loc('uTDMats[0].worldInverse'), false, mat4.affineInverse(world));
    gl.uniformMatrix4fv(loc('uTDMats[0].cam'), false, s.cam);
    gl.uniformMatrix4fv(loc('uTDMats[0].camInverse'), false, s.camInverse);
    gl.uniformMatrix4fv(loc('uTDMats[0].proj'), false, s.proj);
    gl.uniformMatrix3fv(loc('uTDMats[0].worldForNormals'), false, mat4.normal3(world));
    gl.uniform4f(loc('uTDGeneral.viewport'), 0, 0, 1 / W, 1 / H);
    gl.uniform1i(loc('uPreviewInstance'), instance || 0);
    gl.uniform4f(loc('uPreview'), 1, raster ?? 1, 0, 0);
    const fog = (textures && textures.fog) || [0, 0, 0, 0];
    gl.uniform4f(loc('uPreviewFog'), fog[0], fog[1], fog[2], fog[3]);
    let unit = 0;
    for (const u of n.uniforms) {
      if (u.kind === 'sampler') {
        const expr = u.values[0];
        let tex = blackTarget.tex;
        if (textures) {
          if (expr.includes('Refractiontop') && s.connected.Refractiontop) tex = textures.scene;
          if (expr.includes('Reflectiontop') && s.connected.Reflectiontop) tex = textures.env;
          if (expr.includes('render_back') && s.p.Backface) tex = textures.back;
        }
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (tex !== blackTarget.tex) samplerState(u);
        gl.uniform1i(loc(u.name), unit++);
      } else {
        const v = u.values.map((e) => evaluate(e, s.ctx));
        while (v.length < 4) v.push(0);
        // opts.uniforms (tests only): { uName: [x, y, z, w] } sets the non-null components by
        // hand, for values no control can reach (a hand-wired material, e.g. uFilm.w = 0).
        const set = s.uniforms && s.uniforms[u.name];
        if (set) set.forEach((x, i) => { if (x !== null && x !== undefined) v[i] = x; });
        gl.uniform4f(loc(u.name), v[0], v[1], v[2], v[3]);
      }
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  // Each instance is drawn as its own draw call with its own TDInstanceID()
  // and instance transform (translate, rotate r in degrees XYZ, uniform scale s),
  // inside the Geometry COMP's transform, as in TouchDesigner.
  function instances(opts, s) {
    const list = opts.instances || [{ t: [0, 0, 0], s: 1, id: 0 }];
    const rad = Math.PI / 180;
    return list.map((it) => {
      const r = it.r || [0, 0, 0], k = it.s ?? 1;
      const rot = mat4.mul(mat4.rotZ(r[2] * rad), mat4.mul(mat4.rotY(r[1] * rad), mat4.rotX(r[0] * rad)));
      const inst = mat4.mul(mat4.translate(...(it.t || [0, 0, 0])), mat4.mul(rot, mat4.scale(k, k, k)));
      return { id: it.id ?? 0, world: s.base, inst };
    });
  }

  let lastProbe = null;
  let lastBuffers = null;

  // Draws one frame. opts: preset, overrides, mesh, detail, rest, time, drift, spin, tilt,
  // scale (Geometry COMP scale, a number or [x, y, z]), instances, cameraZ, fov, ortho, near, far,
  // refraction / reflection (false = unconnected), flatBackdrop, uvBackdrop, backdropOnly, showEnv, glassOnly
  // (transparent background, no backdrop), reference (the 6a58487 flow material and bindings),
  // pixelStage ('core6a58487': the core's 6a58487 pixel shader on the delivered vertex shader),
  // fog ([r, g, b, amount], test model), flipRaster (screen y runs opposite to the projection's y;
  // the scene behind, the back-face pass and a flat-image Reflection TOP come from the same
  // build, so they are mirrored too), mirrorInputs (those inputs arrive upside down relative to
  // this render, the case Flip V exists for), probe (draw the glass alone, unblended, into an
  // rgba16float target and keep its floats), buffers (draw into a target with this many colour
  // buffers, unblended, and keep each buffer's floats), readBack (keep the back-face pass's
  // floats), sampleCap (tests: allow more than 32 spectrum samples), uniforms (tests: set uniform
  // components by hand, see bindMaterial), occluder (an opaque ball between the camera and the
  // glass, in the scene render that the glass refracts and that the final image shows;
  // occluder.renderPass draws the glass into that render keeping its depth, as the README's
  // Render Pass TOP does; without it the glass is laid over the scene, as an Over TOP does).
  function draw(opts = {}) {
    const s = setup(opts);
    paintBackdrop(opts, s.ctx, s.spec);
    const m = mesh(opts.mesh || s.p.Demoobject || 'torus', opts.detail || s.p.Demodetail, opts.rest);

    // The scene render as this build delivers it: mirrored when exactly one of the
    // raster or the inputs runs the other way.
    const rasterFlip = opts.flipRaster ? -1 : 1;
    const inputsMirrored = !!opts.flipRaster !== !!opts.mirrorInputs;
    let sceneTex = backdropTarget;
    if (inputsMirrored) {
      fullscreen(blit, sceneTarget, W, H, blitFrom(backdropTarget.tex, true));
      mipmaps(sceneTarget);
      sceneTex = sceneTarget;
    }
    // The occluder ball (Liquid Glass Prism's test scene, placed for this study's camera at z 4):
    // in front of the demo sphere, over its upper right part.
    const occluderWorld = mat4.mul(mat4.translate(0.35, 0.2, 2.0), mat4.scale(0.3, 0.3, 0.3));
    function drawOccluder(dst) {
      const o = mesh('sphere', 48);
      gl.useProgram(occluderProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(occluderProg, 'uMVP'), false, mat4.mul(s.proj, mat4.mul(s.cam, occluderWorld)));
      gl.uniformMatrix4fv(gl.getUniformLocation(occluderProg, 'uWorld'), false, occluderWorld);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(o.vao);
      gl.drawElements(gl.TRIANGLES, o.count, gl.UNSIGNED_INT, 0);
    }
    if (opts.occluder) {  // the scene render: backdrop, then the ball with depth
      if (inputsMirrored || opts.glassOnly) throw new Error('occluder: not with mirrored inputs or glassOnly');
      fullscreen(blit, occluderScene, W, H, blitFrom(backdropTarget.tex, false));
      gl.bindFramebuffer(gl.FRAMEBUFFER, occluderScene.fb);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      drawOccluder(occluderScene);
      mipmaps(occluderScene);
      sceneTex = occluderScene;
    }
    const back = opts.reference ? backHalf : backTarget;
    const textures = {
      scene: sceneTex.tex,
      // A flat image (screen-mapped) is laid out like the scene render, so it is mirrored with
      // the inputs; a panorama is read by direction and never is.
      env: inputsMirrored && s.p.Reflectmode === 'screen' ? envMirrored.tex : envTarget.tex,
      back: opts.mirrorInputs ? backMirrored.tex : back.tex,
      fog: opts.fog,
    };

    function drawGlass(nodeId, dst, cull, buffers = 1) {
      const prog = glassProgram(opts, buffers);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      if (cull) { gl.enable(gl.CULL_FACE); gl.cullFace(cull); } else gl.disable(gl.CULL_FACE);
      gl.frontFace(rasterFlip < 0 ? gl.CW : gl.CCW);  // a flipped raster reverses the winding
      for (const it of instances(opts, s)) {
        bindMaterial(prog, nodeId, s, it.world, it.id, it.inst, textures, rasterFlip);
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.CULL_FACE);
      gl.frontFace(gl.CCW);
    }

    if (s.p.Backface) {  // render_back: front faces culled, no blending, alpha = distance
      gl.bindFramebuffer(gl.FRAMEBUFFER, back.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND);
      drawGlass('material_back', back, gl.FRONT);
      if (opts.reference) mipmaps(back);  // 6a58487: Mipmap Linear on a 16-bit pass
      if (opts.mirrorInputs) fullscreen(blit, backMirrored, W, H, blitFrom(backTarget.tex, true));
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
    if (opts.probe || opts.buffers) {  // the glass alone, unblended, in float
      const buffers = opts.buffers || 1;
      const dst = buffers > 1 ? mrtTarget : probeTarget;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, W, H);
      for (let i = 0; i < buffers; i++) gl.clearBufferfv(gl.COLOR, i, opts.clearBuffers || [0, 0, 0, 0]);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND);
      drawGlass('material', dst, s.p.Culling === 'back' ? gl.BACK : null, buffers);
      lastBuffers = Array.from({ length: buffers }, (_, i) => readFloats(dst.fb, i));
      lastProbe = lastBuffers[0];
      return { floatTargets };
    }
    if (opts.readBack) {  // the back-face pass's floats (rgb colour, a distance)
      lastProbe = readFloats(back.fb, 0);
      return { floatTargets };
    }

    // over: backdrop, then the glass with premultiplied blending (One, One Minus Src Alpha).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, opts.glassOnly ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!opts.glassOnly) {
      const behind = opts.showEnv ? envTarget : (opts.occluder ? occluderScene : backdropTarget);
      fullscreen(blit, null, W, H, blitFrom(behind.tex, opts.flipRaster && !opts.showEnv));
      if (opts.showEnv || opts.backdropOnly) return { floatTargets };
    }
    // Render Pass TOP route: the glass is drawn into the scene render, whose depth is kept,
    // so the ball's depth is in the buffer before the glass (its colour already is).
    if (opts.occluder && opts.occluder.renderPass) drawOccluder(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    drawGlass('material', null, s.p.Culling === 'back' ? gl.BACK : null);
    gl.disable(gl.BLEND);
    return { floatTargets };
  }

  // Evaluate the material's uniform bindings without drawing: advances the
  // integrating clocks by one frame (like TouchDesigner cooking the MAT).
  function advance(opts = {}) {
    const s = setup(opts);
    for (const u of s.spec.nodes.find((n) => n.id === 'material').uniforms)
      if (u.kind !== 'sampler') u.values.forEach((e) => evaluate(e, s.ctx));
  }

  // Run only the vertex stage on every vertex and read back what it wrote.
  function vertices(opts = {}) {
    const s = setup(opts);
    const m = mesh(opts.mesh || s.p.Demoobject || 'torus', opts.detail || s.p.Demodetail, opts.rest);
    const it = instances(opts, s)[0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    glCheck('before the vertex stage');
    const prog = glassProgram(opts, 1, feedbackNames);
    bindMaterial(prog, 'material', s, it.world, it.id, it.inst, null, 1);
    const sizes = { vWorldPos: 3, vWorldNormal: 3, vFlow: 1 };
    const buffers = feedbackNames.map((name, i) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, b);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, m.vertices * sizes[name] * 4, gl.STREAM_READ);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, i, b);
      return b;
    });
    gl.bindVertexArray(m.vao);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, m.vertices);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    glCheck('vertex stage');  // a failed draw would read back zeros and let tests pass
    const out = { count: m.vertices, rest: Array.from(m.data.P), restNormal: Array.from(m.data.N),
                  nu: m.data.nu, nv: m.data.nv, world: Array.from(it.world), instance: Array.from(it.inst) };
    feedbackNames.forEach((name, i) => {
      const data = new Float32Array(m.vertices * sizes[name]);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buffers[i]);
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, data);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, i, null);
      gl.deleteBuffer(buffers[i]);
      out[name] = Array.from(data);
    });
    gl.bindVertexArray(null);
    return out;
  }

  function pixels() {
    const out = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
    glCheck('render');
    return out;  // rows bottom to top
  }

  const resetClocks = () => { motion = {}; };
  return { draw, vertices, advance, resetClocks, pixels, study, presets, floatTargets, size: [W, H],
    lastProbe: () => lastProbe, lastBuffers: () => lastBuffers };
}

window.createPreview = createPreview;
