// WebGL2 preview of the Liquid Glass Blobs study.
//
// It compiles the delivered GLSL files unchanged, behind small stand-ins for
// TouchDesigner's built-ins, and packs uniforms by evaluating the binding
// expressions in study.json. It mirrors the demo network:
//   demo_backdrop + demo_ring (render_scene)  -> scene  (the Refraction TOP)
//   blobs_geo + demo_ring (render), over scene -> out
// The stand-in projection keeps TouchDesigner's documented Vulkan-style
// depth range (0..1) in uTDMats[].proj; TDWorldToProj converts it to WebGL's
// -1..1 clip range, so the shader's gl_FragDepth means the same thing here.
// Options for the tests: other projections (orthographic, a blend), a
// transparent Refraction TOP composited over the backdrop afterwards, a UV-ramp
// backdrop (reads back where each pixel sampled), objects drawn after the
// blobs, a stand-in fog for TDFog(), a raster that runs screen y the other way
// (flipRaster) and a Refraction TOP that arrives upside down (mirrorInputs),
// consecutive frames of the integrated drift (drift: 'continue'), fixed
// drift phases (phase) and a 4x multisampled output (multisample). A test may instrument blobs.frag before the page
// loads (window.previewPatch: [from, to] string replacements, each anchor
// found exactly once) and set the render size (?w=&h=).
// It is a look-development and test aid. It does not verify TouchDesigner.
// Adapted from the liquid-glass study's checks/preview/preview.js (commits
// a6f95c6 and 6a58487) and the liquid-glass-prism study's orientation
// emulation (commit 6a58487).

const ROOT = '../../';

const ES_HEADER = `#version 300 es
precision highp float;
precision highp int;
`;

const TD_COMMON = `
#define TD_NUM_CAMERAS 1
struct TDMatrix { mat4 world; mat4 cam; mat4 camInverse; mat4 proj; mat4 camProj; mat4 camProjInverse; };
uniform TDMatrix uTDMats[TD_NUM_CAMERAS];
struct TDGeneral { vec4 ambientColor; vec4 viewport; };
uniform TDGeneral uTDGeneral;
`;

// Instances: TDDeform applies uInstance[gl_InstanceID] before the object's world matrix.
// uPreviewRaster.y = -1 emulates a build whose rasteriser runs screen y opposite
// to the y of uTDMats[].proj (a test of the shader's orientation handling;
// TouchDesigner's own convention is a native check).
const MAT_VERTEX_PRELUDE = ES_HEADER + TD_COMMON + `
in vec3 P;
in vec3 N;
uniform mat4 uInstance[4];
uniform vec4 uPreviewRaster;
vec3 TDPos() { return P; }
vec3 TDNormal() { return N; }
vec4 TDDeform(vec4 p) { return uTDMats[0].world * (uInstance[gl_InstanceID] * p); }
int TDCameraIndex() { return 0; }
int TDInstanceID() { return gl_InstanceID; }
vec4 TDWorldToProj(vec4 v) { vec4 c = uTDMats[0].camProj * v; c.z = 2.0 * c.z - c.w; c.y *= uPreviewRaster.y; return c; }
`;

// Stand-in fog: a constant blend toward a fog colour (rgb) by an amount (a); 0 = off,
// like a Camera COMP without fog. TouchDesigner's own fog depends on distance.
const MAT_PIXEL_PRELUDE = ES_HEADER + TD_COMMON + `
uniform vec4 uFogStandIn;
void TDCheckDiscard() {}
vec4 TDOutputSwizzle(vec4 c) { return c; }
vec4 TDFog(vec4 c, vec3 worldSpacePos, int cameraIndex) { return vec4(mix(c.rgb, uFogStandIn.rgb, uFogStandIn.a), c.a); }
`;

