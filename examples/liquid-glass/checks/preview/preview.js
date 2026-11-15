// WebGL2 preview of the Liquid Glass study.
//
// It compiles the delivered GLSL files unchanged, behind small stand-ins for
// TouchDesigner's built-ins, and packs uniforms by evaluating the binding
// expressions in study.json. It mirrors the demo network: backdrop GLSL TOP,
// panorama GLSL TOP, optional back-face pass, glass rendered over the backdrop.
// It is a look-development and test aid. It does not verify TouchDesigner.
//
// checks/reference/ holds the shaders and study.json of commit 6a58487 (before
// the family sync). draw({ reference: true, ... }) renders with them, so tests
// can compare the synced material with the old one, and the whole test suite
// can run against the old material (preview_tests.cjs --reference).
//
// ?size=WxH on the page URL renders at another size (the odd-size orientation
// test uses 481 x 271); the captures and the other tests use 960 x 540.

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
//   y = -1 emulates a build whose rasteriser runs screen y opposite to the projection's y.
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

// An opaque, lit ball for the occlusion test (Liquid Glass Prism's test scene): it stands
// between the camera and the glass in the scene render.
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
  translate(x, y, z) { const m = mat4.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
  scale(s) { const m = mat4.identity(); m[0] = m[5] = m[10] = s; return m; },
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  },
  ortho(halfHeight, aspect, near, far) {  // proj[2][3] = 0: the shader's orthographic branch
    const w = halfHeight * aspect;
    return [1 / w, 0, 0, 0, 0, 1 / halfHeight, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1];
  },
  normal3(m) { // inverse-transpose of the upper 3x3, like TouchDesigner's worldForNormals
    const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];  // columns
    const c0 = cross(a.slice(3, 6), a.slice(6, 9)), c1 = cross(a.slice(6, 9), a.slice(0, 3)), c2 = cross(a.slice(0, 3), a.slice(3, 6));
    const det = dot(a.slice(0, 3), c0);  // rows of the inverse are c0, c1, c2 / det; its transpose has them as columns
    return [...c0, ...c1, ...c2].map((x) => x / det);
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

const MESHES = {
  // Same as the TouchDesigner demo: Torus SOP, orient Z, radx 1, rady 0.45.
  torus: () => surface(
    (u, v) => { const a = u * TAU, b = v * TAU, R = 1.0, r = 0.45;
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
    return surface((u, v) => { const [, Nn, B] = frame(u); const p = c(u), b = v * TAU, r = 0.24;
      return [0, 1, 2].map((k) => p[k] + r * (Math.cos(b) * Nn[k] + Math.sin(b) * B[k])); },
    (u) => c(u), 360, 48);
  },
  // Unit sphere: lets tests compare measured thickness with the exact chord.
  sphere: () => surface(
    (u, v) => { const a = u * TAU, b = v * Math.PI;
      return [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)]; },
    () => [0, 0, 0], 160, 120),
  // A flat square facing +Z, 2 units wide: every pixel sees it at the same angle
  // when the camera looks straight at it (the film swirl test).
  sheet: () => ({ P: new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]),
                  N: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
                  I: new Uint32Array([0, 1, 2, 1, 3, 2]) }),
  blob: () => surface(
    (u, v) => { const a = u * TAU, b = v * Math.PI;
      const d = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
      const r = 1.15 + 0.16 * Math.sin(3 * d[0] + 1) * Math.sin(2.5 * d[1]) * Math.sin(3.2 * d[2] + 0.5) + 0.08 * Math.sin(5 * d[1] + 2 * d[0]);
      return d.map((x) => x * r); },
    () => [0, 0, 0], 128, 96),
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

