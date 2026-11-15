// Property tests of the delivered GLSL, run through the WebGL2 preview.
//
//   node checks/preview_tests.cjs <port>     (serve the study folder on <port> first)
//
// Each test states a relationship that must hold whatever the look, e.g.
// "a raymarched sphere writes the same depth as a rasterized sphere".
// Most tests read 32-bit float teaching stages and compare them with exact
// ray-sphere maths computed here. They test the shader maths and the
// study.json bindings in a browser GPU (SwiftShader), not TouchDesigner.
const { chromium } = require('playwright');

const QUIET = { Reflection: 0, Rim: 0, Specular: 0, Diffuse: 0, Iridescence: 0, Ripple: 0 };
const INVISIBLE = { ...QUIET, Ior: 1.0, Dispersion: 0, Frost: 0, Density: 0, Saturation: 1, Stage: 'final' };
const SINGLE = { Count: 1, Spread: 0, Droplets: 0, Stretch: 0, Ripple: 0, Radius: 0.6 };

// In-page helpers: exact ray-sphere maths and float readback reductions.
function installHelpers() {
  const P = window.preview;
  const [W, H] = P.size;
  const fovX = 45 * Math.PI / 180, aspect = W / H;
  const fx = 1 / Math.tan(fovX / 2), fy = fx * aspect;
  const near = 0.1, far = 100;
  const v = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    norm: (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; },
  };
  // Camera at (0, 0, camZ) looking down -Z; pixel centres, rows bottom to top.
  function ray(x, y, camZ = 5) {
    const nx = ((x + 0.5) / W) * 2 - 1, ny = ((y + 0.5) / H) * 2 - 1;
    return { o: [0, 0, camZ], d: v.norm([nx / fx, ny / fy, -1]) };
  }
  function hitSphere(r, c, R) {
    const oc = v.sub(r.o, c), b = v.dot(oc, r.d), q = v.dot(oc, oc) - R * R, disc = b * b - q;
    if (disc < 0) return null;
    const s = -b - Math.sqrt(disc);
    if (s < 0) return null;
    const p = v.add(r.o, v.mul(r.d, s));
    return { s, p, n: v.mul(v.sub(p, c), 1 / R) };
  }
  function refract(I, N, eta) {
    const d = v.dot(N, I), k = 1 - eta * eta * (1 - d * d);
    if (k < 0) return null;
    return v.sub(v.mul(I, eta), v.mul(N, eta * d + Math.sqrt(k)));
  }
  // Eye distance along -Z from a 0..1 (Vulkan-style) depth value.
  const eyeZ = (depth) => near * far / (far - depth * (far - near));
  function readAll() { return P.floats(); }
  function at(f, x, y) { const i = (y * W + x) * 4; return [f[i], f[i + 1], f[i + 2], f[i + 3]]; }
  // Any projection: the same camera matrices the preview hands the shader (draw options in).
  const xf = (m, p) => [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * p[3]);
  function unproject(cams, x, y, depth) {
    const a = xf(cams.camProjInverse, [((x + 0.5) / W) * 2 - 1, ((y + 0.5) / H) * 2 - 1, depth, 1]);
    return [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
  }
  // Pixel (x, y)'s ray from the near plane (depth 0) toward the far plane (depth 1).
  function rayAny(cams, x, y) {
    const o = unproject(cams, x, y, 0), e = unproject(cams, x, y, 1);
    return { o, d: v.norm(v.sub(e, o)) };
  }
  // Where a world point lands on screen, 0..1 (rows bottom to top, like the readback).
  function project(cams, p) { const c = xf(cams.camProj, [p[0], p[1], p[2], 1]); return [0.5 + 0.5 * c[0] / c[3], 0.5 + 0.5 * c[1] / c[3]]; }
  const reflect = (I, N) => v.sub(I, v.mul(N, 2 * v.dot(N, I)));
  window.TH = { W, H, v, ray, hitSphere, refract, reflect, eyeZ, readAll, at, unproject, rayAny, project };
}