// Stand-in for the demo ring's Constant MAT (flat colour), and the depth probe.
const FLAT_VERTEX = MAT_VERTEX_PRELUDE + `
void main() { gl_Position = TDWorldToProj(TDDeform(vec4(TDPos(), 1.0))); }
`;
const FLAT_PIXEL = MAT_PIXEL_PRELUDE + `
uniform vec4 uColor;
uniform float uDepthProbe;
layout(location = 0) out vec4 fragColor;
void main() { fragColor = uDepthProbe > 0.5 ? vec4(vec3(gl_FragCoord.z), 1.0) : uColor; }
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

// A UV ramp: red = u, green = v, blue = 0.5. Through the glass, each pixel then
// reads back exactly where it sampled the Refraction TOP.
const RAMP_PIXEL = TOP_PIXEL_PRELUDE + `
layout(location = 0) out vec4 fragColor;
void main() { fragColor = vec4(vUV.st, 0.5, 1.0); }
`;

const BLIT_PIXEL = TOP_PIXEL_PRELUDE + `
uniform sampler2D sTex;
uniform float uMirror;
layout(location = 0) out vec4 fragColor;
void main() { vec2 st = vUV.st; if (uMirror > 0.5) st.y = 1.0 - st.y; fragColor = texture(sTex, st); }
`;

// ------------------------------------------------------------------ math (column-major)
const mat4 = {
  identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) {
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
  // Vulkan-style depth: z_ndc = 0 at the near plane, 1 at the far plane (TouchDesigner's documented proj).
  // fovX is the horizontal angle, like the Camera COMP's default Horizontal FOV method.
  perspective01(fovX, aspect, near, far) {
    const fx = 1 / Math.tan(fovX / 2), fy = fx * aspect;
    return [fx, 0, 0, 0, 0, fy, 0, 0, 0, 0, far / (near - far), -1, 0, 0, near * far / (near - far), 0];
  },
  // Orthographic, same 0..1 depth: half width and half height of the view in scene units.
  ortho01(halfW, halfH, near, far) {
    return [1 / halfW, 0, 0, 0, 0, 1 / halfH, 0, 0, 0, 0, -1 / (far - near), 0, 0, 0, -near / (far - near), 1];
  },
  invert(m) {  // general 4x4 inverse (cofactors), column-major in and out
    const a = m, o = new Array(16);
    o[0] = a[5]*a[10]*a[15] - a[5]*a[11]*a[14] - a[9]*a[6]*a[15] + a[9]*a[7]*a[14] + a[13]*a[6]*a[11] - a[13]*a[7]*a[10];
    o[4] = -a[4]*a[10]*a[15] + a[4]*a[11]*a[14] + a[8]*a[6]*a[15] - a[8]*a[7]*a[14] - a[12]*a[6]*a[11] + a[12]*a[7]*a[10];
    o[8] = a[4]*a[9]*a[15] - a[4]*a[11]*a[13] - a[8]*a[5]*a[15] + a[8]*a[7]*a[13] + a[12]*a[5]*a[11] - a[12]*a[7]*a[9];
    o[12] = -a[4]*a[9]*a[14] + a[4]*a[10]*a[13] + a[8]*a[5]*a[14] - a[8]*a[6]*a[13] - a[12]*a[5]*a[10] + a[12]*a[6]*a[9];
    o[1] = -a[1]*a[10]*a[15] + a[1]*a[11]*a[14] + a[9]*a[2]*a[15] - a[9]*a[3]*a[14] - a[13]*a[2]*a[11] + a[13]*a[3]*a[10];
    o[5] = a[0]*a[10]*a[15] - a[0]*a[11]*a[14] - a[8]*a[2]*a[15] + a[8]*a[3]*a[14] + a[12]*a[2]*a[11] - a[12]*a[3]*a[10];
    o[9] = -a[0]*a[9]*a[15] + a[0]*a[11]*a[13] + a[8]*a[1]*a[15] - a[8]*a[3]*a[13] - a[12]*a[1]*a[11] + a[12]*a[3]*a[9];
    o[13] = a[0]*a[9]*a[14] - a[0]*a[10]*a[13] - a[8]*a[1]*a[14] + a[8]*a[2]*a[13] + a[12]*a[1]*a[10] - a[12]*a[2]*a[9];
    o[2] = a[1]*a[6]*a[15] - a[1]*a[7]*a[14] - a[5]*a[2]*a[15] + a[5]*a[3]*a[14] + a[13]*a[2]*a[7] - a[13]*a[3]*a[6];
    o[6] = -a[0]*a[6]*a[15] + a[0]*a[7]*a[14] + a[4]*a[2]*a[15] - a[4]*a[3]*a[14] - a[12]*a[2]*a[7] + a[12]*a[3]*a[6];
    o[10] = a[0]*a[5]*a[15] - a[0]*a[7]*a[13] - a[4]*a[1]*a[15] + a[4]*a[3]*a[13] + a[12]*a[1]*a[7] - a[12]*a[3]*a[5];
    o[14] = -a[0]*a[5]*a[14] + a[0]*a[6]*a[13] + a[4]*a[1]*a[14] - a[4]*a[2]*a[13] - a[12]*a[1]*a[6] + a[12]*a[2]*a[5];
    o[3] = -a[1]*a[6]*a[11] + a[1]*a[7]*a[10] + a[5]*a[2]*a[11] - a[5]*a[3]*a[10] - a[9]*a[2]*a[7] + a[9]*a[3]*a[6];
    o[7] = a[0]*a[6]*a[11] - a[0]*a[7]*a[10] - a[4]*a[2]*a[11] + a[4]*a[3]*a[10] + a[8]*a[2]*a[7] - a[8]*a[3]*a[6];
    o[11] = -a[0]*a[5]*a[11] + a[0]*a[7]*a[9] + a[4]*a[1]*a[11] - a[4]*a[3]*a[9] - a[8]*a[1]*a[7] + a[8]*a[3]*a[5];
    o[15] = a[0]*a[5]*a[10] - a[0]*a[6]*a[9] - a[4]*a[1]*a[10] + a[4]*a[2]*a[9] + a[8]*a[1]*a[6] - a[8]*a[2]*a[5];
    const det = a[0] * o[0] + a[1] * o[4] + a[2] * o[8] + a[3] * o[12];
    return o.map((v) => v / det);
  },
};

// TouchDesigner's default transform order (scale, then Rx, Ry, Rz, then translate).
function objectMatrix(t = {}) {
  const deg = Math.PI / 180, s = t.scale ?? [1, 1, 1], r = t.rotate ?? [0, 0, 0], p = t.translate ?? [0, 0, 0];
  let m = mat4.scale(...s);
  m = mat4.mul(mat4.rotX(r[0] * deg), m);
  m = mat4.mul(mat4.rotY(r[1] * deg), m);
  m = mat4.mul(mat4.rotZ(r[2] * deg), m);
  return mat4.mul(mat4.translate(...p), m);
}

// ------------------------------------------------------------------ meshes
const TAU = Math.PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function surface(f, core, nu, nv) {
  const P = [], N = [], I = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const p = f(i / nu, j / nv);
    P.push(...p); N.push(...norm(sub(p, core(i / nu, j / nv))));
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = (i + 1) * (nv + 1) + j;
    I.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { P: new Float32Array(P), N: new Float32Array(N), I: new Uint32Array(I) };
}

const MESHES = {
  // The proxy: Box SOP, size 2 (corners at -1 and 1). Faces wound counter-clockwise seen from outside.
  box: () => {
    const P = [], N = [], I = [];
    const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
                   [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
                   [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
    for (const [n, u, v] of faces) {
      const base = P.length / 3;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        P.push(n[0] + a * u[0] + b * v[0], n[1] + a * u[1] + b * v[1], n[2] + a * u[2] + b * v[2]);
        N.push(...n);
      }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return { P: new Float32Array(P), N: new Float32Array(N), I: new Uint32Array(I) };
  },
  // Torus SOP, orient Z, radx 1.15, rady 0.035 (the demo ring).
  ring: () => surface(
    (u, v) => { const a = u * TAU, b = v * TAU, R = 1.15, r = 0.035;
      return [(R + r * Math.cos(b)) * Math.cos(a), (R + r * Math.cos(b)) * Math.sin(a), r * Math.sin(b)]; },
    (u) => [1.15 * Math.cos(u * TAU), 1.15 * Math.sin(u * TAU), 0], 192, 24),
  // Unit sphere: the rasterized reference for depth tests.
  sphere: () => surface(
    (u, v) => { const a = u * TAU, b = v * Math.PI;
      return [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)]; },
    () => [0, 0, 0], 256, 192),
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

function target(gl, w, h, internal, withDepth) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const type = internal === gl.RGBA8 ? gl.UNSIGNED_BYTE : internal === gl.RGBA32F ? gl.FLOAT : gl.HALF_FLOAT;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
  const filter = internal === gl.RGBA32F ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (withDepth) {
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT32F, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  }
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h, internal };
}

// ------------------------------------------------------------------ study.json expressions
function evaluate(expr, ctx) {
  if (typeof expr === 'number') return expr;
  let m;
  if ((m = expr.match(/^op\('presets'\)\.module\.u\(parent\(\)\.par\.(\w+)\)$/))) return ctx.morphed(m[1]);
  // presets.py sized(): u() times Object size to a power (exactly u() at Object size 1).
  if ((m = expr.match(/^op\('presets'\)\.module\.sized\(parent\(\)\.par\.(\w+), (-?\d+)\)$/))) {
    const size = ctx.p.Objectsize;
    return size === 1 ? ctx.morphed(m[1]) : ctx.morphed(m[1]) * Math.pow(size, parseInt(m[2], 10));
  }
  // The film swirl frequency: a per-unit constant over (reference radius x Object size).
  if ((m = expr.match(/^([\d.]+) \/ \(([\d.]+) \* parent\(\)\.par\.(\w+)\.eval\(\)\)$/)))
    return parseFloat(m[1]) / (parseFloat(m[2]) * ctx.p[m[3]]);
  if ((m = expr.match(/^op\('presets'\)\.module\.menu\(parent\(\)\.par\.(\w+)\)$/))) return ctx.menuIndex(m[1]);
  if ((m = expr.match(/^op\('presets'\)\.module\.phase\(parent\(\), '(\w+)'\)$/))) return ctx.phase(m[1]);
  if (expr === "op('presets').module.decode_colours(parent())") return ctx.decodeColours();
  if ((m = expr.match(/^parent\(\)\.par\.(\w+) \* ([\d.]+)$/))) return ctx.p[m[1]] * parseFloat(m[2]);
  if ((m = expr.match(/^parent\(\)\.par\.(\w+)$/))) return Number(ctx.p[m[1]]);
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

// blob_layout.tsv -> what layout_table -> layout_chop -> layout_top produce: pixel i = (x, y, z, r).
function layoutPixels(tsv) {
  const rows = tsv.trim().split(/\r?\n/).map((l) => l.split('\t'));
  const names = rows[0];
  const col = (n) => names.indexOf(n);
  return rows.slice(1).map((r) => ['x', 'y', 'z', 'r'].map((n) => parseFloat(r[col(n)])));
}

async function createPreview(canvas, patch) {
  let [studyText, presetText, vert, frag, backdrop, env, layoutText] = await Promise.all([
    text('study.json'), text('presets.json'), text('blobs.vert'), text('blobs.frag'),
    text('backdrop.frag'), text('env.frag'), text('blob_layout.tsv')]);
  // Test instrumentation (from the liquid-glass-prism study): each anchor must occur exactly once.
  for (const [from, to] of patch || []) {
    if (frag.split(from).length !== 2) throw new Error('instrumentation anchor not found exactly once: ' + from);
    frag = frag.replace(from, to);
  }
  const study = JSON.parse(studyText);
  const presets = JSON.parse(presetText);
  const node = (id) => study.nodes.find((n) => n.id === id);
  const controls = Object.fromEntries(study.controls.map((c) => [c.name, c]));

  const gl = canvas.getContext('webgl2', { antialias: false, depth: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
  if (!floatTargets) throw new Error('EXT_color_buffer_float unavailable');
  const floatBlend = !!gl.getExtension('EXT_float_blend');  // blending into the 32-bit test target

  const blobs = program(gl, MAT_VERTEX_PRELUDE + vert, MAT_PIXEL_PRELUDE + frag, 'blobs');
  const flat = program(gl, FLAT_VERTEX, FLAT_PIXEL, 'flat');
  const backdropProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + backdrop, 'backdrop');
  const envProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + env, 'env');
  const blit = program(gl, TOP_VERTEX, BLIT_PIXEL, 'blit');
  const rampProg = program(gl, TOP_VERTEX, RAMP_PIXEL, 'ramp');

  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const meshCache = {};
  function mesh(name) {
    if (meshCache[name]) return meshCache[name];
    const m = MESHES[name]();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    for (const [loc, data] of [[0, m.P], [1, m.N]]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.I, gl.STATIC_DRAW);
    return (meshCache[name] = { vao, count: m.I.length });
  }

  const W = canvas.width, H = canvas.height;
  // demo_backdrop, once per Study > Demo backdrop entry (uBackdrop.x = menu index).
  const backdropTargets = controls.Demobackdrop.names.map(() => target(gl, W, H, gl.RGBA16F, false));
  const rampTarget = target(gl, W, H, gl.RGBA32F, false);   // UV ramp for the lens tests
  const envTarget = target(gl, 1024, 512, gl.RGBA16F, false);
  const sceneTarget = target(gl, W, H, gl.RGBA16F, true);   // render_scene over demo_backdrop
  const finalTarget = target(gl, W, H, gl.RGBA32F, true);   // float copy of out, for tests
  const blackTarget = target(gl, 4, 4, gl.RGBA8, false);    // 'blank': an unconnected sampler
  // 4x multisampled 8-bit copy of out, like an antialiased Render TOP (opts.multisample), and the
  // target it resolves into (msPixels()). From the family's multisampled orientation readout.
  const msTarget = (() => {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const colour = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, colour);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.RGBA8, W, H);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colour);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.DEPTH_COMPONENT32F, W, H);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('multisampled framebuffer incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, w: W, h: H };
  })();
  const msResolve = target(gl, W, H, gl.RGBA8, false);

  const layoutRows = layoutPixels(layoutText);
  const layoutTex = gl.createTexture();                      // layout_top: 32-bit float, nearest
  gl.bindTexture(gl.TEXTURE_2D, layoutTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, layoutRows.length, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(layoutRows.flat()));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  function fullscreen(prog, dst, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(prog);
    const res = gl.getUniformLocation(prog, 'uTDOutputInfo.res');
    if (res) gl.uniform4f(res, 1 / w, 1 / h, w, h);
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function mipmaps(t) {  // like the GLSL MAT sampler filter 'Mipmap Linear'
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  backdropTargets.forEach((t, i) => {
    gl.useProgram(backdropProg);
    gl.uniform4f(gl.getUniformLocation(backdropProg, 'uBackdrop'), i, 0, 0, 0);
    fullscreen(backdropProg, t, W, H);
  });
  fullscreen(rampProg, rampTarget, W, H);
  fullscreen(envProg, envTarget, 1024, 512);
  mipmaps(envTarget);
  gl.bindFramebuffer(gl.FRAMEBUFFER, blackTarget.fb);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  function parameters(opts) {
    const p = {};
    for (const c of study.controls) if (c.default !== null && c.default !== undefined) p[c.name] = c.default;
    const preset = opts.preset || presets.default;
    if (preset !== 'custom') Object.assign(p, presets.presets[preset].values);
    Object.assign(p, opts.overrides || {});
    return p;
  }

  // opts.projection: 'perspective' (default), 'ortho' (framing the plane at the camera
  // distance like the perspective view), or 'blend' (opts.blend of the way from the
  // perspective matrix to the orthographic one, element by element: a projection that
  // is neither, standing in for the Camera COMP's other projection modes).
  function projection(opts) {
    const aspect = W / H, z = opts.cameraZ ?? 5, fov = (opts.fov ?? 45) * Math.PI / 180;
    const near = opts.near ?? 0.1, far = opts.far ?? 100;
    const persp = mat4.perspective01(fov, aspect, near, far);
    if (!opts.projection || opts.projection === 'perspective') return persp;
    const halfW = z * Math.tan(fov / 2), ortho = mat4.ortho01(halfW, halfW / aspect, near, far);
    if (opts.projection === 'ortho') return ortho;
    const b = opts.blend ?? 0.5;
    return persp.map((v, i) => v + (ortho[i] - v) * b);
  }

  function camera(opts) {
    const z = opts.cameraZ ?? 5;
    const proj = projection(opts);
    const camInverse = objectMatrix({ translate: [opts.cameraX ?? 0, opts.cameraY ?? 0, z],
                                      rotate: [opts.cameraTilt ?? 0, opts.cameraPan ?? 0, 0] });
    const cam = invertRigid(camInverse);
    const camProj = mat4.mul(proj, cam);
    return { proj, cam, camInverse, camProj, camProjInverse: mat4.invert(camProj) };
  }

  function invertRigid(m) {  // inverse of rotation + translation
    const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
    const t = [m[12], m[13], m[14]];
    r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
    r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
    r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
    return r;
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
    let st = motion[name];
    if (rate === 0) { if (!st) st = motion[name] = [0, null]; st[1] = null; return st[0]; }
    if (!st) st = motion[name] = [wrap(rate * time), time];
    else if (st[1] === null || time < st[1]) st[1] = time;
    else { st[0] = wrap(st[0] + rate * (time - st[1])); st[1] = time; }
    return st[0];
  }
  // presets.py PHASES: rate from the morphed Speed, and where each phase wraps.
  const PHASES = {
    layout: [(speed) => speed, 256 * Math.PI],
    ripple: [(speed) => 0.4 + speed, 20 * Math.PI],
    film: [(speed) => 0.15 * (0.1 + 0.3 * speed), 256],
  };
  let rasterFlip = 1;   // -1 while drawing a flipRaster frame

  function setCommon(prog, cams, world, instances) {
    const loc = (name) => gl.getUniformLocation(prog, name);
    gl.useProgram(prog);
    gl.uniform4f(loc('uPreviewRaster'), 1, rasterFlip, 1, 1);
    gl.uniformMatrix4fv(loc('uTDMats[0].world'), false, world);
    gl.uniformMatrix4fv(loc('uTDMats[0].cam'), false, cams.cam);
    gl.uniformMatrix4fv(loc('uTDMats[0].camInverse'), false, cams.camInverse);
    gl.uniformMatrix4fv(loc('uTDMats[0].proj'), false, cams.proj);
    gl.uniformMatrix4fv(loc('uTDMats[0].camProj'), false, cams.camProj);
    gl.uniformMatrix4fv(loc('uTDMats[0].camProjInverse'), false, cams.camProjInverse);
    gl.uniform4f(loc('uTDGeneral.viewport'), 0, 0, 1 / W, 1 / H);
    const inst = [];
    for (let i = 0; i < 4; i++) inst.push(...(instances[i] || mat4.identity()));
    gl.uniformMatrix4fv(loc('uInstance'), false, new Float32Array(inst));
    return loc;
  }

  function drawMesh(name, count = 1) {
    const m = mesh(name);
    gl.bindVertexArray(m.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0, count);
  }

  function drawFlat(cams, name, world, color, probe) {
    const loc = setCommon(flat, cams, world, []);
    gl.uniform4f(loc('uColor'), ...color);
    gl.uniform1f(loc('uDepthProbe'), probe ? 1 : 0);
    gl.disable(gl.CULL_FACE);
    drawMesh(name);
  }

  // demo_ring ry = presets.py spin(); opts.spin fixes the rate for tests (stateless).
  function ringWorld(opts, p, time) {
    const angle = opts.spin !== undefined ? opts.spin * time : advance('spin', p.Demospin, 360, time, !!p.Pause, p.Time);
    return objectMatrix({ rotate: [70, angle, 0] });
  }

  function drawBlobs(opts, p, cams, time, blend) {
    const connected = { Refractiontop: opts.refraction !== false, Reflectiontop: opts.reflection !== false,
                        Layouttop: opts.layoutTop !== false };
    const morphTarget = presets.presets[p.Morphtarget].values;
    const morphed = (k) => (p.Morph > 0 && k in morphTarget ? p[k] + (morphTarget[k] - p[k]) * p.Morph : p[k]);
    const ctx = {
      p, time, connected, morphed,
      menuIndex: (k) => { const i = controls[k].names.indexOf(p[k]); if (i < 0) throw new Error('menu ' + k); return i; },
      // presets.py phase(); opts.phase = { layout, ripple, film } pins a phase for a test.
      phase: (which) => {
        if (opts.phase && which in opts.phase) return opts.phase[which];
        const [rate, period] = PHASES[which];
        return advance('phase-' + which, rate(morphed('Speed')), period, time, !!p.Pause, p.Time);
      },
      // presets.py decode_colours(): the preview stands in for a pass-through project.
      decodeColours: () => (p.Colourspace === 'srgb' ? 1 : 0),
    };
    const instances = opts.instances || [];
    const loc = setCommon(blobs, cams, objectMatrix(opts.blobs || {}), instances);
    gl.uniform4f(loc('uFogStandIn'), ...(opts.fog || [0, 0, 0, 0]));
    let unit = 0;
    for (const u of node('material').uniforms) {
      if (u.kind === 'sampler') {
        const expr = u.values[0];
        let tex = blackTarget.tex;
        if (expr.includes('Refractiontop') && connected.Refractiontop) tex = sceneTarget.tex;
        if (expr.includes('Reflectiontop') && connected.Reflectiontop) tex = envTarget.tex;
        if (expr.includes('Layouttop') && connected.Layouttop) tex = layoutTex;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc(u.name), unit++);
      } else {
        const v = u.values.map((e) => evaluate(e, ctx));
        while (v.length < 4) v.push(0);
        gl.uniform4f(loc(u.name), v[0], v[1], v[2], v[3]);
      }
    }
    // material: Cull Face = Front Faces (draw the box's back faces), blending One / One Minus Src Alpha.
    // A flipped raster reverses the winding; the emulated build keeps culling consistent.
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.frontFace(rasterFlip < 0 ? gl.CW : gl.CCW);
    // Without EXT_float_blend the 32-bit test target cannot blend; tests that read it use
    // teaching stages, which write alpha 1, so skipping the blend gives the same pixels.
    if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
    drawMesh('box', Math.max(instances.length, 1));
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    gl.activeTexture(gl.TEXTURE0);
  }

  // opts: preset, overrides, time, refraction, reflection, layoutTop, blobs (transform), instances,
  //       ring (default true), spin, cameraZ, fov, near, far, projection, blend, float (render into
  //       the float target), probe (extra rasterized objects: [{mesh, transform, color, depth}]),
  //       probeAfter (draw them after the blobs), blobsOff, fog ([r, g, b, amount] for TDFog),
  //       backdrop ('uv': a UV ramp replaces demo_backdrop), scene ('transparent': the Refraction
  //       TOP is the ring over transparent black, and the backdrop is composited behind afterwards),
  //       flipRaster (the whole build runs screen y the other way: rasteriser and the scene behind),
  //       mirrorInputs (only the Refraction TOP arrives upside down, the case Flip V exists for),
  //       drift ('continue': this draw is the next frame of the previous one), phase (fixed drift
  //       phases { layout, ripple, film }), multisample (draw out into a 4x multisampled 8-bit target,
  //       like an antialiased Render TOP; read it with msPixels())
  function draw(opts = {}) {
    const p = parameters(opts);
    const time = opts.time ?? p.Time;
    if (opts.drift !== 'continue') motion = {};
    const cams = camera(opts);
    const showRing = opts.ring !== false;
    const ringColor = [1.0, 0.45, 0.1, 1.0];
    rasterFlip = opts.flipRaster ? -1 : 1;
    const mirrorScene = opts.flipRaster || opts.mirrorInputs;

    // render_scene over demo_backdrop -> scene (the Refraction TOP)
    const backdrop = opts.backdrop === 'uv' ? rampTarget : backdropTargets[controls.Demobackdrop.names.indexOf(p.Demobackdrop)];
    const transparentScene = opts.scene === 'transparent';
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(blit);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, backdrop.tex);
    gl.uniform1i(gl.getUniformLocation(blit, 'sTex'), 0);
    gl.uniform1f(gl.getUniformLocation(blit, 'uMirror'), mirrorScene ? 1 : 0);
    fullscreen(blit, sceneTarget, W, H);
    gl.uniform1f(gl.getUniformLocation(blit, 'uMirror'), 0);
    if (transparentScene) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // mirrorInputs: the ring is drawn normally into the scene and the whole TOP is then
    // turned upside down; tests that use it hide the ring.
    if (showRing) drawFlat(cams, 'ring', ringWorld(opts, p, time), ringColor, false);
    gl.disable(gl.DEPTH_TEST);
    mipmaps(sceneTarget);

    // render (blobs + ring, depth tested) over 'behind' (= scene) -> out
    const dst = opts.multisample ? msTarget : opts.float ? finalTarget : null;
    gl.useProgram(blit);
    gl.activeTexture(gl.TEXTURE0);
    // With a transparent Refraction TOP, the backdrop stands for the background the user
    // composites behind the final render later (Over TOP): blending the blobs straight onto
    // it gives the same premultiplied result.
    gl.bindTexture(gl.TEXTURE_2D, opts.showEnv ? envTarget.tex
      : (opts.backdropOnly || transparentScene) ? backdrop.tex : sceneTarget.tex);
    gl.uniform1i(gl.getUniformLocation(blit, 'sTex'), 0);
    fullscreen(blit, dst, W, H);
    if (opts.clear) { gl.clearColor(...opts.clear); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, W, H);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    if (opts.showEnv || opts.sceneOnly || opts.backdropOnly) return { floatTargets };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    if (showRing) drawFlat(cams, 'ring', ringWorld(opts, p, time), ringColor, false);
    const probes = () => { for (const extra of opts.probe || [])
      drawFlat(cams, extra.mesh, objectMatrix(extra.transform), extra.color || [1, 0, 0, 1], !!extra.depth); };
    // Draw order: like blobs_geo with a lower Draw Priority than everything else (drawn last),
    // unless probeAfter asks for the opposite to show what goes wrong.
    if (!opts.probeAfter) probes();
    if (!opts.blobsOff) drawBlobs(opts, p, cams, time, !opts.float || floatBlend);
    if (opts.probeAfter) probes();
    gl.disable(gl.DEPTH_TEST);
    if (opts.multisample) {  // resolve the four samples of each pixel, as a Render TOP's antialiasing does
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msTarget.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, msResolve.fb);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    return { floatTargets };
  }

  function msPixels() {  // RGBA8 readback of the last draw({multisample: true}), resolved, rows bottom to top
    const out = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, msResolve.fb);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  function pixels() {  // RGBA8 readback of the canvas, rows bottom to top
    const out = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  function floats() {  // float readback of the last draw({float: true}), rows bottom to top
    const out = new Float32Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, finalTarget.fb);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  return { draw, pixels, floats, msPixels, study, presets, floatTargets, floatBlend, size: [W, H], layoutRows, camera, mat4 };
}

window.createPreview = createPreview;