async function createPreview(canvas) {
  const [studyText, presetText, vert, frag, backdrop, env, refStudyText, refVert, refFrag, refBackdrop] = await Promise.all([
    text('study.json'), text('presets.json'), text('liquid_glass.vert'), text('liquid_glass.frag'),
    text('backdrop.frag'), text('env.frag'),
    text('checks/reference/study.json'), text('checks/reference/liquid_glass.vert'),
    text('checks/reference/liquid_glass.frag'), text('checks/reference/backdrop.frag')]);
  const study = JSON.parse(studyText);
  const refStudy = JSON.parse(refStudyText);
  const presets = JSON.parse(presetText);
  const controls = Object.fromEntries(study.controls.map((c) => [c.name, c]));

  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
  const HDR = floatTargets ? gl.RGBA16F : gl.RGBA8;
  const DATA = floatTargets ? gl.RGBA32F : gl.RGBA8;  // render_back: rgba32float

  // Glass programs, compiled on first use: the delivered shaders or the 6a58487
  // reference, with 1 or more colour buffers, and (tests only) a higher sample cap.
  const programs = {};
  function glassProgram(reference, buffers, sampleCap) {
    const key = [reference ? 'ref' : 'new', buffers, sampleCap || 0].join(':');
    if (programs[key]) return programs[key];
    let source = reference ? refFrag : frag;
    if (sampleCap) {  // a test-only copy that allows more than 32 spectrum samples
      const edits = [['clamp(int(uState.z + 0.5), 1, 32)', `clamp(int(uState.z + 0.5), 1, ${sampleCap})`],
        ['for (int i = 0; i < 32; i++)', `for (int i = 0; i < ${sampleCap}; i++)`]];
      for (const [from, to] of edits) {
        if (source.split(from).length !== 2) throw new Error('sampleCap patch did not apply: ' + from);
        source = source.replace(from, to);
      }
    }
    return (programs[key] = program(gl, MAT_VERTEX_PRELUDE + (reference ? refVert : vert), matPixelPrelude(buffers) + source,
      `liquid_glass${reference ? ' (6a58487)' : ''}`));
  }
  glassProgram(false, 1, 0);
  glassProgram(true, 1, 0);
  const backdropProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + backdrop, 'backdrop');
  const refBackdropProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + refBackdrop, 'backdrop (6a58487)');
  const envProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + env, 'env');
  const blit = program(gl, TOP_VERTEX, BLIT_PIXEL, 'blit');
  const occluderProg = program(gl, OCCLUDER_VERTEX, OCCLUDER_PIXEL, 'occluder');

  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  const qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
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
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.I, gl.STATIC_DRAW);
    return (meshCache[name] = { vao, count: m.I.length });
  }

  const W = canvas.width, H = canvas.height;
  const backdropTarget = target(gl, W, H, HDR, false);
  const sceneTarget = target(gl, W, H, HDR, false);       // the backdrop as a mirrored build would deliver it
  const envTarget = target(gl, 1024, 512, HDR, false);
  const envMirrored = target(gl, 1024, 512, HDR, false);  // a flat-image Reflection TOP delivered upside down
  const backTarget = target(gl, W, H, DATA, true);
  const backMirrored = target(gl, W, H, DATA, false);    // the back-face pass delivered upside down
  const probeTarget = target(gl, W, H, HDR, true);        // the glass alone, unblended (rgba16float, like TouchDesigner's demo render)
  const mrtTarget = target(gl, W, H, HDR, true, 3);       // a Render TOP with three colour buffers
  const blackTarget = target(gl, 4, 4, gl.RGBA8, false);  // an unconnected sampler
  const occluderScene = target(gl, W, H, HDR, true);      // the scene render with an opaque ball in front of the glass

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
  // The demo backdrop (its uniforms evaluated from study.json, so the Backdrop menu
  // works), the 6a58487 backdrop, or a flat premultiplied colour (opts.flatBackdrop,
  // [r, g, b] or [r, g, b, a]) for tests that need a uniform or transparent scene.
  let backdropState = null;
  function paintBackdrop(opts, ctx) {
    const colour = opts.flatBackdrop;
    const node = (opts.reference ? refStudy : study).nodes.find((n) => n.id === 'demo_backdrop');
    const values = (node.uniforms || []).map((u) => u.values.map((e) => evaluate(e, ctx)));
    const key = colour ? 'flat:' + colour.join(',') : (opts.reference ? 'ref' : 'demo:' + JSON.stringify(values));
    if (key === backdropState) return;
    if (colour) {
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
  fullscreen(blit, envMirrored, 1024, 512, (prog) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, envTarget.tex);
    gl.uniform1i(gl.getUniformLocation(prog, 'sTex'), 0);
    gl.uniform1f(gl.getUniformLocation(prog, 'uMirror'), 1);
  });
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

  let lastProbe = null;
  let lastBuffers = null;

  // Draws one frame. opts: preset, overrides, mesh, time, drift, spin, tilt, scale (Geometry COMP
  // uniform scale), sopScale (the SOP itself built bigger or smaller), cameraZ, fov, ortho, near, far,
  // refraction / reflection (false = unconnected), flatBackdrop, backdropOnly, showEnv, noNormals,
  // reference (render with the 6a58487 shaders and bindings), fog ([r, g, b, amount], test model),
  // flipRaster (screen y runs opposite to the projection's y; the scene behind, the back-face pass
  // and a flat-image Reflection TOP come from the same build, so they are mirrored too),
  // mirrorInputs (those inputs arrive upside down relative to this render, the case Flip V exists for), probe (draw the glass alone,
  // unblended, into an rgba16float target and keep its floats), buffers (draw into a target with this
  // many colour buffers, unblended, and keep each buffer's floats), sampleCap (tests: allow more
  // than 32 spectrum samples), uniforms (tests: set uniform components by hand, e.g.
  // { uFilm: { w: 0 } }, for values no control can reach), occluder (an opaque ball between the
  // camera and the glass, in the scene render that the glass refracts and that the final image
  // shows; occluder.renderPass draws the glass into that render keeping its depth, as the README's
  // Render Pass TOP does; without it the glass is laid over the scene, as an Over TOP does).
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
    paintBackdrop(opts, ctx);
    const spec = opts.reference ? refStudy : study;
    const node = (id) => spec.nodes.find((n) => n.id === id);

    // The scene render as this build delivers it: mirrored when exactly one of the
    // raster or the inputs runs the other way. The final image shows the backdrop as
    // the screen does, mirrored only when the raster is.
    const rasterFlip = opts.flipRaster ? -1 : 1;
    const inputsMirrored = !!opts.flipRaster !== !!opts.mirrorInputs;
    let sceneTex = backdropTarget;
    if (inputsMirrored) {
      fullscreen(blit, sceneTarget, W, H, (prog) => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, backdropTarget.tex);
        gl.uniform1i(gl.getUniformLocation(prog, 'sTex'), 0);
        gl.uniform1f(gl.getUniformLocation(prog, 'uMirror'), 1);
      });
      mipmaps(sceneTarget);
      sceneTex = sceneTarget;
    }

    const aspect = W / H;
    const cameraZ = opts.cameraZ ?? 5;
    const proj = opts.ortho
      ? mat4.ortho(opts.ortho, aspect, opts.near ?? 0.01, opts.far ?? 100)
      : mat4.perspective((opts.fov ?? 45) * Math.PI / 180, aspect, opts.near ?? 0.1, opts.far ?? 100);
    const camInverse = mat4.translate(0, 0, cameraZ);
    const cam = mat4.translate(0, 0, -cameraZ);
    // demo_geo ry = presets.py spin(); opts.spin fixes the rate for tests (stateless).
    const spin = (opts.spin !== undefined ? opts.spin * time
      : advance('spin', p.Demospin, 360, time, paused, p.Time)) * Math.PI / 180;
    let world = mat4.mul(mat4.rotY(spin), mat4.rotX((opts.tilt ?? 20) * Math.PI / 180));
    if (opts.scale) world = mat4.mul(world, mat4.scale(opts.scale));  // like a Geometry COMP's uniform scale
    const m = mesh(opts.mesh || 'torus');

    // The occluder ball (Liquid Glass Prism's test scene and placement; the same camera at z 5):
    // in front of the demo torus, over its right side.
    const occluderWorld = mat4.mul(mat4.translate(0.75, 0.35, 1.6), mat4.scale(0.32));
    function drawOccluder(dst) {
      const o = mesh('sphere');
      gl.useProgram(occluderProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(occluderProg, 'uMVP'), false, mat4.mul(proj, mat4.mul(cam, occluderWorld)));
      gl.uniformMatrix4fv(gl.getUniformLocation(occluderProg, 'uWorld'), false, occluderWorld);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(o.vao);
      gl.drawElements(gl.TRIANGLES, o.count, gl.UNSIGNED_INT, 0);
    }
    if (opts.occluder) {  // the scene render: backdrop, then the ball with depth
      if (inputsMirrored) throw new Error('occluder: not with a flipped raster or mirrored inputs');
      fullscreen(blit, occluderScene, W, H, (prog) => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, backdropTarget.tex);
        gl.uniform1i(gl.getUniformLocation(prog, 'sTex'), 0);
        gl.uniform1f(gl.getUniformLocation(prog, 'uMirror'), 0);
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, occluderScene.fb);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      drawOccluder(occluderScene);
      mipmaps(occluderScene);
      sceneTex = occluderScene;
    }

    function drawGlass(nodeId, dst, cull, buffers = 1, raster = rasterFlip) {
      const n = node(nodeId);
      const prog = glassProgram(!!opts.reference, buffers, opts.sampleCap);
      gl.useProgram(prog);
      const loc = (name) => gl.getUniformLocation(prog, name);
      gl.uniformMatrix4fv(loc('uTDMats[0].world'), false, world);
      gl.uniformMatrix4fv(loc('uTDMats[0].cam'), false, cam);
      gl.uniformMatrix4fv(loc('uTDMats[0].camInverse'), false, camInverse);
      gl.uniformMatrix4fv(loc('uTDMats[0].proj'), false, proj);
      gl.uniformMatrix3fv(loc('uTDMats[0].worldForNormals'), false, mat4.normal3(world));
      gl.uniform4f(loc('uTDGeneral.viewport'), 0, 0, 1 / W, 1 / H);
      gl.uniform4f(loc('uPreview'), opts.sopScale ?? 1, raster, 0, 0);
      const fog = opts.fog || [0, 0, 0, 0];
      gl.uniform4f(loc('uPreviewFog'), fog[0], fog[1], fog[2], fog[3]);
      let unit = 0;
      for (const u of n.uniforms) {
        if (u.kind === 'sampler') {
          const expr = u.values[0];
          let tex = blackTarget.tex;
          if (expr.includes('Refractiontop') && connected.Refractiontop) tex = sceneTex.tex;
          // A flat image (screen-mapped) is laid out like the scene render, so it is mirrored with
          // the inputs; a panorama is read by direction and never is.
          if (expr.includes('Reflectiontop') && connected.Reflectiontop)
            tex = inputsMirrored && p.Reflectmode === 'screen' ? envMirrored.tex : envTarget.tex;
          if (expr.includes('render_back') && p.Backface) tex = opts.mirrorInputs ? backMirrored.tex : backTarget.tex;
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          if (tex !== blackTarget.tex) samplerState(u);
          gl.uniform1i(loc(u.name), unit++);
        } else {
          const v = u.values.map((e) => evaluate(e, ctx));
          while (v.length < 4) v.push(0);
          for (const [k, x] of Object.entries((opts.uniforms || {})[u.name] || {})) v['xyzw'.indexOf(k)] = x;
          gl.uniform4f(loc(u.name), v[0], v[1], v[2], v[3]);
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      if (cull) { gl.enable(gl.CULL_FACE); gl.cullFace(cull); } else gl.disable(gl.CULL_FACE);
      gl.frontFace(raster < 0 ? gl.CW : gl.CCW);  // a flipped raster reverses the winding
      gl.bindVertexArray(m.vao);
      if (opts.noNormals) { gl.disableVertexAttribArray(1); gl.vertexAttrib3f(1, 0, 0, 0); }  // geometry without N
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
      if (opts.noNormals) gl.enableVertexAttribArray(1);
      gl.disable(gl.CULL_FACE);
      gl.frontFace(gl.CCW);
      gl.activeTexture(gl.TEXTURE0);
    }

    if (p.Backface) {  // render_back: front faces culled, no blending, alpha = distance
      gl.bindFramebuffer(gl.FRAMEBUFFER, backTarget.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND);
      // The back-face pass is drawn with the same raster as the glass (so a flipped raster already
      // flips it); with upside-down inputs its image arrives mirrored on top of that.
      drawGlass('material_back', backTarget, gl.FRONT, 1, rasterFlip);
      if (opts.mirrorInputs) fullscreen(blit, backMirrored, W, H, (prog) => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, backTarget.tex);
        gl.uniform1i(gl.getUniformLocation(prog, 'sTex'), 0);
        gl.uniform1f(gl.getUniformLocation(prog, 'uMirror'), 1);
      });
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
      drawGlass('material', dst, p.Culling === 'back' ? gl.BACK : null, buffers);
      lastBuffers = Array.from({ length: buffers }, (_, i) => readFloats(dst.fb, i));
      lastProbe = lastBuffers[0];
      return { floatTargets };
    }
    if (opts.readBack) {  // the back-face pass's floats (rgb colour, a distance)
      lastProbe = readFloats(backTarget.fb, 0);
      return { floatTargets };
    }

    // over: backdrop, then the glass with premultiplied blending (One, One Minus Src Alpha).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    fullscreen(blit, null, W, H, (prog) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, opts.showEnv ? envTarget.tex : (opts.occluder ? occluderScene.tex : backdropTarget.tex));
      gl.uniform1i(gl.getUniformLocation(prog, 'sTex'), 0);
      gl.uniform1f(gl.getUniformLocation(prog, 'uMirror'), opts.flipRaster && !opts.showEnv ? 1 : 0);
    });
    if (opts.showEnv || opts.backdropOnly) return { floatTargets };
    // Render Pass TOP route: the glass is drawn into the scene render, whose depth is kept,
    // so the ball's depth is in the buffer before the glass (its colour already is).
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

  return { draw, pixels, study, presets, floatTargets, size: [W, H],
    lastProbe: () => lastProbe, lastBuffers: () => lastBuffers };
}

window.createPreview = createPreview;
