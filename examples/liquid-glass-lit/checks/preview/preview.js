// WebGL2 preview of the Liquid Glass Lit study.
//
// It compiles the delivered GLSL files unchanged, behind small stand-ins for
// TouchDesigner's built-ins, and packs uniforms by evaluating the binding
// expressions in study.json. Like TouchDesigner, it compiles one program per
// light setup (TD_NUM_LIGHTS, TD_NUM_ENV_LIGHTS). The stand-in lighting
// functions (TDLightingPBR, TDEnvLightingPBR, TDEnvLightTextureLod) are written
// here from the documented signatures and a common GGX model; they are NOT
// TouchDesigner's code, so absolute brightness can differ from a native render.
// It mirrors the demo network: backdrop GLSL TOP drawn behind everything (the
// backdrop card), an optional opaque occluder bar, environment map GLSL TOP
// behind an Environment Light, key and rim Light COMPs, and the glass drawn
// into that scene with its depth kept (the Render Pass TOP). The refraction
// texture is the scene without the glass, as in the native recipe.
// It is a look-development and test aid. It does not verify TouchDesigner.
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

function tdCommon(lights, envs) {
  return `
#define TD_NUM_LIGHTS ${lights}
#define TD_NUM_ENV_LIGHTS ${envs}
#define TD_LIGHTS_ARRAY_SIZE ${Math.max(lights, 1)}
#define TD_ENV_LIGHTS_ARRAY_SIZE ${Math.max(envs, 1)}
#define TD_NUM_CAMERAS 1
struct TDMatrix { mat4 world; mat4 cam; mat4 camInverse; mat4 proj; mat3 worldForNormals; };
uniform TDMatrix uTDMats[TD_NUM_CAMERAS];
struct TDGeneral { vec4 ambientColor; vec4 viewport; };
uniform TDGeneral uTDGeneral;
// Preview subset of TDLight. Stand-in convention: position.w = 0 means a distant light.
struct TDLight { vec4 position; vec3 direction; vec3 diffuse; vec4 coneLookupScaleBias; vec4 attenScaleBiasRoll; };
uniform TDLight uTDLights[TD_LIGHTS_ARRAY_SIZE];
struct TDEnvLight { vec3 color; mat3 rotate; };
uniform TDEnvLight uTDEnvLights[TD_ENV_LIGHTS_ARRAY_SIZE];
struct TDPBRResult { vec3 diffuse; vec3 specular; float shadowStrength; };
`;
}