(async () => {
  const port = process.argv[2];
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(600000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/checks/preview/index.html?harness=1`);
  await page.evaluate(() => window.previewReady);
  await page.evaluate(installHelpers);

  const results = [];
  const check = (name, ok, evidence, claim) => results.push({ name, ok, claim, evidence });

  // Largest per-channel difference between two RGBA8 renders, and pixels off by more than 2/255.
  const diff = (a, b) => page.evaluate(([a, b]) => {
    window.preview.draw(a); const pa = window.preview.pixels();
    window.preview.draw(b); const pb = window.preview.pixels();
    let max = 0, over = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      max = Math.max(max, d); if (d > 2) over++;
    }
    return { max, pixelsOver2: over };
  }, [a, b]);

  // ---------------------------------------------------------------- 1. normal
  // A single blob is an exact sphere; its field gradient must equal the analytic normal.
  const normalCase = (name, blobs, centre, R, camZ, extra = {}) => page.evaluate(([blobs, centre, R, camZ, extra, SINGLE]) => {
    const { W, H, v, ray, hitSphere, at } = window.TH;
    window.preview.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, blobs, cameraZ: camZ,
      clear: [-1, -1, -1, -1], ...extra, overrides: { ...SINGLE, Radius: extra.radius ?? SINGLE.Radius, ...(extra.overrides || {}), Stage: 'normal' } });
    const f = window.TH.readAll();
    let worst = 0, n = 0, missing = 0;
    for (let y = 0; y < H; y += 7) for (let x = 0; x < W; x += 7) {
      const h = hitSphere(ray(x, y, camZ), centre, R);
      if (!h) continue;
      // Skip the outermost 2 % of the radius, where a pixel centre may fall just outside.
      const r = ray(x, y, camZ), oc = v.sub(r.o, centre), b = v.dot(oc, r.d);
      if (Math.sqrt(Math.max(v.dot(oc, oc) - b * b, 0)) > 0.98 * R) continue;
      const c = at(f, x, y);
      if (c[0] < -0.5) { missing++; continue; }
      const m = v.norm([2 * c[0] - 1, 2 * c[1] - 1, 2 * c[2] - 1]);
      worst = Math.max(worst, Math.acos(Math.min(1, v.dot(m, h.n))) * 180 / Math.PI); n++;
    }
    return { name: extra.label, pixels: n, missing, worstDegrees: +worst.toFixed(4) };
  }, [blobs, centre, R, camZ, extra, SINGLE]);

  const n1 = await normalCase('identity', {}, [0, 0, 0], 0.6, 5, { label: 'identity transform' });
  const n2 = await normalCase('moved', { rotate: [20, 35, 0], translate: [0.2, -0.1, 0.3], scale: [1.3, 1.3, 1.3] },
    [0.2, -0.1, 0.3], 0.78, 5, { label: 'rotated, moved, scaled 1.3' });
  // Non-uniform scale: the single blob becomes an ellipsoid. Its exact normal is the inverse
  // transpose of the transform applied to the sphere normal; the forward matrix would be far off.
  const n3 = await page.evaluate((SINGLE) => {
    const { W, H, v, rayAny, at } = window.TH, P = window.preview;
    const R = 0.6, sc = [1.6, 0.6, 1.0], rot = [25, 40, 10], tr = [0.1, 0.05, 0.2], deg = Math.PI / 180;
    const opts = { preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1],
      blobs: { scale: sc, rotate: rot, translate: tr }, overrides: { ...SINGLE, Radius: R, Stage: 'normal' } };
    P.draw(opts); const f = P.floats(), cams = P.camera(opts);
    const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
    const Ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
    const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
    const mm = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
    const mv = (A, x) => A.map((r) => r[0] * x[0] + r[1] * x[1] + r[2] * x[2]);
    const Rot = mm(Rz(rot[2] * deg), mm(Ry(rot[1] * deg), Rx(rot[0] * deg)));   // preview order: scale, Rx, Ry, Rz, move
    const RotT = [0, 1, 2].map((i) => [0, 1, 2].map((j) => Rot[j][i]));
    const toObj = (x) => { const w = mv(RotT, x); return [w[0] / sc[0], w[1] / sc[1], w[2] / sc[2]]; };
    let n = 0, worst = 0, missing = 0, forward = 0;
    for (let y = 0; y < H; y += 5) for (let x = 0; x < W; x += 5) {
      const r = rayAny(cams, x, y), o = toObj(v.sub(r.o, tr)), dd = toObj(r.d);
      const a = v.dot(dd, dd), b = v.dot(o, dd), c = v.dot(o, o) - R * R, disc = b * b - a * c;
      if (disc < 0 || disc / (a * R * R) < 0.004) continue;   // also skips a thin rim band
      const po = v.add(o, v.mul(dd, (-b - Math.sqrt(disc)) / a));
      const exact = v.norm(mv(Rot, [po[0] / sc[0], po[1] / sc[1], po[2] / sc[2]]));
      const wrong = v.norm(mv(Rot, [po[0] * sc[0], po[1] * sc[1], po[2] * sc[2]]));
      const px = at(f, x, y); if (px[0] < -0.5) { missing++; continue; }
      const m = v.norm([2 * px[0] - 1, 2 * px[1] - 1, 2 * px[2] - 1]);
      worst = Math.max(worst, Math.acos(Math.min(1, v.dot(m, exact))) * 180 / Math.PI);
      forward = Math.max(forward, Math.acos(Math.min(1, v.dot(wrong, exact))) * 180 / Math.PI); n++;
    }
    return { name: 'non-uniform scale 1.6 x 0.6 x 1, rotated, moved (an ellipsoid)', pixels: n, missing,
      worstDegrees: +worst.toFixed(4), forwardMatrixWouldBeOffByDegrees: +forward.toFixed(1) };
  }, SINGLE);
  check('sdf_normal_matches_analytic', [n1, n2, n3].every((r) => r.pixels > 500 && r.missing === 0 && r.worstDegrees < 0.5), [n1, n2, n3],
    'For a single blob (an exact sphere), the tetrahedral field-gradient normal matches the analytic sphere normal within 0.5 degrees, also under a rotated, moved and uniformly scaled Geometry COMP, and under non-uniform scale it matches the exact ellipsoid normal (inverse transpose).');

  // ---------------------------------------------------------------- 2. thickness
  // The interior march must find the exit: path length = exact chord (straight at IOR 1, refracted at IOR 1.5).
  const chordCase = (ior, blobs, centre, R) => page.evaluate(([ior, blobs, centre, R, SINGLE]) => {
    const { W, H, v, ray, hitSphere, refract, at } = window.TH;
    window.preview.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, blobs, clear: [-1, -1, -1, -1],
      overrides: { ...SINGLE, Radius: 0.6, Ior: ior, Stage: 'thickness' } });
    const f = window.TH.readAll();
    let worst = 0, n = 0, missing = 0;
    for (let y = 0; y < H; y += 9) for (let x = 0; x < W; x += 9) {
      const r = ray(x, y), h = hitSphere(r, centre, R);
      if (!h) continue;
      const oc = v.sub(r.o, centre), b = v.dot(oc, r.d);
      if (Math.sqrt(Math.max(v.dot(oc, oc) - b * b, 0)) > 0.97 * R) continue;
      const t = refract(r.d, h.n, 1 / ior);
      const chord = -2 * v.dot(v.sub(h.p, centre), t);   // second intersection of p + s t with the sphere
      const c = at(f, x, y);
      if (c[0] < -0.5) { missing++; continue; }
      worst = Math.max(worst, Math.abs(2 * c[0] - chord)); n++;
    }
    return { ior, pixels: n, missing, worstSceneUnits: +worst.toFixed(5) };
  }, [ior, blobs, centre, R, SINGLE]);
  const c1 = await chordCase(1.0, {}, [0, 0, 0], 0.6);
  const c2 = await chordCase(1.5, {}, [0, 0, 0], 0.6);
  const c3 = await chordCase(1.5, { scale: [1.3, 1.3, 1.3], translate: [0.1, 0.2, 0] }, [0.1, 0.2, 0], 0.78);
  check('thickness_matches_exact_chord', [c1, c2, c3].every((r) => r.pixels > 300 && r.missing === 0 && r.worstSceneUnits < 0.005),
    [c1, c2, c3],
    'The path the interior march measures through a single blob equals the exact chord of the (refracted) ray through the sphere, within 0.005 scene units, in scene units even when the object is scaled.');

  // ---------------------------------------------------------------- 2b. the lens path
  // A UV ramp replaces the backdrop, so the refraction stage reads back where each pixel
  // sampled the Refraction TOP. Compare with an exact trace through the sphere: refract in,
  // the exact chord, refract out at the exact exit normal, travel Backdrop units, project. Object size 1, so
  // Backdrop distance is in scene units (the default Object size is the demo box's fit, 1 / 1.45).
  const lensCase = (ior, backdrop, scale) => page.evaluate(([ior, backdrop, scale]) => {
    const { W, H, v, rayAny, hitSphere, refract, reflect, project, at } = window.TH, P = window.preview;
    const R = 0.6 * scale;
    const opts = { preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1], backdrop: 'uv',
      blobs: { scale: [scale, scale, scale] }, overrides: { Count: 1, Spread: 0, Droplets: 0, Stretch: 0, Ripple: 0, Radius: 0.6,
        Ior: ior, Backdrop: backdrop, Dispersion: 0, Frost: 0, Saturation: 1, Stage: 'refraction', Objectsize: 1 } };
    P.draw(opts); const f = P.floats(), cams = P.camera(opts);
    const mirror = (u) => 1 - Math.abs(1 - (((u % 2) + 2) % 2));   // mirrorUV() in the shader
    let n = 0, worst = 0, tir = 0, oppositeBetter = 0, missing = 0;
    for (let y = 0; y < H; y += 6) for (let x = 0; x < W; x += 6) {
      const r = rayAny(cams, x, y), oc = r.o, b = v.dot(oc, r.d), q = v.dot(oc, oc) - R * R, disc = b * b - q;
      if (disc < 0 || Math.sqrt(Math.max(v.dot(oc, oc) - b * b, 0)) > 0.95 * R) continue;   // skip the rim
      const p = v.add(r.o, v.mul(r.d, -b - Math.sqrt(disc))), inside = v.norm(refract(r.d, v.mul(p, 1 / R), 1 / ior));
      const exit = v.add(p, v.mul(inside, -2 * v.dot(p, inside))), nExit = v.mul(exit, 1 / R);
      let out = refract(inside, v.mul(nExit, -1), ior); if (!out) { out = reflect(inside, v.mul(nExit, -1)); tir++; }
      const [u, w] = project(cams, v.add(exit, v.mul(out, backdrop)));
      const c = at(f, x, y); if (c[0] < -0.5) { missing++; continue; }
      const err = Math.hypot((c[0] - mirror(u)) * W, (c[1] - mirror(w)) * H);
      const pu = (x + 0.5) / W, pv = (y + 0.5) / H;   // the same shift with the opposite sign
      if (Math.hypot((c[0] - mirror(2 * pu - u)) * W, (c[1] - mirror(2 * pv - w)) * H) + 1 < err) oppositeBetter++;
      worst = Math.max(worst, err); n++;
    }
    return { ior, backdrop, scale, pixels: n, missing, tirPixels: tir, worstErrorPixels: +worst.toFixed(3), oppositeSignFitsBetter: oppositeBetter };
  }, [ior, backdrop, scale]);
  const lens = [await lensCase(1.5, 1.6, 1), await lensCase(1.33, 0.6, 1), await lensCase(2.2, 1.0, 1), await lensCase(1.5, 1.6, 1.3)];
  check('lens_matches_exact_trace', lens.every((r) => r.pixels > 800 && r.missing === 0 && r.worstErrorPixels < 1 && r.oppositeSignFitsBetter === 0), lens,
    'Where the glass samples the Refraction TOP matches an exact two-surface trace through a sphere (bend in, exact chord, bend out at the exact exit normal, Backdrop distance, camera projection) within 1 pixel, at IOR 1.33, 1.5 and 2.2 and under a scaled Geometry COMP.');

  // Beer-Lambert: through fully translucent tinted glass, body / refraction = exp(-(1 - colour) x density x chord),
  // with the chord read from the thickness stage of the same render. IOR 1, so the chords run from 0 at the
  // rim to the full diameter (at IOR 1.55 a sphere's chords only span 0.92 to 1.2; the old range down to
  // 0.003 came from rim pixels whose normals were flipped, fixed by faceCamera in the family sync).
  const beer = await page.evaluate(() => {
    const { W, H } = window.TH, P = window.preview;
    const density = 1.5, glass = [1, 0.5, 0.25];
    const ov = { Count: 1, Spread: 0, Droplets: 0, Stretch: 0, Ripple: 0, Radius: 0.6, Translucency: 1, Edgetint: 0, Density: density,
      Glasscolorr: glass[0], Glasscolorg: glass[1], Glasscolorb: glass[2], Saturation: 1, Dispersion: 0, Frost: 0, Ior: 1.0,
      Objectsize: 1 };  // Tint density in scene units: Object size 1 (the default is the demo box's fit, 1 / 1.45)
    const stage = (s) => { P.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1], backdrop: 'uv',
      overrides: { ...ov, Stage: s } }); return P.floats().slice(); };
    const body = stage('body'), through = stage('refraction'), thick = stage('thickness');
    let samples = 0, worst = 0, minChord = 9, maxChord = 0;
    for (let i = 0; i < W * H; i += 7) {
      if (thick[4 * i] < 0) continue;
      const chord = 2 * thick[4 * i]; minChord = Math.min(minChord, chord); maxChord = Math.max(maxChord, chord);
      for (let k = 0; k < 3; k++) {
        if (through[4 * i + k] < 0.05) continue;
        const expect = Math.exp(-(1 - glass[k]) * density * chord);
        worst = Math.max(worst, Math.abs(body[4 * i + k] / through[4 * i + k] - expect) / expect); samples++;
      }
    }
    return { density, glass, samples, chordRange: [+minChord.toFixed(3), +maxChord.toFixed(3)], worstRelativeError: +worst.toExponential(3) };
  });
  check('beer_lambert_tint_follows_measured_chord', beer.samples > 5000 && beer.chordRange[1] - beer.chordRange[0] > 0.5 && beer.worstRelativeError < 1e-3, beer,
    'Through fully translucent tinted glass, each colour channel keeps exp(-(1 - glass colour) x density x chord) of the light behind, with the chord the interior march measured at that pixel: thick parts tint more than thin rims.');

  // ---------------------------------------------------------------- 3. depth
  // gl_FragDepth of the raymarched surface must equal the depth a rasterized sphere writes at the same pixel.
  const depthCase = (transform, label) => page.evaluate(([transform, label, SINGLE]) => {
    const { W, H, at, eyeZ } = window.TH;
    const R = 0.6;
    const meshT = { ...transform, scale: (transform.scale || [1, 1, 1]).map((s) => s * R) };
    window.preview.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, blobsOff: true, clear: [-1, -1, -1, -1],
      probe: [{ mesh: 'sphere', transform: meshT, depth: true }] });
    const raster = window.TH.readAll().slice();
    window.preview.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, blobs: transform, clear: [-1, -1, -1, -1],
      overrides: { ...SINGLE, Radius: R, Stage: 'depth' } });
    const marched = window.TH.readAll();
    let worst = 0, n = 0, worstDepth = 0;
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
      const a = at(raster, x, y)[0], b = at(marched, x, y)[0];
      if (a < 0 || b < 0) continue;
      // Ignore an 8-pixel band at the silhouette: there the mesh's flat facets are seen
      // edge-on and their depth departs from the true sphere's (tessellation, not the shader).
      const ring = [[8, 0], [-8, 0], [0, 8], [0, -8], [6, 6], [-6, 6], [6, -6], [-6, -6]]
        .some(([dx, dy]) => at(raster, x + dx, y + dy)[0] < 0);
      if (ring) continue;
      worst = Math.max(worst, Math.abs(eyeZ(a) - eyeZ(b)));
      worstDepth = Math.max(worstDepth, Math.abs(a - b)); n++;
    }
    return { label, pixels: n, worstEyeDistance: +worst.toExponential(3), worstDepthValue: +worstDepth.toExponential(3) };
  }, [transform, label, SINGLE]);
  const d1 = await depthCase({}, 'sphere at origin');
  const d2 = await depthCase({ scale: [1.4, 0.8, 1.0], rotate: [25, 40, 10], translate: [0.2, 0.1, 0.4] },
    'non-uniform scale, rotated, moved (an ellipsoid)');

  // Occlusion through the real depth test: a rasterized red sphere and a blob sphere overlap.
  const occlusion = await page.evaluate((SINGLE) => {
    const { W, H, v, ray, hitSphere, at } = window.TH;
    const R = 0.5, red = [0.35, 0, -0.25], blob = [-0.3, 0, 0.1];
    window.preview.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1],
      blobs: { translate: blob }, probe: [{ mesh: 'sphere', transform: { translate: red, scale: [R, R, R] }, color: [1, 0, 0, 1] }],
      overrides: { ...SINGLE, Radius: R, Stage: 'normal' } });
    const f = window.TH.readAll();
    let checked = 0, wrong = 0, boundary = 0;
    for (let y = Math.floor(H / 2) - 60; y <= Math.floor(H / 2) + 60; y += 6) for (let x = 0; x < W; x++) {
      const r = ray(x, y), a = hitSphere(r, red, R), b = hitSphere(r, blob, R);
      if (!a && !b) continue;
      const expectRed = a && (!b || a.s < b.s);
      // Skip pixels within 1.5 px of where the two surfaces swap (the analytic boundary).
      const nb = [-1.5, 1.5].map((dx) => { const rr = ray(x + dx, y), aa = hitSphere(rr, red, R), bb = hitSphere(rr, blob, R);
        return aa && (!bb || aa.s < bb.s); });
      if (nb.some((e) => e !== expectRed) || !a !== !hitSphere(ray(x + 1.5, y), red, R) || !b !== !hitSphere(ray(x + 1.5, y), blob, R)
          || !a !== !hitSphere(ray(x - 1.5, y), red, R) || !b !== !hitSphere(ray(x - 1.5, y), blob, R)) { boundary++; continue; }
      const c = at(f, x, y), isRed = Math.abs(c[0] - 1) < 1e-3 && c[1] < 1e-3 && c[2] < 1e-3;
      checked++; if (isRed !== !!expectRed) wrong++;
    }
    return { checked, wrong, skippedNearBoundary: boundary };
  }, SINGLE);
  check('depth_matches_rasterized_sphere', d1.pixels > 2000 && d2.pixels > 2000 && d1.worstEyeDistance < 2e-3
    && d2.worstEyeDistance < 2e-3 && occlusion.checked > 1000 && occlusion.wrong === 0, { d1, d2, occlusion },
    'The depth the shader writes (camProj, 0..1) matches a rasterized sphere mesh of the same size and transform within 0.002 scene units of eye distance, and a raster sphere and a blob sphere occlude each other exactly where the analytic surfaces cross.');

  // Other projections: the ray comes from the camera's own matrices, so silhouettes and depth must
  // match a rasterized sphere for orthographic and blended (neither perspective nor orthographic) cameras.
  const projectionCase = (cam) => page.evaluate(([cam, SINGLE]) => {
    const { W, H, v, at, unproject } = window.TH, P = window.preview;
    const R = 0.6;
    P.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, blobsOff: true, clear: [-1, -1, -1, -1], ...cam,
      probe: [{ mesh: 'sphere', transform: { scale: [R, R, R] }, depth: true }] });
    const raster = P.floats().slice();
    const opts = { preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1], ...cam,
      overrides: { ...SINGLE, Radius: R, Stage: 'depth' } };
    P.draw(opts); const marched = P.floats(), cams = P.camera(opts);
    const band = (f, x, y) => [[8, 0], [-8, 0], [0, 8], [0, -8], [6, 6], [-6, 6], [6, -6], [-6, -6]].some(([dx, dy]) => at(f, x + dx, y + dy)[0] < 0);
    let n = 0, worst = 0, missing = 0, extra = 0;
    for (let y = 8; y < H - 8; y += 3) for (let x = 8; x < W - 8; x += 3) {
      const a = at(raster, x, y)[0], b = at(marched, x, y)[0];
      if ((a < 0 && b < 0) || band(raster, x, y) || band(marched, x, y)) continue;
      if (a < 0) { extra++; continue; } if (b < 0) { missing++; continue; }
      // Both depths back to world points on this pixel's ray: their distance is the error in scene units.
      worst = Math.max(worst, Math.hypot(...v.sub(unproject(cams, x, y, a), unproject(cams, x, y, b)))); n++;
    }
    return { camera: cam, pixels: n, missingVersusRaster: missing, extraVersusRaster: extra, worstSceneUnits: +worst.toExponential(3) };
  }, [cam, SINGLE]);
  const projections = [await projectionCase({ projection: 'ortho' }), await projectionCase({ projection: 'blend', blend: 0.5 }),
                       await projectionCase({ projection: 'blend', blend: 0.8 })];
  check('any_projection_matches_raster', projections.every((r) => r.pixels > 2000 && r.missingVersusRaster === 0 && r.extraVersusRaster === 0 && r.worstSceneUnits < 2e-3),
    projections,
    'With an orthographic camera and with projection matrices blended between perspective and orthographic, the blobs cover the same pixels as a rasterized sphere (away from an 8-pixel silhouette band) and write the same depth within 0.002 scene units.');

  // The near plane: rays start where they cross it, so glass nearer than the near plane is clipped,
  // as ordinary geometry is. Camera inside the box at z = 0.9, near plane 0.6, sphere radius 0.35.
  const nearPlane = await page.evaluate(() => {
    const { W, H, v, at, rayAny } = window.TH, P = window.preview;
    const R = 0.35, opts = { preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1], cameraZ: 0.9, near: 0.6,
      overrides: { Count: 1, Spread: 0, Droplets: 0, Stretch: 0, Ripple: 0, Radius: R, Stage: 'depth' } };
    P.draw(opts); const f = P.floats(), cams = P.camera(opts);
    let expectHit = 0, expectClip = 0, wrong = 0, skipped = 0, depthZero = 0;
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
      const r = rayAny(cams, x, y), b = v.dot(r.o, r.d), q = v.dot(r.o, r.o) - R * R, disc = b * b - q;
      // Near-plane point inside the sphere: clipped. Outside and the ray reaches the sphere: drawn.
      const hit = q > 0 && disc > 0 && -b - Math.sqrt(disc) > 0;
      // Skip a band at both boundaries: the near-plane point close to the surface, and rays that
      // graze the silhouette (they hit or miss within the march's surface epsilon).
      if (Math.abs(q) < 0.004 || Math.abs(disc) < 0.004) { skipped++; continue; }
      const d = at(f, x, y)[0], drawn = d >= 0;
      if (hit) expectHit++; else expectClip++;
      if (drawn !== hit) wrong++;
      if (drawn && d < 1e-6) depthZero++;
    }
    return { expectDrawn: expectHit, expectClipped: expectClip, wrong, skippedNearBoundary: skipped, drawnAtDepthZero: depthZero };
  });
  check('near_plane_clips_the_blobs', nearPlane.expectDrawn > 1000 && nearPlane.expectClipped > 1000 && nearPlane.wrong === 0 && nearPlane.drawnAtDepthZero === 0,
    nearPlane, 'Glass nearer than the camera\'s near plane is not drawn (and never written at depth 0, in front of everything); glass beyond it is drawn, pixel for pixel as an exact ray from the near plane predicts.');

  // ---------------------------------------------------------------- 4. invisibility
  let d = await diff({ preset: 'prism_clear', time: 3, overrides: INVISIBLE }, { preset: 'prism_clear', time: 3, blobsOff: true });
  check('ior1_is_invisible', d.max <= 2, d,
    'With IOR 1, saturation 1 and no dispersion, frost, tint or light terms, the blobs show exactly the Refraction TOP (the ring stays correctly in front).');

  d = await diff({ preset: 'prism_clear', time: 3, overrides: { Opacity: 0 } }, { preset: 'prism_clear', time: 3, blobsOff: true });
  check('opacity0_is_invisible', d.max <= 2, d, 'Opacity 0 removes the blobs entirely, reflections included.');

  d = await diff({ preset: 'prism_clear', time: 3, refraction: false, overrides: INVISIBLE }, { preset: 'prism_clear', time: 3, blobsOff: true });
  check('no_refraction_top_blends_clear', d.max <= 2, d,
    'With no Refraction TOP, clear untinted blobs with no light terms blend to the real background (alpha 0).');

  // A Refraction TOP rendered over a transparent background (Render TOP background alpha 0), with the
  // final render composited over the backdrop afterwards: the glass must keep that TOP's alpha.
  d = await diff({ preset: 'prism_clear', time: 3, scene: 'transparent', overrides: INVISIBLE },
                 { preset: 'prism_clear', time: 3, scene: 'transparent', blobsOff: true });
  const centre = await page.evaluate((SINGLE) => {
    const { W, H } = window.TH, P = window.preview;
    P.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [0, 0, 0, 0], scene: 'transparent',
      overrides: { ...SINGLE, Reflection: 0, Rim: 0, Specular: 0, Iridescence: 0 } });
    const f = P.floats(); let n = 0, a = 0;
    for (let y = H / 2 - 20; y <= H / 2 + 20; y++) for (let x = W / 2 - 20; x <= W / 2 + 20; x++) { n++; a += f[(y * W + x) * 4 + 3]; }
    return { meanAlphaAtBlobCentre: +(a / n).toFixed(4) };
  }, SINGLE);
  check('transparent_refraction_top_keeps_background', d.max <= 2 && centre.meanAlphaAtBlobCentre < 0.01, { versusNoBlobs: d, ...centre },
    'Where the Refraction TOP is transparent, clear glass passes the background composited behind the final render later: invisible glass leaves that composite unchanged, and a clear blob over empty space has alpha 0 (not opaque black).');

  // Fog (stand-in TDFog: blend 50 % toward green). Fog must not leak where the glass passes the background.
  const fog = [0, 1, 0, 0.5];
  const fogOpacity0 = await diff({ preset: 'prism_clear', time: 3, fog, overrides: { Opacity: 0 } }, { preset: 'prism_clear', time: 3, blobsOff: true });
  const fogClear = await diff({ preset: 'prism_clear', time: 3, refraction: false, fog, overrides: INVISIBLE }, { preset: 'prism_clear', time: 3, blobsOff: true });
  const fogOn = await diff({ preset: 'prism_clear', time: 3, fog }, { preset: 'prism_clear', time: 3 });
  check('fog_keeps_premultiplied_alpha', fogOpacity0.max <= 2 && fogClear.max <= 2 && fogOn.max > 50, { fogOpacity0, fogClear, fogOn },
    'TDFog() is applied to the premultiplied glass so that fog only adds its colour in proportion to the glass\'s alpha: with fog on, Opacity 0 and see-through glass still leave the image unchanged, while opaque glass is fogged (stand-in fog; TouchDesigner\'s own fog is pending native checks).');

  // Draw order (zero-wiring mode): a red sphere behind a clear blob shows through only if it is drawn
  // before the blobs. The preview always draws blobs_geo last, as its Draw Priority (-1) asks for.
  const order = await page.evaluate((SINGLE) => {
    const { W, H } = window.TH, P = window.preview;
    const probe = [{ mesh: 'sphere', transform: { translate: [0, 0, -2], scale: [0.5, 0.5, 0.5] }, color: [1, 0, 0, 1] }];
    const red = (opts) => { P.draw({ preset: 'prism_clear', time: 3, ring: false, refraction: false, clear: [0, 0, 0, 1], probe, overrides: SINGLE, ...opts });
      const px = P.pixels(); let n = 0, r = 0;
      for (let y = H / 2 - 10; y <= H / 2 + 10; y++) for (let x = W / 2 - 10; x <= W / 2 + 10; x++) { n++; r += px[(y * W + x) * 4] / 255; }
      return +(r / n).toFixed(3); };
    return { sphereAlone: red({ blobsOff: true }), sphereDrawnBeforeBlobs: red({}), sphereDrawnAfterBlobs: red({ probeAfter: true }) };
  }, SINGLE);
  check('draw_order_matters_without_refraction_top', order.sphereDrawnBeforeBlobs > 0.9 && order.sphereDrawnAfterBlobs < 0.3, order,
    'Documents a limit rather than a feature: without a Refraction TOP, an object behind the blobs shows through the glass only if it is drawn before them, because the blobs write depth. This is why blobs_geo gets Draw Priority -1 (drawn after the default 0).');

  // ---------------------------------------------------------------- 5. smooth-min stays finite, no holes
  const finite = await page.evaluate(() => {
    const { W, H, at } = window.TH;
    // Small enough that no centre is clamped into the box, so only the merge width changes.
    const base = { Count: 6, Radius: 0.25, Spread: 0.3, Droplets: 3, Stretch: 0.6, Ripple: 0 };
    const cover = (over) => {
      window.preview.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1],
        overrides: { ...base, ...over, Stage: 'proxy' } });
      const f = window.TH.readAll(), m = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) m[i] = f[4 * i] > 0.9 ? 1 : 0;   // hit = 0.92 grey, miss = dark blue
      return m;
    };
    const finiteStage = (over) => {
      window.preview.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1],
        overrides: { ...base, ...over, Stage: 'finite' } });
      const f = window.TH.readAll(); let red = 0;
      for (let i = 0; i < W * H; i++) if (f[4 * i] > 0.9 && f[4 * i + 1] < 0.1) red++;
      window.preview.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [0, 0, 0, 0],
        overrides: { ...base, ...over, Stage: 'final' } });
      const g = window.TH.readAll(); let nonFinite = 0;
      for (let i = 0; i < g.length; i++) if (!Number.isFinite(g[i])) nonFinite++;
      return { flaggedByShader: red, nonFiniteFinalValues: nonFinite };
    };
    const hard = cover({ Merge: 0 });
    const rows = [];
    for (const k of [0, 0.00005, 0.001, 0.3, 1.0]) {
      const m = cover({ Merge: k });
      let holes = 0, covered = 0;
      for (let i = 0; i < W * H; i++) { covered += m[i]; if (hard[i] && !m[i]) holes++; }
      rows.push({ merge: k, covered, holesVersusPlainUnion: holes, ...finiteStage({ Merge: k }) });
    }
    const extreme = { Count: 12, Droplets: 6, Ripple: 1, Ripplescale: 20, Stretch: 2, Merge: 1, Spread: 0.9 };
    rows.push({ merge: 'extreme (12 blobs, 6 droplets, ripple 1, stretch 2)', ...finiteStage(extreme) });
    rows.push({ merge: 'fractional count 2.5', ...finiteStage({ Count: 2.5, Merge: 0.4 }) });
    // Coincident centres: Spread 0 puts every blob at the origin; the union is the largest sphere (blob 0, radius 0.4).
    const { v, ray, hitSphere } = window.TH;
    const m = cover({ Spread: 0, Droplets: 0, Stretch: 0, Radius: 0.4, Merge: 0.5 });
    let inside = 0, holes = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const r = ray(x, y), oc = v.sub(r.o, [0, 0, 0]), b = v.dot(oc, r.d);
      if (Math.sqrt(Math.max(v.dot(oc, oc) - b * b, 0)) > 0.98 * 0.4) continue;
      inside++; if (!m[y * W + x]) holes++;
    }
    rows.push({ merge: 'coincident centres (spread 0), merge 0.5', pixelsInsideLargestSphere: inside, holes,
      ...finiteStage({ Spread: 0, Droplets: 0, Stretch: 0, Radius: 0.4, Merge: 0.5 }) });
    return rows;
  });
  check('smooth_min_stays_finite_without_holes',
    finite.every((r) => (r.holesVersusPlainUnion ?? 0) === 0 && (r.holes ?? 0) === 0 && r.flaggedByShader === 0 && r.nonFiniteFinalValues === 0)
      && finite[finite.length - 1].pixelsInsideLargestSphere > 1000,
    finite,
    'Across merge widths from 0 (plain union) through 0.00005 (below the zero-width guard) to 1, extreme layouts and coincident centres, no pixel is NaN or infinite, and the smooth union covers every pixel the plain union covers (no holes).');

  // ---------------------------------------------------------------- 5b. blobs bigger than the box
  // One blob is convex, and so is its intersection with the box, so the pixels it covers have no
  // holes: every row and every column of covered pixels must be one unbroken run. Slider maxima
  // included. Coverage is read from the final image (alpha > 0 over a cleared background), where a
  // pixel whose ray passes within half a pixel of the glass counts as covered (edge smoothing). The
  // hard-edged proxy stage is not used: where the outline runs exactly along a pixel column, rays
  // pass within the march's epsilon of the glass, and pixels there flip between hit and miss.
  const cut = await page.evaluate(() => {
    const { W, H } = window.TH, P = window.preview;
    const one = (label, over, blobs) => {
      const opts = { preset: 'prism_clear', time: 3, ring: false, float: true, clear: [0, 0, 0, 0], blobs,
        overrides: { Count: 1, Spread: 0, Droplets: 0, Ripple: 0, ...over, Stage: 'final' } };
      P.draw(opts); const f = P.floats(); const hit = (x, y) => f[(y * W + x) * 4 + 3] > 0;
      let gaps = 0, hits = 0;
      for (let y = 0; y < H; y++) { let a = -1, b = -1; for (let x = 0; x < W; x++) if (hit(x, y)) { if (a < 0) a = x; b = x; hits++; }
        for (let x = a + 1; a >= 0 && x < b; x++) if (!hit(x, y)) gaps++; }
      for (let x = 0; x < W; x++) { let a = -1, b = -1; for (let y = 0; y < H; y++) if (hit(x, y)) { if (a < 0) a = y; b = y; }
        for (let y = a + 1; a >= 0 && y < b; y++) if (!hit(x, y)) gaps++; }
      P.draw({ ...opts, clear: [0, 0, 0, 0], overrides: { ...opts.overrides, Stage: 'finite' } });
      const g = P.floats(); let red = 0; for (let i = 0; i < W * H; i++) if (g[4 * i] > 0.9 && g[4 * i + 1] < 0.1) red++;
      return { label, hits, missesInsideRuns: gaps, flaggedNotFinite: red };
    };
    return [one('capsule, radius 0.7, stretch 0.8', { Radius: 0.7, Stretch: 0.8 }),
            one('capsule, radius 0.9, stretch 0.8', { Radius: 0.9, Stretch: 0.8 }),
            one('slider maxima: radius 0.9, stretch 2, merge 1', { Radius: 0.9, Stretch: 2, Merge: 1 }),
            one('slider maxima, box rotated 25/40/0', { Radius: 0.9, Stretch: 2, Merge: 1 }, { rotate: [25, 40, 0] })];
  });
  check('blobs_cut_by_the_box_have_no_holes', cut.every((r) => r.hits > 50000 && r.missesInsideRuns === 0 && r.flaggedNotFinite === 0), cut,
    'A blob too big for the proxy box is cut flat by its walls instead of showing see-through holes: a single blob crossing the walls, up to the slider maxima, covers an unbroken region (no miss inside any row or column of hits) and stays finite.');

  // ---------------------------------------------------------------- 6. bindings and controls
  d = await diff({ preset: 'prism_clear', time: 3, overrides: { Stage: 'refraction', Dispersion: 0, Frost: 0, Samples: 1 } },
                 { preset: 'prism_clear', time: 3, overrides: { Stage: 'refraction', Dispersion: 0, Frost: 0, Samples: 16 } });
  check('samples_invariant_without_dispersion', d.max <= 2, d,
    'Without dispersion or frost, every colour sample takes the same path, so the sample count cannot change the image.');

  d = await diff({ preset: 'prism_clear', time: 3, overrides: { Morphtarget: 'lavender_gel', Morph: 1 } },
                 { preset: 'lavender_gel', time: 3 });
  check('morph1_equals_target', d.max <= 2, d, 'Morph 1 toward a preset renders that preset, blob shape included.');

  d = await diff({ preset: 'sapphire_drops', time: 3, overrides: { Morphtarget: 'amber_syrup', Morph: 0 } },
                 { preset: 'sapphire_drops', time: 3 });
  check('morph0_is_neutral', d.max <= 2, d, 'Morph 0 leaves the current look unchanged.');

  // V1 (verifier): the brief asks for twelve presets. Each must look different from every other one,
  // on this study's Checker backdrop and on the family's Type backdrop.
  const distinct = await page.evaluate(() => {
    const P = window.preview, names = P.presets.order, out = { presets: names.length };
    for (const backdrop of ['checker', 'type']) {
      const imgs = names.map((n) => { P.draw({ preset: n, time: 3, overrides: { Demobackdrop: backdrop } }); return P.pixels().slice(); });
      let closest = null;
      for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
        const x = imgs[a], y = imgs[b]; let s = 0;
        for (let i = 0; i < x.length; i += 4) s += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
        const mean = s / (x.length / 4 * 3);
        if (!closest || mean < closest.meanDifference) closest = { pair: [names[a], names[b]], meanDifference: +mean.toFixed(2) };
      }
      out[backdrop] = closest;
    }
    return out;
  });
  check('presets_stay_distinct', distinct.presets === 12 && distinct.checker.meanDifference >= 10 && distinct.type.meanDifference >= 10, distinct,
    'There are twelve presets, and at t = 3 s every pair differs by a mean of at least 10/255 per channel over the whole frame, on the Checker backdrop and on the Type backdrop (the blobs cover only part of the frame).');

  // Geometry, not final colour: through a thick lens the refracted image is (correctly) very
  // sensitive to tiny shape changes, so continuity is judged on the normal stage. A shrinking
  // blob moves its hard-edged silhouette, so pixels may flip along the outline (at most one
  // band of outline pixels); everywhere both renders hit, normals must agree within 1 degree.
  const continuity = (a, b) => page.evaluate(([a, b]) => {
    const { W, H } = window.TH;
    const read = (count) => {
      window.preview.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1],
        overrides: { Count: count, Stage: 'normal' } });
      return window.TH.readAll().slice();
    };
    const fa = read(a), fb = read(b);
    const cov = (f, i) => f[4 * i] >= 0;
    const nrm = (f, i) => [0, 1, 2].map((k) => 2 * f[4 * i + k] - 1);
    const angle = (n, m) => Math.acos(Math.min(1, (n[0] * m[0] + n[1] * m[1] + n[2] * m[2]) / Math.hypot(...n) / Math.hypot(...m))) * 180 / Math.PI;
    // Edge pixels: silhouettes, and occlusion edges where one blob passes in front of another.
    const edge = (f, i) => [i - 1, i + 1, i - W, i + W].some((j) => !cov(f, j) || angle(nrm(f, i), nrm(f, j)) > 15);
    let flips = 0, outline = 0, worst = 0, edges = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (cov(fa, i) !== cov(fb, i)) flips++;
      if (cov(fa, i) && edge(fa, i)) outline++;
      if (cov(fa, i) && cov(fb, i)) {
        if (edge(fa, i) || edge(fb, i)) { edges++; continue; }
        worst = Math.max(worst, angle(nrm(fa, i), nrm(fb, i)));
      }
    }
    return { counts: [a, b], coverageFlips: flips, outlinePixels: outline, sharedEdgePixelsSkipped: edges, worstSharedNormalDegrees: +worst.toFixed(3) };
  }, [a, b]);
  const appear = await continuity(3.0, 3.002);   // a fourth blob starts to grow in
  const big = await continuity(2.998, 3.0);      // the third blob finishes growing, step 0.002
  const small = await continuity(2.9995, 3.0);   // the same with a 4x smaller step
  check('fractional_count_is_continuous',
    [appear, big, small].every((r) => r.coverageFlips <= r.outlinePixels) && appear.worstSharedNormalDegrees < 1
      && small.worstSharedNormalDegrees <= 0.5 * big.worstSharedNormalDegrees + 0.05,
    { appear, big, small },
    'Count changes the shape continuously: a blob starting to grow in changes nothing visible, coverage only moves along outlines, and away from edges the normal change shrinks with the step (a 4x smaller step gives at most half the change), so Count can be morphed. Merge necks are highly curved, so they react most.');

  const layout = await normalCase('layout', {}, [-0.42, 0.12, 0.0], 0.36, 5,
    { label: 'blob 0 from the layout TOP', radius: 0.36, overrides: { Layout: 'top' } });
  check('layout_top_places_blobs', layout.pixels > 300 && layout.missing === 0 && layout.worstDegrees < 0.5, layout,
    'With Layout = Layout TOP, blob 0 sits at the centre and radius in pixel 0 of the layout TOP (row 1 of blob_layout.tsv): its normals match a sphere of radius 0.36 at (-0.42, 0.12, 0).');

  const inside = await normalCase('inside', {}, [0, 0, 0], 0.35, 0.9, { label: 'camera at z = 0.9, inside the proxy box', radius: 0.35 });
  check('camera_inside_proxy_box', inside.pixels > 1000 && inside.missing === 0 && inside.worstDegrees < 0.5, inside,
    'With the camera inside the proxy box (but outside the glass) the blobs still render correctly, because the material draws the box\'s back faces and starts each ray at the camera.');

  const instances = await page.evaluate((SINGLE) => {
    const { W, H, v, ray, hitSphere, at } = window.TH;
    const R = 0.3;
    const m = (x, y) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];
    window.preview.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1],
      instances: [m(-0.9, 0.2), m(0.8, -0.3)], blobs: { scale: [0.5, 0.5, 0.5] },
      overrides: { ...SINGLE, Radius: 0.6, Stage: 'normal' } });
    const f = window.TH.readAll();
    // Each instance's object origin lands at world * instance * 0 = 0.5 * translation.
    return [[-0.45, 0.1, 0], [0.4, -0.15, 0]].map((c) => {
      let worst = 0, n = 0, missing = 0;
      for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
        const r = ray(x, y), h = hitSphere(r, c, R);
        if (!h) continue;
        const oc = v.sub(r.o, c), b = v.dot(oc, r.d);
        if (Math.sqrt(Math.max(v.dot(oc, oc) - b * b, 0)) > 0.97 * R) continue;
        const px = at(f, x, y); if (px[0] < -0.5) { missing++; continue; }
        const nn = v.norm([2 * px[0] - 1, 2 * px[1] - 1, 2 * px[2] - 1]);
        worst = Math.max(worst, Math.acos(Math.min(1, v.dot(nn, h.n))) * 180 / Math.PI); n++;
      }
      return { centre: c, pixels: n, missing, worstDegrees: +worst.toFixed(4) };
    });
  }, SINGLE);
  check('instances_follow_their_transforms', instances.every((r) => r.pixels > 300 && r.missing === 0 && r.worstDegrees < 0.5), instances,
    'With two instances (stand-in TDDeform applies an instance matrix), each instance draws its blob at its own transform: the vertex shader captures origin and axes through TDDeform.');

  // ---------------------------------------------------------------- 7. the finite check can fail
  const finiteControl = await page.evaluate(() => {
    const { W, H } = window.TH, P = window.preview;
    const run = (over, extra = {}) => {
      P.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [0, 0, 0, 0], ...extra,
        overrides: { Count: 1, Spread: 0, Droplets: 0, Radius: 0.6, ...over, Stage: 'finite' } });
      const f = P.floats(); let red = 0, green = 0;
      for (let i = 0; i < W * H; i++) { if (f[4 * i] > 0.9 && f[4 * i + 1] < 0.1) red++; if (f[4 * i + 1] > 0.8 && f[4 * i] < 0.2) green++; }
      return { red, green };
    };
    return { nanDensity: run({ Density: NaN }), lightDirectionZero: run({ Lightdirx: 0, Lightdiry: 0, Lightdirz: 0 }),
             lightAlongOrthographicView: run({ Lightdirx: 0, Lightdiry: 0, Lightdirz: 1 }, { projection: 'ortho' }) };
  });
  check('finite_check_flags_nan', finiteControl.nanDensity.red > 10000 && finiteControl.nanDensity.green === 0
    && finiteControl.lightDirectionZero.red === 0 && finiteControl.lightAlongOrthographicView.red === 0, finiteControl,
    'Positive control: a NaN tint density turns every glass pixel of the finite-check stage red (the stage tests float bits, which fast-math compilers cannot assume away). A zero light direction and a light straight along an orthographic view stay finite.');

  const [W, H] = await page.evaluate(() => window.preview.size);
  const uvPoint = [Math.floor(W / 2) + 37, Math.floor(H / 2) - 21];
  const uvPixel = await page.evaluate(([x, y]) => {
    window.preview.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1],
      overrides: { Count: 1, Spread: 0, Droplets: 0, Radius: 0.6, Stage: 'screenuv' } });
    return window.TH.at(window.TH.readAll(), x, y);
  }, uvPoint);
  const uvExpected = [(uvPoint[0] + 0.5) / W, (uvPoint[1] + 0.5) / H];
  check('screen_uv_matches_pixel', Math.abs(uvPixel[0] - uvExpected[0]) < 1e-4 && Math.abs(uvPixel[1] - uvExpected[1]) < 1e-4,
    { pixel: uvPoint, measured: uvPixel.slice(0, 2), expected: uvExpected },
    'screenUV() gives the pixel position over the render size (preview viewport stand-in).');

  // ---------------------------------------------------------------- 8. family sync with the core (rounds 2 and 3)
  // Per-pixel statistics of two consecutive draws (RGBA8): max and 99th percentile of the largest
  // channel difference. The second draw may continue the first one's drift (drift: 'continue').
  const stats = (a, b) => page.evaluate(([a, b]) => {
    window.preview.draw(a); const pa = window.preview.pixels().slice();
    window.preview.draw(b); const pb = window.preview.pixels();
    const d = new Uint8Array(pa.length / 4);
    for (let i = 0; i < pa.length; i += 4)
      d[i / 4] = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
    const sorted = Array.from(d).sort((x, y) => x - y);
    return { max: sorted[sorted.length - 1], p99: sorted[Math.floor(0.99 * (sorted.length - 1))] };
  }, [a, b]);

  // R1: the drift is integrated in Python (presets.py phase(), mirrored in preview.js). One frame of a
  // 100-frame A/B morph, and a small Speed drag, must change the image no more after an hour than after
  // 3 s. With Speed x absolute time, Morph moving Speed by 0.0005 in one frame threw the layout by
  // 0.0005 x 3600 s of drift.
  const frame = (a, b) => stats({ ring: false, ...a }, { ring: false, ...b, drift: 'continue' });
  const morphFrame = (T) => frame(
    { preset: 'prism_clear', time: T, overrides: { Morphtarget: 'lavender_gel', Morph: 0.5 } },
    { preset: 'prism_clear', time: T + 1 / 60, overrides: { Morphtarget: 'lavender_gel', Morph: 0.51 } });
  const morph = { t3: await morphFrame(3), t3600: await morphFrame(3600) };
  check('morph_frame_is_smooth_after_an_hour', morph.t3600.max <= morph.t3.max + 12 && morph.t3600.p99 <= morph.t3.p99 + 3, morph,
    'One frame of a 100-frame A/B morph (Morph 0.50 to 0.51 in 1/60 s, Prism Clear to Lavender Gel) changes the image no more after an hour than after 3 s: the blob drift, ripple and film phases are added up frame by frame, so a changing Speed never throws the layout.');
  const sapphire = (T, speed) => ({ preset: 'sapphire_drops', time: T, overrides: { Speed: speed } });
  const steady = await frame(sapphire(3600, 0.35), sapphire(3600 + 1 / 60, 0.35));
  const nudged = await frame(sapphire(3600, 0.35), sapphire(3600 + 1 / 60, 0.36));
  check('speed_change_is_smooth_after_an_hour', nudged.max <= Math.max(steady.max, 2) + 4 && nudged.p99 <= steady.p99 + 2, { steady, nudged },
    'After an hour, nudging Speed from 0.35 to 0.36 changes one frame of Sapphire Drops (droplets and ripples on) about as much as one frame of motion at a fixed speed does.');

  // R1: each phase wraps where the shader's motion repeats, so the wrap is invisible: drift phases
  // p and p + period draw the same image (layout 256 pi, ripple 20 pi, film 256).
  // The shape is judged on the normal stage; the final image is compared with one frame of motion,
  // because through a thick lens float rounding of the phase (about 6e-5 near 256 pi) moves a few
  // refracted pixels.
  const wraps = {};
  const look = { Iridescence: 1, Ripple: 0.6 };
  const base = { layout: 1.05, ripple: 2.25, film: 0.0922 };
  const oneFrame = { layout: 1.05 + 0.35 / 60, ripple: 2.25 + 0.75 / 60, film: 0.0922 + 0.03075 / 60 };
  for (const [name, period] of [['layout', 256 * Math.PI], ['ripple', 20 * Math.PI], ['film', 256]]) {
    const shifted = { ...base, [name]: base[name] + period };
    wraps[name] = {
      normalStage: await diff({ preset: 'sapphire_drops', time: 3, ring: false, phase: base, overrides: { ...look, Stage: 'normal' } },
                              { preset: 'sapphire_drops', time: 3, ring: false, phase: shifted, overrides: { ...look, Stage: 'normal' } }),
      filmStage: await diff({ preset: 'sapphire_drops', time: 3, ring: false, phase: base, overrides: { ...look, Stage: 'film' } },
                            { preset: 'sapphire_drops', time: 3, ring: false, phase: shifted, overrides: { ...look, Stage: 'film' } }),
      finalImage: await stats({ preset: 'sapphire_drops', time: 3, ring: false, phase: base, overrides: look },
                              { preset: 'sapphire_drops', time: 3, ring: false, phase: shifted, overrides: look }),
    };
  }
  wraps.oneFrameOfMotion = await stats({ preset: 'sapphire_drops', time: 3, ring: false, phase: base, overrides: look },
                                       { preset: 'sapphire_drops', time: 3, ring: false, phase: oneFrame, overrides: look });
  check('drift_wraps_without_a_jump', ['layout', 'ripple', 'film'].every((k) => wraps[k].normalStage.pixelsOver2 <= 5 && wraps[k].filmStage.pixelsOver2 <= 5
      && wraps[k].finalImage.p99 <= wraps.oneFrameOfMotion.p99 && wraps[k].finalImage.max <= wraps.oneFrameOfMotion.max), wraps,
    'Shifting a drift phase by its wrap period leaves the shape and the film unchanged (normal and film stages: at most 5 outline pixels over 2/255, where float rounding of the phase moves an edge), and changes the final image less than one frame of motion does: the layout\'s wave speeds are whole multiples of 1/128 (so 256 pi of phase is whole turns), the ripple turns whole after 20 pi, and the film noise repeats every 256 units.');

  // R5: a grazing hit near the silhouette keeps a normal that faces the camera (faceCamera), instead of
  // a flipped one that refracts out of the glass. Through a sphere, every chord at IOR n is at least the
  // grazing chord 2R sqrt(1 - 1/n^2).
  const rim = await page.evaluate(() => {
    const { W, H } = window.TH, P = window.preview, out = {};
    for (const ior of [1.55, 1.2]) {
      P.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1],
        overrides: { Count: 1, Spread: 0, Droplets: 0, Stretch: 0, Ripple: 0, Radius: 0.6, Ior: ior, Stage: 'thickness' } });
      const f = P.floats(), grazing = 2 * 0.6 * Math.sqrt(1 - 1 / (ior * ior));
      let n = 0, below = 0, min = 9;
      for (let i = 0; i < W * H; i++) { if (f[4 * i] < 0) continue; n++; const c = 2 * f[4 * i]; min = Math.min(min, c); if (c < 0.8 * grazing) below++; }
      out['ior_' + ior] = { hits: n, grazingChord: +grazing.toFixed(4), shortestChord: +min.toFixed(4), pixelsBelow80pc: below };
    }
    return out;
  });
  check('rim_chords_stay_physical', Object.values(rim).every((r) => r.hits > 30000 && r.pixelsBelow80pc === 0), rim,
    'At the silhouette of a sphere, the measured path is never shorter than 80 % of the grazing chord 2R sqrt(1 - 1/IOR^2): rim normals are laid into the view plane, not flipped (a flipped normal bent the ray straight back out, a path near 0).');

  // R6: frost samples on the R2 disc average near its centre, so frost blurs without shifting the view.
  // UV ramp, IOR 1, no dispersion: the mean sampled position over the glass, minus the pixel's own position.
  const frostShift = (samples) => page.evaluate(([samples, SINGLE]) => {
    const { W, H } = window.TH, P = window.preview;
    const frosted = (frost) => { P.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1], backdrop: 'uv',
      overrides: { ...SINGLE, Radius: 0.6, Ior: 1, Dispersion: 0, Frost: frost, Samples: samples, Stage: 'refraction', Objectsize: 1 } }); return P.floats().slice(); };
    const a = frosted(0), b = frosted(1);
    let n = 0, du = 0, dv = 0;
    for (let y = H / 2 - 60; y < H / 2 + 60; y++) for (let x = W / 2 - 60; x < W / 2 + 60; x++) {
      const i = 4 * (y * W + x); if (a[i] < 0 || b[i] < 0) continue;
      n++; du += (b[i] - a[i]) * W; dv += (b[i + 1] - a[i + 1]) * H;
    }
    return { samples, pixels: n, meanShiftPixels: +Math.hypot(du / n, dv / n).toFixed(3) };
  }, [samples, SINGLE]);
  const shift = [await frostShift(12), await frostShift(24)];
  check('frost_does_not_shift_the_view', shift.every((r) => r.pixels > 5000) && shift[0].meanShiftPixels < 5 && shift[1].meanShiftPixels < 1, shift,
    'At Frost 1 (a disc of about 0.25 scene units, some 55 pixels in radius here), the frosted view stays centred on the unfrosted one: the mean shift is under 5 pixels at 12 samples and under 1 pixel at 24 (R2 disc points; the golden-angle spiral used before put every point on one arm and shifted the view by 10 to 12 pixels).');
  const frostConvergence = await page.evaluate(() => {
    const P = window.preview;
    const read = (samples) => { P.draw({ preset: 'frosted_milk', time: 3, ring: false, overrides: { Stage: 'refraction', Samples: samples } }); return P.pixels().slice(); };
    const ref = read(32), img = read(12), d = [];
    for (let i = 0; i < ref.length; i += 4) {
      const e = Math.max(Math.abs(img[i] - ref[i]), Math.abs(img[i + 1] - ref[i + 1]), Math.abs(img[i + 2] - ref[i + 2]));
      if (e > 0) d.push(e);
    }
    d.sort((a, b) => a - b);
    return { pixelsThatDiffer: d.length, mean: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2), p99: d[Math.floor(0.99 * (d.length - 1))], max: d[d.length - 1] };
  });
  check('frost_converges_with_samples', frostConvergence.mean <= 4.5 && frostConvergence.p99 <= 18, frostConvergence,
    'Frosted Milk\'s view through the glass at the default 12 samples is within a mean 4.5/255 (99th percentile 18/255) of the same view at 32 samples, over the pixels that differ. (The core\'s max <= 16 does not hold here: the frost passes through a thick lens, and a few pixels differ by up to 38/255 with either disc.)');

  // C3 (from this study): each spectrum sample reads a mipmap level as wide as the screen gap between
  // neighbouring colours (fanGap). At the default 12 samples the rainbow must already be close to a
  // 64-sample reference, and closer at 24. Errors are measured, B7 style, on the pixels where the
  // rainbow differs from the dispersion-free view.
  const dispersion = await page.evaluate(() => {
    const P = window.preview, out = {};
    const read = (preset, samples, disp) => { P.draw({ preset, time: 3, ring: false,
      overrides: { Stage: 'refraction', Samples: samples, Dispersion: disp, Frost: 0 } }); return P.pixels().slice(); };
    for (const preset of ['prism_clear', 'type_lens']) {
      const ref = read(preset, 64, 1), plain = read(preset, 64, 0), row = {};
      for (const samples of [12, 24]) {
        const img = read(preset, samples, 1);
        let n = 0, sum = 0, over = 0;
        for (let i = 0; i < ref.length; i += 4) {
          const changed = Math.max(Math.abs(ref[i] - plain[i]), Math.abs(ref[i + 1] - plain[i + 1]), Math.abs(ref[i + 2] - plain[i + 2])) > 2;
          if (!changed) continue;
          const e = Math.max(Math.abs(img[i] - ref[i]), Math.abs(img[i + 1] - ref[i + 1]), Math.abs(img[i + 2] - ref[i + 2]));
          n++; sum += e; if (e > 32) over++;
        }
        row['samples_' + samples] = { rainbowPixels: n, meanError: +(sum / n).toFixed(2), over32: over };
      }
      out[preset] = row;
    }
    return out;
  });
  check('dispersion_converges_with_samples', Object.values(dispersion).every((r) => r.samples_12.rainbowPixels > 5000
      && r.samples_12.meanError < 8 && r.samples_24.meanError <= r.samples_12.meanError && r.samples_24.over32 <= r.samples_12.over32), dispersion,
    'With Dispersion 1, the rainbow at the default 12 samples is within a mean 8/255 of a 64-sample reference on every pixel the rainbow changes (Prism Clear and Type Lens, refraction stage), and 24 samples come closer still. decisions.json records the same measurement without the fan-gap level.');

  // R8: Colour parameters = sRGB converts glass, light, rim and reflection colours from sRGB to linear.
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const colours = { Glasscolorr: 0.8, Glasscolorg: 0.5, Glasscolorb: 1.0, Rimcolorr: 0.62, Rimcolorg: 0.45, Rimcolorb: 1.0,
                    Reflectcolorr: 0.75, Reflectcolorg: 0.8, Reflectcolorb: 1.0, Lightcolorr: 1.0, Lightcolorg: 0.9, Lightcolorb: 0.7 };
  const linear = Object.fromEntries(Object.entries(colours).map(([k, v]) => [k, toLinear(v)]));
  d = await diff({ preset: 'lavender_gel', time: 3, overrides: { ...colours, Colourspace: 'srgb', Diffuse: 0.3 } },
                 { preset: 'lavender_gel', time: 3, overrides: { ...linear, Colourspace: 'raw', Diffuse: 0.3 } });
  const differs = await diff({ preset: 'lavender_gel', time: 3, overrides: { ...colours, Colourspace: 'srgb', Diffuse: 0.3 } },
                             { preset: 'lavender_gel', time: 3, overrides: { ...colours, Colourspace: 'raw', Diffuse: 0.3 } });
  check('srgb_colour_mode_decodes_colours', d.max <= 1 && differs.max > 20, { srgbVersusLinearTyped: d, srgbVersusAsTyped: differs },
    'With Colour parameters = sRGB, colours typed in sRGB render exactly like their linear values typed with As typed (within 1/255), and differ clearly from the same numbers as typed.');

  // R8: Energy conserving with Mirror 1 turns the glass into a pure mirror: the final image equals the
  // reflection plus highlights stage on every pixel that is fully covered (the edge smoothing only runs
  // in the final image, so the outline is skipped).
  const mirror = await page.evaluate(() => {
    const { W, H } = window.TH, P = window.preview;
    const noGlow = { Rim: 0, Specular: 0, Diffuse: 0, Iridescence: 0, Ripple: 0 };
    const o = (stage, conserve) => ({ preset: 'type_lens', time: 3, ring: false, float: true, clear: [0, 0, 0, 0],
      overrides: { ...noGlow, Mirror: 1, Conserve: conserve, Stage: stage } });
    P.draw(o('final', true)); const fin = P.floats().slice();
    P.draw(o('reflection', true)); const refl = P.floats().slice();
    P.draw(o('final', false)); const plain = P.floats().slice();
    let n = 0, worst = 0, plainWorst = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = 4 * (y * W + x);
      if (![i, i - 4, i + 4, i - 4 * W, i + 4 * W].every((j) => fin[j + 3] >= 0.999)) continue;
      n++;
      for (let k = 0; k < 3; k++) { worst = Math.max(worst, Math.abs(fin[i + k] - refl[i + k])); plainWorst = Math.max(plainWorst, Math.abs(plain[i + k] - refl[i + k])); }
    }
    return { pixels: n, conservingVersusReflection: +(worst * 255).toFixed(2), withoutConservingVersusReflection: +(plainWorst * 255).toFixed(1) };
  });
  check('energy_conserving_mirror_is_pure_reflection', mirror.pixels > 20000 && mirror.conservingVersusReflection <= 1 && mirror.withoutConservingVersusReflection > 50, mirror,
    'Energy conserving on, Mirror 1, no highlights: the glass shows only its reflection (within 1/255 of the reflection stage); with it off, the see-through image still adds on top (Heckel\'s additive default).');

  // C5: colour is capped at 1024 before TDOutputSwizzle, so a 16-bit float Render TOP never overflows.
  const cap = await page.evaluate(() => {
    const { W, H } = window.TH, P = window.preview;
    P.draw({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [0, 0, 0, 0],
      overrides: { Rim: 3, Rimcolorr: 1e6, Rimcolorg: 1e6, Rimcolorb: 1e6, Stage: 'final' } });
    const f = P.floats(); let max = 0, alphaMax = 0;
    for (let i = 0; i < W * H; i++) { max = Math.max(max, f[4 * i], f[4 * i + 1], f[4 * i + 2]); alphaMax = Math.max(alphaMax, f[4 * i + 3]); }
    return { largestColour: max, largestAlpha: alphaMax };
  });
  check('colour_is_capped_for_half_float', cap.largestColour <= 1024 && cap.largestColour > 512 && cap.largestAlpha <= 1, cap,
    'A huge rim colour (1,000,000) reaches the output as at most 1024 (half float tops out at 65,504); alpha is never touched.');

  // C6: screen orientation is measured per pixel. Emulate a build whose raster runs screen y the other
  // way (the scene behind comes from the same build, so it is upside down too): every lookup and the
  // whole default image must be the mirror of the normal render.
  const orientation = await page.evaluate(([SINGLE]) => {
    const { W, H } = window.TH, P = window.preview;
    const lens = { preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1], backdrop: 'uv',
      overrides: { ...SINGLE, Radius: 0.6, Ior: 1.5, Dispersion: 0, Frost: 0, Stage: 'refraction' }, blobs: { translate: [0.3, 0.25, 0] } };
    P.draw(lens); const a = P.floats().slice();
    P.draw({ ...lens, flipRaster: true }); const b = P.floats().slice();
    P.draw({ ...lens, mirrorInputs: true, overrides: { ...lens.overrides, Flipv: true } }); const c = P.floats().slice();
    let n = 0, worstFlip = 0, worstFlipV = 0, bent = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = 4 * (y * W + x), j = 4 * ((H - 1 - y) * W + x);
      if (a[i] < 0) continue;
      n++;
      if (Math.hypot((a[i] - (x + 0.5) / W) * W, (a[i + 1] - (y + 0.5) / H) * H) > 5) bent++;
      worstFlip = Math.max(worstFlip, Math.hypot((a[i] - b[j]) * W, (a[i + 1] - b[j + 1]) * H));
      worstFlipV = Math.max(worstFlipV, Math.hypot((a[i] - c[i]) * W, (a[i + 1] - c[i + 1]) * H));
    }
    const look = { preset: 'prism_clear', time: 3 };
    P.draw(look); const pa = P.pixels().slice();
    P.draw({ ...look, flipRaster: true }); const pb = P.pixels();
    let over8 = 0, maxd = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = 4 * (y * W + x), j = 4 * ((H - 1 - y) * W + x);
      const e = Math.max(Math.abs(pa[i] - pb[j]), Math.abs(pa[i + 1] - pb[j + 1]), Math.abs(pa[i + 2] - pb[j + 2]));
      maxd = Math.max(maxd, e); if (e > 8) over8++;
    }
    return { lens: { pixels: n, bentMoreThan5px: bent, flippedRasterWorstPx: +worstFlip.toFixed(3), upsideDownInputWithFlipVWorstPx: +worstFlipV.toFixed(3) },
             defaultImageFlippedRaster: { max: maxd, pixelsOver8: over8 } };
  }, [SINGLE]);
  check('bends_follow_screen_orientation', orientation.lens.pixels > 20000 && orientation.lens.bentMoreThan5px > 10000
      && orientation.lens.flippedRasterWorstPx <= 0.5 && orientation.defaultImageFlippedRaster.pixelsOver8 <= 50, orientation,
    'A build whose raster runs screen y the other way (emulated) bends light the same way: every lookup through an off-centre sphere lands on the mirror of its normal position within 0.5 pixel, and the default Prism Clear image is its mirror (at most 50 pixels differ by more than 8/255).');
  check('flip_v_corrects_upside_down_inputs', orientation.lens.upsideDownInputWithFlipVWorstPx <= 0.5, orientation.lens,
    'If the Refraction TOP arrives upside down, Flip V restores every lookup within 0.5 pixel: it flips the screen UV and the measured vertical direction of the bends together.');

  // C6: the measured orientation itself, pixel by pixel (from the liquid-glass-prism study). An
  // instrumented copy writes gScreenSign; it must read +1, +1 on every blob pixel in the normal raster
  // and +1, -1 in a flipped one. Twelve presets in the default view (the demo ring's own pixels are
  // skipped), with the camera inside the box, and (family close G2) twelve poses of one blob cut by the box
  // walls, so glass reaches the box's outline; at 480 x 270 and at the odd size 481 x 271, where one pixel
  // row and column sit exactly on the centre lines (projected and raster position both 0). Two readouts,
  // as in the family's test: the glass alone in a float target (one sample per pixel), and a 4x
  // multisampled 8-bit target like an antialiased Render TOP (ring off, transparent background; red and
  // green against blue give the sign whatever share of the pixel the box covers).
  const signRows = {};
  for (const size of [[480, 270], [481, 271]]) {
    const pg = await browser.newPage();
    pg.setDefaultTimeout(600000);
    pg.on('pageerror', (e) => errors.push(String(e)));
    await pg.addInitScript((p) => { window.previewPatch = p; },
      [['    writeOutput(vec4(colour, alpha));', '    writeOutput(vec4(gScreenSign * 0.25 + 0.5, 0.5, 1.0));']]);
    await pg.goto(`http://127.0.0.1:${port}/checks/preview/index.html?harness=1&w=${size[0]}&h=${size[1]}`);
    await pg.evaluate(() => window.previewReady);
    for (const scene of ['default_view', 'camera_inside_box', 'box_cut_poses']) for (const flip of [false, true]) {
      signRows[`${scene}${flip ? '_flipped_raster' : ''}_${size[0]}x${size[1]}`] = await pg.evaluate(([scene, flip]) => {
        const [W, H] = window.preview.size;
        const onCentre = (p) => 2 * (p % W) === W - 1 || 2 * Math.floor(p / W) === H - 1;
        let glass = 0, wrong = 0, centre = 0;
        const multi = { glass_pixels: 0, partly_covered_pixels: 0, wrong_sign_pixels: 0 };
        window.preview.presets.order.forEach((preset, k) => {
          let o = { preset, time: 3, flipRaster: flip };
          if (scene === 'camera_inside_box') o = { ...o, ring: false, cameraZ: 0.5, blobs: { translate: [0.9, 0, -0.4] } };
          if (scene === 'box_cut_poses') o = { ...o, preset: 'prism_clear', ring: false, blobs: { rotate: [20 + 5 * k, 13.7 * k, 7 * k] },
            overrides: { Count: 1, Spread: 0, Droplets: 0, Ripple: 0, Radius: 0.9, Stretch: 0.8 } };
          window.preview.draw({ ...o, float: true, clear: [0, 0, 0, 0] });
          const f = window.preview.floats(); const ey = flip ? 0.25 : 0.75;
          for (let i = 0; i < f.length; i += 4) {
            if (f[i + 3] === 0 || f[i + 2] !== 0.5) continue;  // background, or the demo ring
            glass++;
            if (f[i] !== 0.75 || f[i + 1] !== ey) { wrong++; if (onCentre(i / 4)) centre++; }
          }
          window.preview.draw({ ...o, ring: false, multisample: true, clear: [0, 0, 0, 0] });
          const px = window.preview.msPixels();
          for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] === 0) continue;
            multi.glass_pixels++; if (px[i + 3] < 250) multi.partly_covered_pixels++;
            if (!(px[i] > px[i + 2]) || (px[i + 1] > px[i + 2]) === flip) multi.wrong_sign_pixels++;
          }
        });
        return { size: [W, H], renders: window.preview.presets.order.length, blob_pixels: glass,
                 wrong_sign_pixels: wrong, of_them_on_a_centre_line: centre, multisampled: multi };
      }, [scene, flip]);
    }
    await pg.close();
  }
  check('screen_orientation_has_no_wrong_pixels', Object.values(signRows).every((r) => r.blob_pixels > 100000 && r.wrong_sign_pixels === 0
      && r.multisampled.glass_pixels > 100000 && r.multisampled.wrong_sign_pixels <= 20), signRows,
    'The measured screen orientation is right on every blob pixel of the twelve presets, in the default view and with the camera inside the box, and of twelve poses of a blob cut by the box walls, in a normal and a flipped raster, at 480 x 270 and at the odd size 481 x 271: one sample per pixel, 0 wrong. Four samples per pixel (like an antialiased Render TOP): at most 20 wrong per row of twelve renders, the family\'s threshold (Liquid Glass Lit and the core study), measured 0 here: the blobs\' own silhouette is computed per pixel inside the box faces, so only glass at the box\'s outline is partly covered (318 to 446 pixels per row in the cut poses). screenSign() compares the pixel\'s projected position with its raster position and only on a centre line of an odd-sized render takes the sign of the screen derivatives; the core study took the same tie-break in the family close (G2). The comparison alone, with +1 on ties, is wrong on the whole centre row at 481 x 271 in a flipped raster (1,494 default-view and 1,242 inside-the-box pixels).');

  // C8: Object size scales Tint density, Backdrop distance and Frost. Blobs three times bigger, seen from
  // three times further away, with the Object size Fit sets (3 x the demo box's 1 / 1.45), must look like
  // the original; left at the default (the unscaled box's fit) they do not (the tint deepens, the lens flips
  // less, the frost shrinks).
  const objectSize = {};
  const demoSize = await page.evaluate(() => window.preview.study.controls.find((c) => c.name === 'Objectsize').default);
  for (const preset of ['sapphire_drops', 'frosted_milk']) for (const [name, size] of [['fit', 3 * demoSize], ['default', demoSize]])
    objectSize[`${preset}_object_size_${name}`] = await diff({ preset, time: 3, ring: false },
      { preset, time: 3, ring: false, cameraZ: 15, far: 300, blobs: { scale: [3, 3, 3] }, overrides: { Objectsize: size } });
  check('object_size_carries_presets', ['sapphire_drops', 'frosted_milk'].every((k) => objectSize[`${k}_object_size_fit`].pixelsOver2 <= 50
      && objectSize[`${k}_object_size_default`].pixelsOver2 > 20000), objectSize,
    'Sapphire Drops and Frosted Milk on blobs scaled 3x and seen from 3x the distance, with the Object size Fit sets there (3 x the demo box\'s 1 / 1.45), match the original render on all but at most 50 pixels (over 2/255, where float rounding moves a refracted edge); left at the default Object size the same scene differs on more than 20,000 pixels.');

  // Family close G1: Object size has one meaning across the family (Liquid Glass Lit decisions.json,
  // family_rule). Ported from Liquid Glass Lit: blobs_geo scaled 0.1 and 10 by its Geometry COMP, with the
  // Object size Fit sets (the scale x the demo box's fit) and the camera, near and far plane moved with it,
  // against the unscaled demo: the ripples (normal stage), the film bands (film stage) and the final image.
  const comp = {};
  for (const [preset, stage] of [['aqua_jelly', 'normal'], ['oil_slick', 'film'], ['aqua_jelly', 'final'], ['oil_slick', 'final'],
                                 ['sapphire_drops', 'final'], ['frosted_milk', 'final']]) {
    const base = { preset, time: 3, ring: false, overrides: { Stage: stage } };
    comp[`${preset}_${stage}`] = {};
    for (const s of [0.1, 10])
      comp[`${preset}_${stage}`][`comp_scale_${s}`] = await diff(base, { ...base, cameraZ: 5 * s, near: 0.1 * s, far: 100 * s,
        blobs: { scale: [s, s, s] }, overrides: { Stage: stage, Objectsize: s * demoSize } });
  }
  check('fit_size_carries_presets_over_comp_scale', Object.values(comp).every((r) => Object.values(r).every((x) => x.pixelsOver2 <= 50)), comp,
    'A preset looks the same on blobs_geo scaled 0.1 or 10 by its Geometry COMP, with the Object size Fit sets (the scale x 1 / 1.45) and the camera moved with it: the ripples (normal stage), the film bands (film stage) and the final image, at most 50 pixels over 2/255. Ported from Liquid Glass Lit; the c94e849 blobs passed it too (Object size = scale then), because the box route keeps the shape and the film in box units.');

  // Family close G1: what a hand-set Object size does. The film is a colour pattern: its lookup is
  // multiplied by worldScale() and its frequency divided by Object size, so blobs_geo scaled k by its COMP
  // but left at the default Object size shows k times as many film bands (finer for k > 1, coarser for
  // k < 1), as in the core and Lit. The ripple moves the surface, so it is shape and stays in box units:
  // the same count at any COMP scale and Object size. Pattern detail = sign changes of the pattern's effect
  // along pixel rows (film: film stage minus Film variation 0; ripples: normal stage with Ripple 0.6 minus
  // Ripple 0; red channel, float readback), per 1000 adjacent glass pixels. Ported from the core study.
  const detail = {};
  for (const [pattern, preset, stage, on, off] of [['film', 'oil_slick', 'film', {}, { Filmvariation: 0 }],
                                                   ['ripples', 'aqua_jelly', 'normal', { Ripple: 0.6 }, { Ripple: 0 }]]) {
    const row = {};
    for (const [name, cam, size] of [['unscaled', {}, demoSize], ['comp_10_default_size', { s: 10 }, demoSize],
                                     ['comp_0_1_default_size', { s: 0.1 }, demoSize], ['comp_10_fit_size', { s: 10 }, 10 * demoSize]]) {
      const s = cam.s ?? 1;
      row[name] = await page.evaluate(([base, on, off]) => {
        const grab = (extra) => { window.preview.draw({ ...base, overrides: { ...base.overrides, ...extra } }); return window.preview.floats().slice(); };
        const a = grab(on), b = grab(off);
        const [W, H] = window.preview.size;
        let changes = 0, pairs = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x + 1 < W; x++) {
          const i = (y * W + x) * 4, j = i + 4;
          if (a[i + 3] < 0 || a[j + 3] < 0) continue;
          pairs++;
          if ((a[i] - b[i] > 0) !== (a[j] - b[j] > 0)) changes++;
        }
        return { glass_pairs: pairs, per_1000: +(1000 * changes / pairs).toFixed(2) };
      }, [{ preset, time: 3, ring: false, float: true, clear: [-1, -1, -1, -1], cameraZ: 5 * s, near: 0.1 * s, far: 100 * s,
            blobs: { scale: [s, s, s] }, overrides: { Stage: stage, Objectsize: size } }, on, off]);
    }
    const ratio = (k) => +(row[k].per_1000 / row.unscaled.per_1000).toFixed(3);
    for (const k of ['comp_10_default_size', 'comp_0_1_default_size', 'comp_10_fit_size']) row[`ratio_${k}`] = ratio(k);
    detail[pattern] = row;
  }
  check('comp_scale_at_default_object_size_gives_k_times_the_film_bands',
    detail.film.unscaled.glass_pairs > 30000 && detail.film.ratio_comp_10_default_size >= 4 && detail.film.ratio_comp_0_1_default_size <= 0.4
      && Math.abs(detail.film.ratio_comp_10_fit_size - 1) <= 0.02
      && ['comp_10_default_size', 'comp_0_1_default_size', 'comp_10_fit_size'].every((k) => Math.abs(detail.ripples[`ratio_${k}`] - 1) <= 0.02),
    detail,
    'blobs_geo scaled k by its Geometry COMP but left at the default Object size shows k times as many film bands: at least 4 times the unscaled count for k = 10, at most 0.4 times for k = 0.1; with the Object size Fit sets (10 x 1 / 1.45) the count is the unscaled one within 2%. The ripples, part of the shape, keep the unscaled count within 2% in all three cases. Oil Slick film stage and Aqua Jelly normal stage, camera moved with the scale. On c94e849 the film stayed in box units (ratio 1 everywhere).');

  // V2 (verifier): directions moved between the box's space and world space change length with the
  // object's scale (a transformed normal is 1 / scale long). Blobs_geo at scale 0.001 and 20,000, with
  // camera distance, near and far plane and Object size scaled the same, must give the normal stage and
  // the refraction stage of scale 1. The refraction stage uses the hit normal, the direction inside the
  // glass, the measured chord and the exit normal. (The thickness stage itself shows chord x 0.5 in scene
  // units, which the 1024 output cap clips on a 20,000-unit object.)
  // Close verify CV3: Object size is the one Fit sets (s x the demo box's 1 / 1.45), as in the other
  // scale tests, so the scale-1 reference is the demo's own scene; with Object size = s it ran with a
  // Backdrop distance 1.45 times the demo's. The reference is checked against the demo's render.
  const scaled = await page.evaluate(([SINGLE, demoSize]) => {
    const { W, H } = window.TH, P = window.preview, out = {};
    const scene = (s, stage, size) => ({ preset: 'prism_clear', time: 3, ring: false, float: true, clear: [-1, -1, -1, -1], backdrop: 'uv',
      cameraZ: 5 * s, near: 0.1 * s, far: 100 * s, blobs: { scale: [s, s, s] }, overrides: { ...SINGLE, ...size, Stage: stage } });
    const read = (s, stage) => { P.draw(scene(s, stage, { Objectsize: s * demoSize })); return P.floats().slice(); };
    for (const stage of ['normal', 'refraction']) {
      const ref = read(1, stage);
      P.draw(scene(1, stage, {}));  // the demo: Object size left at the control's default
      const demo = P.floats();
      let demoWorst = 0;
      for (let i = 0; i < 4 * W * H; i++) demoWorst = Math.max(demoWorst, Math.abs(demo[i] - ref[i]));
      out[`${stage}_scale_1_against_the_demo`] = { worstDifference: +demoWorst.toFixed(6) };
      for (const s of [0.001, 20000]) {
        const f = read(s, stage);
        let pixels = 0, missing = 0, worst = 0, plusY = 0;
        for (let i = 0; i < W * H; i++) {
          if (ref[4 * i] < 0) continue;
          if (f[4 * i] < 0) { missing++; continue; }
          pixels++;
          worst = Math.max(worst, Math.abs(f[4 * i] - ref[4 * i]), Math.abs(f[4 * i + 1] - ref[4 * i + 1]), Math.abs(f[4 * i + 2] - ref[4 * i + 2]));
          if (stage === 'normal' && Math.abs(f[4 * i] - 0.5) < 1e-3 && Math.abs(f[4 * i + 1] - 1) < 1e-3 && Math.abs(f[4 * i + 2] - 0.5) < 1e-3) plusY++;
        }
        out[`${stage}_scale_${s}`] = { pixels, missing, worstDifference: +worst.toFixed(5), ...(stage === 'normal' ? { pixelsReadingPlusY: plusY } : {}) };
      }
    }
    return out;
  }, [SINGLE, demoSize]);
  check('normals_hold_at_any_object_scale', Object.entries(scaled).every(([k, r]) => (k.endsWith('_against_the_demo') ? r.worstDifference <= 1e-6
      : r.pixels > 30000 && r.missing === 0 && r.worstDifference < 1e-3)), scaled,
    'One sphere in blobs_geo scaled to 0.001 and to 20,000 (camera distance, near and far plane scaled the same, and the Object size Fit sets there: the scale x the demo box\'s 1 / 1.45) gives the normal stage and the refraction stage of scale 1 within 0.001 on every pixel: the transformed normals and the direction inside the glass are normalised without a fixed length threshold. The scale-1 reference is the demo\'s own scene: it equals the render at the default Object size within 1e-6 (close verify CV3; with Object size = the scale it ran with a Backdrop distance 1.45 times the demo\'s).');

  await browser.close();
  const report = { ok: results.every((r) => r.ok) && !errors.length, passed: results.filter((r) => r.ok).length,
    total: results.length, errors, results,
    scope: 'Shader maths and study.json bindings in WebGL2 (SwiftShader). Not a TouchDesigner render.' };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
})();