// Test-only stand-ins (uPreview), not TouchDesigner behaviour:
//   x scales the SOP's points (an object built at another size, not a Geometry COMP scale);
//   y = -1 emulates a build whose rasteriser runs screen y opposite to the projection's y.
function matVertexPrelude(lights, envs) {
  return ES_HEADER + tdCommon(lights, envs) + `
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
}

// TDFog stand-in: uPreviewFog.a = 0 (the default) is a Camera COMP without fog, so
// TDFog returns the colour unchanged, as Derivative documents. With a > 0 it mixes
// in a constant fog colour (a test model of fog, not TouchDesigner's fog curve).
// buffers > 1 defines TD_NUM_COLOR_BUFFERS, like a Render TOP with that many colour buffers.
function matPixelPrelude(lights, envs, buffers = 1) {
  let s = ES_HEADER + (buffers > 1 ? `#define TD_NUM_COLOR_BUFFERS ${buffers}\n` : '') + tdCommon(lights, envs) + `
void TDCheckDiscard() {}
bool TDFrontFacing(vec3 position, vec3 normal) { return gl_FrontFacing; }
vec4 TDOutputSwizzle(vec4 c) { return c; }
uniform vec4 uPreviewFog;
vec4 TDFog(vec4 c, vec3 worldSpacePos, int cameraIndex) { return vec4(mix(c.rgb, uPreviewFog.rgb, uPreviewFog.a), c.a); }
// GLSL Reference: u = 0 is the middle of the +X face, rising toward +Z. v = 0 straight down (inferred).
vec2 TDCubeMapToEquirectangular(vec3 d) {
  return vec2(fract(atan(d.z, d.x) / 6.2831853), 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.14159265);
}
// Stand-in for TDLightingPBR: Lambert diffuse and a GGX highlight (Schlick-style
// fresnel and Smith visibility, as in common real-time PBR), the documented
// attenuation formula and a smooth cone. No shadow maps: shadowStrength is 0.
TDPBRResult TDLightingPBR(int index, vec3 diffuseColor, vec3 specularColor, vec3 worldSpacePos,
                          vec3 normal, float shadowStrength, vec3 shadowColor, vec3 camVector, float roughness) {
  TDLight lt = uTDLights[index];
  vec3 L;
  float atten = 1.0;
  if (lt.position.w < 0.5) {
    L = normalize(-lt.direction);
  } else {
    vec3 toLight = lt.position.xyz - worldSpacePos;
    float dist = length(toLight);
    L = toLight / dist;
    if (lt.attenScaleBiasRoll.x != 0.0) {
      float a = clamp(dist * lt.attenScaleBiasRoll.x + lt.attenScaleBiasRoll.y, 0.0, 1.0) * 1.57073963;
      atten = pow(sin(a), lt.attenScaleBiasRoll.z);
    }
    if (lt.coneLookupScaleBias.x != 0.0) {
      float s = dot(normalize(lt.direction), -L) * lt.coneLookupScaleBias.x + lt.coneLookupScaleBias.y;
      atten *= smoothstep(0.0, 1.0, clamp(s, 0.0, 1.0));
    }
  }
  float NdotL = max(dot(normal, L), 0.0);
  float NdotV = max(dot(normal, camVector), 1e-4);
  vec3 H = normalize(L + camVector);
  float NdotH = max(dot(normal, H), 0.0);
  float VdotH = max(dot(camVector, H), 0.0);
  float a2 = pow(max(roughness, 1e-4), 4.0);
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * d * d);
  vec3 F = specularColor + (vec3(1.0) - specularColor) * pow(2.0, (-5.55473 * VdotH - 6.98316) * VdotH);
  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float G = 1.0 / ((NdotL * (1.0 - k) + k) * (NdotV * (1.0 - k) + k));
  vec3 light = lt.diffuse * atten * NdotL;
  TDPBRResult r;
  r.diffuse = diffuseColor * light;
  r.specular = D * F * G * 0.25 * light;
  r.shadowStrength = 0.0;
  return r;
}
`;
  if (envs > 0) s += `
uniform sampler2D sTDEnvLight2D;   // the preview's single 2D (equirectangular) env map
vec4 TDEnvLightTextureLod(int lightIndex, vec2 coord, float mipLevel) { return textureLod(sTDEnvLight2D, coord, mipLevel); }
vec4 TDEnvLightTextureLod(int lightIndex, vec3 coord, float mipLevel) { return vec4(0.0); }  // no cube map here
// Stand-in for TDEnvLightingPBR: diffuse from a heavily blurred mipmap level
// (instead of spherical harmonics), specular from the roughness mip level.
TDPBRResult TDEnvLightingPBR(int index, vec3 diffuseColor, vec3 specularColor, vec3 normal,
                             vec3 camVector, float roughness, float ambientOcclusion) {
  vec3 n = normalize(uTDEnvLights[index].rotate * normal);
  vec3 r = normalize(uTDEnvLights[index].rotate * reflect(-camVector, normal));
  TDPBRResult res;
  res.diffuse = diffuseColor * textureLod(sTDEnvLight2D, TDCubeMapToEquirectangular(n), 8.0).rgb
              * uTDEnvLights[index].color * ambientOcclusion;
  res.specular = specularColor * textureLod(sTDEnvLight2D, TDCubeMapToEquirectangular(r), roughness * 10.0).rgb
               * uTDEnvLights[index].color;
  res.shadowStrength = 0.0;
  return res;
}
`;
  return s;
}

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

// The demo occluder bar (Constant MAT stand-in): a flat colour.
const SOLID_VERTEX = ES_HEADER + `
in vec3 P;
uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(P, 1.0); }
`;
const SOLID_PIXEL = ES_HEADER + `
uniform vec3 uColor;
layout(location = 0) out vec4 fragColor;
void main() { fragColor = vec4(uColor, 1.0); }
`;

const BLIT_PIXEL = TOP_PIXEL_PRELUDE + `
uniform sampler2D sTex;
uniform float uMirror;
layout(location = 0) out vec4 fragColor;
void main() { vec2 st = vUV.st; if (uMirror > 0.5) st.y = 1.0 - st.y; fragColor = texture(sTex, st); }
`;

// ------------------------------------------------------------------ math
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
  translate(x, y, z) { const m = mat4.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
  scale(x, y = x, z = x) { const m = mat4.identity(); m[0] = x; m[5] = y; m[10] = z; return m; },
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  },
  normal3(m) { // inverse-transpose of the upper 3x3, like TouchDesigner's worldForNormals
    const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];  // columns
    const c0 = cross(a.slice(3, 6), a.slice(6, 9)), c1 = cross(a.slice(6, 9), a.slice(0, 3)), c2 = cross(a.slice(0, 3), a.slice(3, 6));
    const det = dot(a.slice(0, 3), c0);
    return [...c0, ...c1, ...c2].map((x) => x / det);
  },
};
// Column-major 3x3 rotation about +Y by angle a (radians).
const rotY3 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; };

// ------------------------------------------------------------------ meshes
const TAU = Math.PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

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
  const at = (k) => [P[3 * k], P[3 * k + 1], P[3 * k + 2]];
  const face = cross(sub(at(I[1]), at(I[0])), sub(at(I[2]), at(I[0])));
  if (dot(face, [N[3 * I[0]], N[3 * I[0] + 1], N[3 * I[0] + 2]]) < 0) {
    for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
  }
  return { P: new Float32Array(P), N: new Float32Array(N), I: new Uint32Array(I) };
}

const MESHES = {
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

function target(gl, w, h, internal, buffers = 1) {
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
  if ((m = expr.match(/^parent\(\)\.par\.(\w+)\.menuIndex$/))) return ctx.menuIndex(m[1]);  // 6a58487 reference bindings
  if ((m = expr.match(/^parent\(\)\.par\.(\w+) \* ([\d.]+)$/))) return ctx.p[m[1]] * parseFloat(m[2]);
  if ((m = expr.match(/^parent\(\)\.par\.(\w+)$/))) return Number(ctx.p[m[1]]);
  if (expr === 'parent().par.Time if parent().par.Pause.eval() else absTime.seconds') return ctx.time;
  if ((m = expr.match(/^1 if parent\(\)\.par\.(\w+)\.eval\(\) else 0$/)))
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
  const [studyText, presetText, vert, frag, backdrop, envmap, refStudyText, refVert, refFrag, refBackdrop] = await Promise.all([
    text('study.json'), text('presets.json'), text('liquid_glass_lit.vert'), text('liquid_glass_lit.frag'),
    text('backdrop.frag'), text('envmap.frag'),
    text('checks/reference/study.json'), text('checks/reference/liquid_glass_lit.vert'),
    text('checks/reference/liquid_glass_lit.frag'), text('checks/reference/backdrop.frag')]);
  const study = JSON.parse(studyText);
  const refStudy = JSON.parse(refStudyText);
  const presets = JSON.parse(presetText);
  const node = (id) => study.nodes.find((n) => n.id === id);
  const controls = Object.fromEntries(study.controls.map((c) => [c.name, c]));

  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
  const HDR = floatTargets ? gl.RGBA16F : gl.RGBA8;

  // One program per light setup, compiled on first use (TouchDesigner does the same);
  // also per material version (delivered or the 6a58487 reference), colour buffer count
  // and (tests only) a higher spectrum sample cap.
  const programs = {};
  function glassProgram(lights, envs, reference = false, buffers = 1, sampleCap = 0) {
    const key = [lights, envs, reference ? 'ref' : 'new', buffers, sampleCap || 0].join(':');
    if (programs[key]) return programs[key];
    let source = reference ? refFrag : frag;
    if (sampleCap) {  // a test-only copy that allows more than 32 spectrum samples
      const edits = [['clamp(int(uState.y + 0.5), 1, 32)', `clamp(int(uState.y + 0.5), 1, ${sampleCap})`],
        ['for (int i = 0; i < 32; i++)', `for (int i = 0; i < ${sampleCap}; i++)`]];
      for (const [from, to] of edits) {
        if (source.split(from).length !== 2) throw new Error('sampleCap patch did not apply: ' + from);
        source = source.replace(from, to);
      }
    }
    return (programs[key] = program(gl, matVertexPrelude(lights, envs) + (reference ? refVert : vert),
      matPixelPrelude(lights, envs, buffers) + source,
      `liquid_glass_lit${reference ? ' (6a58487)' : ''} (${lights} lights, ${envs} env lights, ${buffers} buffers)`));
  }
  const backdropProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + backdrop, 'backdrop');
  const refBackdropProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + refBackdrop, 'backdrop (6a58487)');
  const solid = program(gl, SOLID_VERTEX, SOLID_PIXEL, 'occluder');
  const envProg = program(gl, TOP_VERTEX, TOP_PIXEL_PRELUDE + envmap, 'envmap');
  const blit = program(gl, TOP_VERTEX, BLIT_PIXEL, 'blit');

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

  // The occluder bar from study.json: a box SOP inside a translated Geometry COMP.
  const bar = (() => {
    const q = node('demo_front').parameters, b = node('demo_front/bar').parameters, c = node('demo_front_mat').parameters;
    const [x, y, z] = [b.sizex / 2, b.sizey / 2, b.sizez / 2];
    const P = new Float32Array([-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z]);
    const I = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, P, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
    return { vao, count: I.length, world: mat4.translate(q.tx, q.ty, q.tz), color: [c.colorr, c.colorg, c.colorb] };
  })();

  const W = canvas.width, H = canvas.height;
  // Adds a depth buffer to a colour target (the scene render and the float targets need one).
  function withDepth(t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, t.w, t.h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return t;
  }
  const backdropTarget = target(gl, W, H, HDR);
  // The scene render without the glass (backdrop + occluder), or the backdrop as a
  // mirrored build would deliver it: the refraction texture in those cases.
  const sceneTarget = withDepth(target(gl, W, H, HDR));
  const sceneMirrored = target(gl, W, H, HDR);  // that scene render delivered upside down (mirrorInputs)
  // A 32-bit float copy of the final image, for tests that need values above 1.
  let floatTarget = null;
  let probeTarget = null;   // the glass alone, unblended (rgba16float, like the demo renders)
  let mrtTarget = null;     // a render with three colour buffers
  const CANVAS = { fb: null, w: W, h: H };
  const envTarget = target(gl, 1024, 512, HDR);
  const blackTarget = target(gl, 4, 4, gl.RGBA8);  // an unconnected sampler

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
  function blitInto(dst, tex, mirror) {
    fullscreen(blit, dst, W, H, (prog) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(prog, 'sTex'), 0);
      gl.uniform1f(gl.getUniformLocation(prog, 'uMirror'), mirror ? 1 : 0);
    });
  }

  function mipmaps(t, repeatU) {  // like the GLSL MAT sampler filter 'Mipmap Linear'
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (repeatU) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  fullscreen(envProg, envTarget, 1024, 512);
  mipmaps(envTarget, true);
  gl.bindFramebuffer(gl.FRAMEBUFFER, blackTarget.fb);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // The demo backdrop (its uniforms evaluated from study.json, so the Backdrop menu
  // works), the 6a58487 backdrop, or a flat premultiplied colour (opts.flatBackdrop,
  // [r, g, b] or [r, g, b, a]) for tests that need a uniform or transparent scene.
  let backdropState = null;
  function paintBackdrop(opts, ctx) {
    const colour = opts.flatBackdrop;
    const bnode = (opts.reference ? refStudy : study).nodes.find((n) => n.id === 'demo_backdrop');
    const values = (bnode.uniforms || []).map((u) => u.values.map((e) => evaluate(e, ctx)));
    const key = colour ? 'flat:' + colour.join(',') : (opts.reference ? 'ref' : 'demo:' + JSON.stringify(values));
    if (key === backdropState) return;
    if (colour) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, backdropTarget.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(colour[0], colour[1], colour[2], colour[3] ?? 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else {
      fullscreen(opts.reference ? refBackdropProg : backdropProg, backdropTarget, W, H, (prog) => {
        (bnode.uniforms || []).forEach((u, i) => {
          const v = [...values[i]]; while (v.length < 4) v.push(0);
          gl.uniform4f(gl.getUniformLocation(prog, u.name), v[0], v[1], v[2], v[3]);
        });
      });
    }
    mipmaps(backdropTarget, false);
    backdropState = key;
  }

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

  // Demo Light COMPs from study.json (point lights: position, colour x dimmer).
  // Their dimmer is an expression, base x Study > Demo Light COMP dimmer.
  function demoLight(id, p) {
    const n = node(id), q = n.parameters;
    const m = (n.expressions || {}).dimmer?.match(/^([\d.]+) \* parent\(\)\.par\.Demodimmer$/);
    if (!m) throw new Error('preview cannot evaluate the dimmer of ' + id);
    const dimmer = parseFloat(m[1]) * p.Demodimmer;
    return { type: q.lighttype, pos: [q.tx, q.ty, q.tz], color: [q.cr * dimmer, q.cg * dimmer, q.cb * dimmer] };
  }
  function demoLights(p) {
    const key = () => [demoLight('demo_key', p)], rim = () => [demoLight('demo_rim', p)];
    return { key: key(), rim: rim(), both: [...key(), ...rim()], none: [] }[p.Demolights];
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

  let lastProbe = null;
  let lastBuffers = null;

  // Draws one frame. opts: preset, overrides, mesh, time, drift, spin, tilt, fov, cameraZ, near,
  // far, scale (Geometry COMP uniform scale), sopScale (the SOP itself built bigger or smaller),
  // lights / env (scene lights instead of the demo's), envRotate, envColor, ambientColor,
  // refraction (false = unconnected), flatBackdrop, background ('black'), backdropOnly, showEnv,
  // occluder, composite ('over'), float (draw into a 32-bit float target), noNormals, reference
  // (render with the 6a58487 shaders and bindings), fog ([r, g, b, amount], test model),
  // flipRaster (screen y runs opposite to the projection's y; the scene render comes from the
  // same build, so it is mirrored too), mirrorInputs (the Refraction TOP arrives upside down
  // relative to this render, the case Flip V exists for), probe (draw the glass alone, unblended,
  // into an rgba16float target and keep its floats), buffers (draw into a target with this many
  // colour buffers, unblended, and keep each buffer's floats), clearBuffers, sampleCap (tests:
  // allow more than 32 spectrum samples).
  function draw(opts = {}) {
    const p = parameters(opts);
    const time = opts.time ?? p.Time;
    if (opts.drift !== 'continue') motion = {};
    const paused = !!p.Pause;
    const connected = { Refractiontop: opts.refraction !== false };
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
    const material = spec.nodes.find((n) => n.id === 'material');

    // Scene lights: explicit list in opts.lights, else the demo lights chosen by Demolights.
    // Like the stand-in arrays, a dimmed light still counts (TouchDesigner may drop it).
    const lights = opts.lights ?? demoLights(p);
    const envOn = opts.env ?? !!p.Demoenv;
    const buffers = opts.buffers || 1;
    const glass = glassProgram(lights.length, envOn ? 1 : 0, !!opts.reference, buffers, opts.sampleCap);

    const aspect = W / H;
    const proj = mat4.perspective((opts.fov ?? 45) * Math.PI / 180, aspect, opts.near ?? 0.1, opts.far ?? 100);
    const cameraZ = opts.cameraZ ?? 5;
    const camInverse = mat4.translate(0, 0, cameraZ);
    const cam = mat4.translate(0, 0, -cameraZ);
    // demo_geo ry = presets.py spin(); opts.spin fixes the rate for tests (stateless).
    const spin = (opts.spin !== undefined ? opts.spin * time
      : advance('spin', p.Demospin, 360, time, paused, p.Time)) * Math.PI / 180;
    let world = mat4.mul(mat4.rotY(spin), mat4.rotX((opts.tilt ?? 20) * Math.PI / 180));
    if (opts.scale) world = mat4.mul(world, mat4.scale(opts.scale));  // like a Geometry COMP's uniform scale
    const m = mesh(opts.mesh || 'torus');
    const occluder = opts.occluder ?? !!p.Demooccluder;
    // A flipped raster: everything this build renders lands mirrored on screen.
    const rasterFlip = opts.flipRaster ? -1 : 1;
    const flipY = mat4.scale(1, rasterFlip, 1);
    if (opts.float && !floatTarget) floatTarget = withDepth(target(gl, W, H, gl.RGBA32F));
    const dst = opts.float ? floatTarget : CANVAS;

    // The scene without the glass, as this build renders it: the backdrop (the card,
    // at the far plane) or black, then the occluder bar with its depth.
    function scene(into, background) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, into.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (background) blitInto(into, background, opts.flipRaster);  // no depth test or write: depth stays at the far plane
      if (occluder) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, into.fb);
        gl.viewport(0, 0, W, H);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.useProgram(solid);
        gl.uniformMatrix4fv(gl.getUniformLocation(solid, 'uMVP'), false, mat4.mul(flipY, mat4.mul(proj, mat4.mul(cam, bar.world))));
        gl.uniform3f(gl.getUniformLocation(solid, 'uColor'), ...bar.color);
        gl.bindVertexArray(bar.vao);
        gl.drawElements(gl.TRIANGLES, bar.count, gl.UNSIGNED_SHORT, 0);
      }
    }
    // The Refraction TOP: the scene render without the glass. With the bar (or a mirrored
    // delivery) it is rendered and mipmapped like a Render TOP; otherwise it is the backdrop.
    let refraction = connected.Refractiontop ? backdropTarget : blackTarget;
    if (connected.Refractiontop && (occluder || opts.flipRaster || opts.mirrorInputs)) {
      if (occluder) {
        scene(sceneTarget, backdropTarget.tex);  // rendered by this build: mirrored with a flipped raster
        if (opts.mirrorInputs) blitInto(sceneMirrored, sceneTarget.tex, true);
      } else {
        blitInto(sceneTarget, backdropTarget.tex, !!opts.flipRaster !== !!opts.mirrorInputs);
      }
      refraction = occluder && opts.mirrorInputs ? sceneMirrored : sceneTarget;
      mipmaps(refraction, false);
    }

    function setGlassUniforms(prog) {
      gl.useProgram(prog);
      const loc = (name) => gl.getUniformLocation(prog, name);
      gl.uniformMatrix4fv(loc('uTDMats[0].world'), false, world);
      gl.uniformMatrix4fv(loc('uTDMats[0].cam'), false, cam);
      gl.uniformMatrix4fv(loc('uTDMats[0].camInverse'), false, camInverse);
      gl.uniformMatrix4fv(loc('uTDMats[0].proj'), false, proj);
      gl.uniformMatrix3fv(loc('uTDMats[0].worldForNormals'), false, mat4.normal3(world));
      gl.uniform4f(loc('uTDGeneral.viewport'), 0, 0, 1 / W, 1 / H);
      gl.uniform4f(loc('uPreview'), opts.sopScale ?? 1, rasterFlip, 0, 0);
      const fog = opts.fog || [0, 0, 0, 0];
      gl.uniform4f(loc('uPreviewFog'), fog[0], fog[1], fog[2], fog[3]);
      const amb = opts.ambientColor ?? [0, 0, 0];
      gl.uniform4f(loc('uTDGeneral.ambientColor'), amb[0], amb[1], amb[2], 1);
      lights.forEach((l, i) => {
        const s = `uTDLights[${i}].`;
        const distant = l.type === 'distant';
        const dir = l.dir ?? norm([-l.pos[0], -l.pos[1], -l.pos[2]]);
        gl.uniform4f(loc(s + 'position'), ...(distant ? [0, 0, 0, 0] : [...l.pos, 1]));
        gl.uniform3f(loc(s + 'direction'), ...dir);
        gl.uniform3f(loc(s + 'diffuse'), ...l.color);
        gl.uniform4f(loc(s + 'coneLookupScaleBias'), ...(l.cone ?? [0, 0, 0, 0]));
        gl.uniform4f(loc(s + 'attenScaleBiasRoll'), ...(l.atten ?? [0, 0, 0, 0]));
      });
      if (envOn) {
        // Stand-in rotation: Demoenvrotate turns the map around +Y (sign is a preview assumption).
        const rot = (opts.envRotate ?? p.Demoenvrotate) * Math.PI / 180;
        const ec = opts.envColor ?? [1, 1, 1];
        gl.uniform3f(loc('uTDEnvLights[0].color'), ...ec);
        gl.uniformMatrix3fv(loc('uTDEnvLights[0].rotate'), false, rotY3(-rot));
      }
      let unit = 0;
      for (const u of material.uniforms) {
        if (u.kind === 'sampler') {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, refraction.tex);
          if (refraction !== blackTarget) samplerState(u);
          gl.uniform1i(loc(u.name), unit++);
        } else {
          const v = u.values.map((e) => evaluate(e, ctx));
          while (v.length < 4) v.push(0);
          gl.uniform4f(loc(u.name), v[0], v[1], v[2], v[3]);
        }
      }
      if (envOn) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, envTarget.tex);
        gl.uniform1i(loc('sTDEnvLight2D'), unit++);
      }
    }
    function drawMesh() {
      if (p.Culling === 'back') { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); } else gl.disable(gl.CULL_FACE);
      gl.frontFace(rasterFlip < 0 ? gl.CW : gl.CCW);  // a flipped raster reverses the winding
      gl.bindVertexArray(m.vao);
      if (opts.noNormals) { gl.disableVertexAttribArray(1); gl.vertexAttrib3f(1, 0, 0, 0); }  // geometry without N
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
      if (opts.noNormals) gl.enableVertexAttribArray(1);
      gl.disable(gl.CULL_FACE);
      gl.frontFace(gl.CCW);
      gl.activeTexture(gl.TEXTURE0);
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
      if (buffers > 1 && !mrtTarget) mrtTarget = withDepth(target(gl, W, H, HDR, 3));
      if (buffers === 1 && !probeTarget) probeTarget = withDepth(target(gl, W, H, HDR));
      if (buffers > 3) throw new Error('preview: at most 3 colour buffers');
      const into = buffers > 1 ? mrtTarget : probeTarget;
      setGlassUniforms(glass);
      gl.bindFramebuffer(gl.FRAMEBUFFER, into.fb);
      gl.viewport(0, 0, W, H);
      for (let i = 0; i < buffers; i++) gl.clearBufferfv(gl.COLOR, i, opts.clearBuffers || [0, 0, 0, 0]);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.disable(gl.BLEND);
      drawMesh();
      lastBuffers = Array.from({ length: buffers }, (_, i) => readFloats(into.fb, i));
      lastProbe = lastBuffers[0];
      return { floatTargets };
    }

    scene(dst, opts.background === 'black' ? null : (opts.showEnv ? envTarget.tex : backdropTarget.tex));
    if (opts.showEnv || opts.backdropOnly) return { floatTargets };

    // Draw the glass into the scene: premultiplied blend (One, One Minus Src Alpha),
    // depth-tested against the scene (Render Pass TOP). composite: 'over' models a
    // separate glass render laid over the scene with an Over TOP: no scene depth.
    setGlassUniforms(glass);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, W, H);
    if (opts.composite === 'over') gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    drawMesh();
    gl.disable(gl.BLEND);
    return { floatTargets, lights: lights.length, envLights: envOn ? 1 : 0 };
  }

  function pixels() {
    const out = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;  // rows bottom to top
  }

  // The last draw({ float: true }), as 32-bit floats (values above 1 kept).
  function pixelsFloat() {
    const out = new Float32Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, floatTarget.fb);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  // Compile every light setup the tests use, and report which succeeded.
  function compileMatrix() {
    const out = [];
    for (const lights of [0, 1, 3]) for (const envs of [0, 1]) {
      try { glassProgram(lights, envs); out.push({ lights, envs, ok: true }); }
      catch (e) { out.push({ lights, envs, ok: false, error: String(e).slice(0, 400) }); }
    }
    return out;
  }

  return { draw, pixels, pixelsFloat, compileMatrix, study, presets, floatTargets, size: [W, H],
    lastProbe: () => lastProbe, lastBuffers: () => lastBuffers };
}

window.createPreview = createPreview;
