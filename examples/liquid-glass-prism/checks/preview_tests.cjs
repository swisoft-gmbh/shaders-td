// Property tests of the delivered GLSL, run through the WebGL2 preview.
//
//   node checks/preview_tests.cjs <port>               (serve the study folder on <port> first)
//   node checks/preview_tests.cjs <port> --reference   (run every test against the 6a58487 material
//                                                       in checks/reference/, to see which tests guard
//                                                       the family sync: those must fail there)
//
// Each test states a relationship that must hold whatever the look, for
// example "a parallel-sided slab does not change the direction of light".
// They test the shader maths and the study.json bindings in a browser GPU
// (SwiftShader), not TouchDesigner. Several tests compare against values
// computed here independently (Snell's law, the Fresnel equations, sphere
// chords), not against the shader's own output.
const { chromium } = require('playwright');

// Object size 1: these tests measure optics in scene units (Thickness 2 = the unit sphere's diameter,
// Scene depth in scene units). Since the family close (G1) the default is the demo torus's own
// Object size under the family rule, 0.872517, so they set 1 explicitly.
const QUIET = { Reflection: 0, Rim: 0, Specular: 0, Diffuse: 0, Iridescence: 0, Wobble: 0, Caustic: 0, Objectsize: 1 };
const INVISIBLE = { ...QUIET, Ior: 1.0, Dispersion: 0, Frost: 0, Density: 0, Saturation: 1, Stage: 'final' };
const FLAT = { tilt: 0, spin: 0, scale: [1, 1, 1] };   // test meshes exactly as authored
const DEG = Math.PI / 180;

// Same Cauchy-shaped spectrum as sliceIor() in liquid_prism.frag, written out
// again here so the test does not trust the shader's own version.
function sliceIor(ior, dispersion, w) {
  const nm = 680 + (400 - 680) * w;
  const red = 1 / 680 ** 2, mid = 1 / 530 ** 2, violet = 1 / 400 ** 2;
  return Math.max(ior + 0.3 * dispersion * (1 / nm ** 2 - mid) / (violet - red), 1);
}
// The same slice colour weights as spectrum() in liquid_prism.frag (a documented colour model, not physics).
function spectrum(w) {
  const c = [0.1, 0.45, 0.8].map((centre, k) => Math.min(Math.max(1 - Math.abs(w - centre) * [2.4, 2.8, 2.4][k], 0), 1));
  c[0] += 0.6 * Math.min(Math.max(1 - Math.abs(w - 1) * 5, 0), 1);
  return c.map((x) => x * x * (3 - 2 * x) + 0.02);
}
const MIDDLE_W = 150 / 280;  // 530 nm: the slice that keeps the Ior value
// Small vector helpers for the independent ray traces below.
const v3 = {
  add: (a, b) => a.map((x, i) => x + b[i]), sub: (a, b) => a.map((x, i) => x - b[i]),
  mul: (a, k) => a.map((x) => x * k), dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  norm: (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); },
  rotZ: (a, deg) => { const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180); return [c * a[0] - s * a[1], s * a[0] + c * a[1], a[2]]; },
};
// Snell's law entering glass (GLSL refract) and leaving it (with the Fresnel share), vector form.
function refractIn(d, n, eta) {
  const c = v3.dot(n, d), k = 1 - eta * eta * (1 - c * c);
  return v3.sub(v3.mul(d, eta), v3.mul(n, eta * c + Math.sqrt(k)));
}
function refractOut(d, m, n) {
  const cosI = v3.dot(d, m), sin2T = n * n * (1 - cosI * cosI);
  if (sin2T > 1) return { dir: null, share: 1 };
  const cosT = Math.sqrt(1 - sin2T);
  const rs = (n * cosI - cosT) / (n * cosI + cosT), rp = (cosI - n * cosT) / (cosI + n * cosT);
  return { dir: v3.norm(v3.add(v3.mul(d, n), v3.mul(m, cosT - n * cosI))), share: 0.5 * (rs * rs + rp * rp) };
}

// Fresnel reflectance leaving glass of index n at internal incidence angle a (unpolarised).
function internalReflectance(n, a) {
  const cosI = Math.cos(a), sinT = n * Math.sin(a);
  if (sinT > 1) return 1;
  const cosT = Math.sqrt(1 - sinT * sinT);
  const rs = (n * cosI - cosT) / (n * cosI + cosT), rp = (cosI - n * cosT) / (cosI + n * cosT);
  return 0.5 * (rs * rs + rp * rp);
}

(async () => {
  const port = process.argv[2];
  const referenceRun = process.argv.includes('--reference');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  // A page of the preview; with --reference every draw uses the 6a58487 shaders and bindings.
  // size: [w, h] for a render size other than 960 x 540.
  const openPage = async (patch, refPatch, size) => {
    const pg = await browser.newPage();
    pg.on('pageerror', (e) => errors.push(String(e)));
    if (patch || refPatch) await pg.addInitScript(([a, b]) => { window.previewPatch = a; window.previewRefPatch = b; }, [patch || [], refPatch || []]);
    await pg.goto(`http://127.0.0.1:${port}/checks/preview/index.html?harness=1${size ? `&w=${size[0]}&h=${size[1]}` : ''}`);
    await pg.evaluate(() => window.previewReady);
    if (referenceRun) await pg.evaluate(() => {
      const draw = window.preview.draw;
      window.preview.draw = (o = {}) => draw({ ...o, reference: true });
    });
    return pg;
  };
  const page = await openPage();
  const [W, H] = await page.evaluate(() => window.preview.size);
  // Object size of the demo torus, the control's default: what Fit to Glass geometry sets on the demo
  // (0.872517 since the family close, G1: its radius over the family's 1.45; 1 before).
  const DEMO_SIZE = await page.evaluate(() => window.preview.study.controls.find((c) => c.name === 'Objectsize').default);
  const cx = Math.floor(W / 2), cy = Math.floor(H / 2);

  // Largest per-channel difference between two renders, and how many pixels differ by more than 2/255.
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

  const pixelsAt = (opts, points) => page.evaluate(([opts, points]) => {
    window.preview.draw(opts); const p = window.preview.pixels(); const [W] = window.preview.size;
    return points.map(([x, y]) => Array.from(p.slice((y * W + x) * 4, (y * W + x) * 4 + 4)));
  }, [opts, points]);

  const probe = (opts) => page.evaluate((opts) => window.preview.draw({ ...opts, probe: true }), opts);

  const grid = (half, step) => {
    const pts = [];
    for (let dy = -half; dy <= half; dy += step) for (let dx = -half; dx <= half; dx += step) pts.push([cx + dx, cy + dy]);
    return pts;
  };

  const results = [];
  const check = (name, ok, evidence, claim) => results.push({ name, ok, claim, evidence });

  // ---------------------------------------------------------------- invisibility at IOR 1
  for (const [mesh, back] of [['torus', false], ['torus', true], ['knot', false], ['knot', true]]) {
    const d = await diff({ preset: 'clear_crystal', time: 2, mesh, scale: [1, 1, 1], overrides: { ...INVISIBLE, Backface: back } },
                         { backdropOnly: true });
    check(`ior1_invisible_${mesh}_${back ? 'backpass' : 'fallback'}`, d.max <= 2, d,
      'With IOR 1 (no bend at either surface), saturation 1 and no dispersion, frost, tint or light terms, the glass shows exactly the refraction TOP' +
      (back ? ', with the back-face pass measuring the exit.' : ', with the analytic exit estimate (no back-face pass).'));
  }
  let d = await diff({ preset: 'clear_crystal', time: 2, mesh: 'torus', ortho: 2.2, overrides: { ...INVISIBLE, Backface: true } },
                     { backdropOnly: true });
  check('ior1_invisible_orthographic', d.max <= 2, d,
    'The same holds for an orthographic camera (eye distance measured along the view axis in both passes).');

  d = await diff({ preset: 'spectral_prism', time: 2, overrides: { Opacity: 0 } }, { backdropOnly: true });
  check('opacity0_is_invisible', d.max <= 2, d, 'Opacity 0 removes the glass entirely, reflections and trapped light included.');

  d = await diff({ preset: 'clear_crystal', time: 2, refraction: false, overrides: INVISIBLE }, { backdropOnly: true });
  check('no_refraction_top_blends_clear', d.max <= 2, d,
    'With no refraction TOP, clear untinted glass with no light terms blends to the real background (alpha 0).');

  // ---------------------------------------------------------------- slab: zero net deviation
  const slab = { preset: 'clear_crystal', time: 2, mesh: 'slab', spin: 35, tilt: 20, scale: [1, 1, 1],
    overrides: { ...QUIET, Stage: 'deviation', Ior: 1.5, Dispersion: 0.6, Backface: true } };
  const slabPts = grid(48, 16);
  const slabPx = await pixelsAt(slab, slabPts);
  const slabMax = Math.max(...slabPx.flatMap((p) => p.slice(0, 3)));
  const slabFallback = await pixelsAt({ ...slab, overrides: { ...slab.overrides, Backface: false, Exittilt: 0, Thickness: 0.4 } }, slabPts);
  const fallbackMax = Math.max(...slabFallback.flatMap((p) => p.slice(0, 3)));
  const slabFlat = await pixelsAt({ ...slab, overrides: { ...slab.overrides, Backface: false, Exittilt: -1 } }, slabPts);
  const flatMax = Math.max(...slabFlat.flatMap((p) => p.slice(0, 3)));
  check('slab_zero_net_deviation', slabMax <= 2 && fallbackMax > 10 && flatMax <= 2,
    { points: slabPts.length, max_deviation_255: slabMax, max_degrees: +(slabMax / 255 * 90).toFixed(2),
      control_ball_estimate_255: fallbackMax, fallback_exit_tilt_minus1_255: flatMax },
    'Through a parallel-sided slab tilted 35 and 20 degrees, light leaves in exactly the direction it entered, for red, middle and violet (deviation stage, within 2/255 of 90 degrees), measured with the back-face pass. Without the pass, Exit tilt -1 (flat far wall) gives the same zero deviation. Control: the ball estimate (Exit tilt 0), which does not know the slab is flat, does deviate, so the test can fail.');

  // ---------------------------------------------------------------- wedge: critical angle
  // 45-degree prism, front face facing the camera: the centre ray enters
  // without bending and meets the far face at 45 degrees inside the glass.
  // Total internal reflection starts at IOR 1 / sin(45) = 1.4142.
  const wedge = (ior, extra = {}) => ({ preset: 'clear_crystal', time: 2, mesh: 'wedge', ...FLAT,
    overrides: { ...QUIET, Stage: 'tir', Ior: ior, Dispersion: 0, Backface: true, ...extra } });
  // Near the critical angle the share changes very fast with angle, so the
  // expected value follows the exact camera ray through the pixel centre
  // (0.03 degrees off normal), refracted at the front face, then measured
  // against the far face's normal.
  const fovW = 45 * DEG, tanW = Math.tan(fovW / 2), aspectW = W / H;
  const pixelRay = (x, y) => {
    const v = [(((x + 0.5) / W) * 2 - 1) * tanW * aspectW, (((y + 0.5) / H) * 2 - 1) * tanW, -1];
    const l = Math.hypot(...v); return v.map((c) => c / l);
  };
  const insideAngle = (ior, v) => {
    // refract(v, +Z, 1 / ior), then the angle to the far face's outward normal (-1, 0, -1) / sqrt 2
    const eta = 1 / ior, d = v[2], k = 1 - eta * eta * (1 - d * d);
    const T = v.map((c, i) => eta * c - (eta * d + Math.sqrt(k)) * (i === 2 ? 1 : 0));
    return Math.acos(-(T[0] + T[2]) * Math.SQRT1_2);
  };
  const iors = [1.30, 1.36, 1.40, 1.41, 1.42, 1.43, 1.50, 1.60];
  const rows = [];
  for (const ior of iors) {
    const [p] = await pixelsAt(wedge(ior), [[cx, cy]]);
    const a = insideAngle(ior, pixelRay(cx, cy));
    rows.push({ ior, critical_ior: 1.4142, inside_angle_deg: +(a / DEG).toFixed(4),
      expected: +(internalReflectance(ior, a) * 255).toFixed(1), measured: p[1] });
  }
  const below = rows.filter((r) => r.ior < 1.414), beyond = rows.filter((r) => r.ior > 1.415);
  const monotonic = rows.every((r, i) => i === 0 || r.measured >= rows[i - 1].measured);
  check('tir_beyond_critical_angle_only',
    below.every((r) => r.measured < 250 && Math.abs(r.measured - r.expected) <= 3) && beyond.every((r) => r.measured === 255) && monotonic,
    { rows, monotonic },
    'At 45 degrees inside a prism, the share of light reflected back inside follows the Fresnel equations below the critical angle (within 3/255, for the exact ray through the pixel) and is total (255) beyond it; it rises monotonically with IOR, so the image never jumps.');

  // Same at an area of the face, with a wider margin around the critical angle.
  const area = grid(24, 12);
  const lowArea = await pixelsAt(wedge(1.30), area), highArea = await pixelsAt(wedge(1.60), area);
  check('tir_area_below_and_beyond',
    lowArea.every((p) => p[1] < 128) && highArea.every((p) => p[1] === 255),
    { points: area.length, max_share_ior_1_30: Math.max(...lowArea.map((p) => p[1])), min_share_ior_1_60: Math.min(...highArea.map((p) => p[1])) },
    'Over a patch of the prism face: no total reflection at IOR 1.30 (critical 50 degrees), total at IOR 1.60 (critical 39 degrees).');

  // ---------------------------------------------------------------- wedge: dispersion order
  const dispersion = 0.3, ior = 1.3;
  const [dev] = await pixelsAt({ ...wedge(ior, { Stage: 'deviation', Dispersion: dispersion }) }, [[cx, cy]]);
  const expectDev = [0, MIDDLE_W, 1].map((w) => {
    const n = sliceIor(ior, dispersion, w);
    return +((Math.asin(n * Math.sin(45 * DEG)) - 45 * DEG) / (90 * DEG) * 255).toFixed(1);
  });
  const devArea = await pixelsAt({ ...wedge(ior, { Stage: 'deviation', Dispersion: dispersion }) }, area);
  check('dispersion_violet_deviates_more',
    dev[2] > dev[1] && dev[1] > dev[0] && dev.slice(0, 3).every((v, i) => Math.abs(v - expectDev[i]) <= 2) &&
    devArea.every((p) => p[2] > p[1] && p[1] > p[0]),
    { centre_measured_rgb: dev.slice(0, 3), centre_expected_rgb: expectDev, area_points: devArea.length,
      degrees: dev.slice(0, 3).map((v) => +(v / 255 * 90).toFixed(1)) },
    'Through the prism, violet leaves at a larger angle than the middle, and the middle larger than red (deviation stage: red, middle, violet in R, G, B). At the centre the angles match Snell\'s law with the Cauchy spectrum within 2/255 of 90 degrees.');

  // ---------------------------------------------------------------- finite everywhere
  const extremes = [
    { Ior: 2.5, Dispersion: 1, Thickness: 3, Exittilt: 1, Innerreflect: 3, Caustic: 3, Causticspread: 0.2, Wobble: 1, Frost: 1 },
    { Ior: 1.0, Dispersion: 1, Thickness: 0, Exittilt: 0, Innerreflect: 0, Caustic: 0, Wobble: 0, Frost: 0 },
    { Ior: 1.7, Dispersion: 0.5, Thickness: 1, Exittilt: 0.5, Scenedepth: 0, Edgetint: 1, Density: 6, Reflectblur: 1, Samples: 1 },
    { Ior: 2.0, Dispersion: 0, Thickness: 0.01, Exittilt: 1, Scenedepth: 5, Samples: 32, Mirror: 1 },
    { Ior: 1.9, Dispersion: 0.8, Thickness: 2, Exittilt: -1, Scenedepth: 3, Innerreflect: 3, Caustic: 1 },
  ];
  const finite = [];
  for (const back of [false, true]) for (const mesh of ['torus', 'wedge', 'slab', 'sphere', 'knot']) for (const [i, ex] of extremes.entries()) {
    for (const stage of ['final', 'refraction', 'exitnormal', 'deviation', 'tir', 'bounce', 'caustic', 'thickness']) {
      const r = await probe({ preset: 'spectral_prism', time: 2, mesh, overrides: { ...ex, Stage: stage, Backface: back } });
      finite.push({ back, mesh, extremes: i, stage, ...r });
    }
  }
  const bad = finite.filter((r) => r.nonFinite > 0 || r.covered === 0);
  const noBack = finite.filter((r) => !r.back);
  check('fallback_without_backpass_stays_finite', noBack.every((r) => r.nonFinite === 0 && r.covered > 0),
    { renders: noBack.length, failing: bad.filter((r) => !r.back).slice(0, 5), max_abs: Math.max(...noBack.map((r) => r.maxAbs)) },
    'Without the back-face pass, every output value is finite (no NaN or infinity) for 5 shapes x 5 extreme settings x 8 stages, read back from a 32-bit float target.');
  const withBack = finite.filter((r) => r.back);
  check('backpass_stays_finite', withBack.every((r) => r.nonFinite === 0 && r.covered > 0),
    { renders: withBack.length, failing: bad.filter((r) => r.back).slice(0, 5), max_abs: Math.max(...withBack.map((r) => r.maxAbs)) },
    'With the back-face pass, the same 200 renders are finite too.');

  // ---------------------------------------------------------------- measured exit on a sphere
  // Unit sphere seen from z = 5. At IOR 1 the measured path must be the view
  // chord; at IOR 1.5 it must be the refracted chord 2 cos(refraction angle).
  const fov = 45 * DEG, t = Math.tan(fov / 2), aspect = W / H;
  const cols = [0, 40, 80, 110, 125].map((dx) => cx + dx);   // 125 pixels is 0.94 of the sphere's screen radius
  const geometry = (x) => {
    const nx = ((x + 0.5) / W) * 2 - 1, ny = ((cy + 0.5) / H) * 2 - 1;
    const dir = [nx * t * aspect, ny * t, -1]; const l = Math.hypot(...dir);
    const v = dir.map((c) => c / l);
    // Entry point: ray from (0, 0, 5) hits the unit sphere.
    const b = 5 * v[2], c = 25 - 1, s = -b - Math.sqrt(b * b - c);
    const p = [v[0] * s, v[1] * s, 5 + v[2] * s];        // also the outward normal
    const cosI = -(v[0] * p[0] + v[1] * p[1] + v[2] * p[2]);
    return { cosI };
  };
  const sphereRows = [];
  for (const ior2 of [1.0, 1.5]) {
    const px = await pixelsAt({ preset: 'clear_crystal', time: 2, mesh: 'sphere', ...FLAT,
      overrides: { ...QUIET, Backface: true, Stage: 'thickness', Thickness: 2.0, Ior: ior2, Dispersion: 0 } }, cols.map((x) => [x, cy]));
    cols.forEach((x, i) => {
      const { cosI } = geometry(x);
      const sinT = Math.sqrt(1 - cosI * cosI) / ior2;
      const chord = 2 * Math.sqrt(1 - sinT * sinT);       // chord of the refracted ray in a unit sphere
      sphereRows.push({ ior: ior2, x, expected: +(Math.min(chord / 4, 1) * 255).toFixed(1), measured: px[i][0], chord: +chord.toFixed(3) });
    });
  }
  check('backpass_path_matches_sphere_chord', sphereRows.every((r) => Math.abs(r.expected - r.measured) <= 3), sphereRows,
    'With the back-face pass, the distance travelled inside a unit sphere equals the exact chord of the view ray (IOR 1) and of the refracted ray (IOR 1.5), within 3/255. This checks the march to the far side.');

  // ---------------------------------------------------------------- the ball estimate is exact on a ball
  const ball = (back) => ({ preset: 'clear_crystal', time: 2, mesh: 'sphere', ...FLAT,
    overrides: { ...QUIET, Stage: 'exitnormal', Thickness: 2.0, Ior: 1.5, Dispersion: 0, Exittilt: 0, Backface: back } });
  // A grid over the middle plus two rings, at 0.9 and 0.97 of the sphere's screen radius (133 pixels),
  // where the exit march starts from almost no view thickness.
  const ballPts = grid(90, 30);
  for (const f of [0.9, 0.97]) for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8; ballPts.push([Math.round(cx + f * 133 * Math.cos(a) - 0.5), Math.round(cy + f * 133 * Math.sin(a) - 0.5)]);
  }
  const est = await pixelsAt(ball(false), ballPts), meas = await pixelsAt(ball(true), ballPts);
  const ballErrs = est.map((p, i) => Math.max(...[0, 1, 2].map((k) => Math.abs(p[k] - meas[i][k]))));
  const ballErr = Math.max(...ballErrs);
  check('fallback_ball_matches_measured_on_sphere', ballErr <= 4, { points: ballPts.length, max_difference_255: ballErr,
    max_difference_middle: Math.max(...ballErrs.slice(0, 49)), max_difference_rings: Math.max(...ballErrs.slice(49)) },
    'On a unit sphere with Thickness 2 and Exit tilt 0, the analytic exit normal (no back-face pass) equals the measured one within 4/255, from the middle out to 0.97 of the sphere\'s screen radius: the fallback is exact for the shape it assumes, and the measured exit holds up near the silhouette.');

  // ---------------------------------------------------------------- unchanged core behaviour
  d = await diff({ preset: 'clear_crystal', time: 2, overrides: { Stage: 'refraction', Dispersion: 0, Frost: 0, Samples: 1 } },
                 { preset: 'clear_crystal', time: 2, overrides: { Stage: 'refraction', Dispersion: 0, Frost: 0, Samples: 16 } });
  check('samples_invariant_without_dispersion', d.max <= 2, d,
    'Without dispersion or frost every slice is identical, so the sample count cannot change the image.');

  d = await diff({ preset: 'spectral_prism', time: 2, overrides: { Morphtarget: 'type_lens', Morph: 1 } }, { preset: 'type_lens', time: 2 });
  check('morph1_equals_target', d.max <= 2, d, 'Morph 1 toward a preset renders that preset.');

  d = await diff({ preset: 'lavender_prism', time: 2, overrides: { Morphtarget: 'diamond_fire', Morph: 0 } }, { preset: 'lavender_prism', time: 2 });
  check('morph0_is_neutral', d.max <= 2, d, 'Morph 0 leaves the current look unchanged.');

  const uvPoint = [cx + 37, cy - 21];
  const [uvPixel] = await pixelsAt({ preset: 'clear_crystal', time: 2, mesh: 'sphere', overrides: { Stage: 'screenuv' } }, [uvPoint]);
  const uvExpected = [(uvPoint[0] + 0.5) / W * 255, (uvPoint[1] + 0.5) / H * 255];
  check('screen_uv_matches_pixel', Math.abs(uvPixel[0] - uvExpected[0]) <= 1.5 && Math.abs(uvPixel[1] - uvExpected[1]) <= 1.5,
    { pixel: uvPoint, measured: uvPixel.slice(0, 2), expected: uvExpected.map((v) => +v.toFixed(1)) },
    'screenUV() gives the pixel position over the render size (preview viewport stand-in).');


  // ================================================================ added after the independent review
  // A float readback helper: draw a probe and return [r, g, b, a] at points (GL rows, bottom up).
  const floatsAt = (opts, points) => page.evaluate(([opts, points]) => {
    window.preview.draw({ ...opts, probe: true }); const f = window.preview.lastProbe(); const [W] = window.preview.size;
    return points.map(([x, y]) => Array.from(f.slice((y * W + x) * 4, (y * W + x) * 4 + 4)));
  }, [opts, points]);
  const camZ = 5, tanHalf = Math.tan(22.5 * DEG), aspectP = W / H;
  const camRay = (x, y) => v3.norm([(((x + 0.5) / W) * 2 - 1) * tanHalf * aspectP, (((y + 0.5) / H) * 2 - 1) * tanHalf, -1]);
  const project = (P) => { const z = camZ - P[2];
    return [0.5 + 0.5 * P[0] / (z * tanHalf * aspectP), 0.5 + 0.5 * P[1] / (z * tanHalf)]; };
  // The 45-degree wedge of preview.js (front face z = 0.5, far face x + z = -0.5), turned by `roll`
  // about the view axis. Traces one wavelength through both faces; returns null if the ray misses.
  const FAR = v3.norm([-1, 0, -1]);
  const traceWedge = (x, y, roll, ior, exitIor = ior) => {
    const d = v3.rotZ(camRay(x, y), -roll), O = [0, 0, camZ];
    const P0 = v3.add(O, v3.mul(d, (0.5 - camZ) / d[2]));
    if (Math.abs(P0[0]) > 0.9 || Math.abs(P0[1]) > 0.7) return null;
    const centre = refractIn(d, [0, 0, 1], 1 / exitIor);          // the traced (530 nm) ray fixes the exit point
    const E = v3.add(P0, v3.mul(centre, (-0.5 - P0[0] - P0[2]) / (centre[0] + centre[2])));
    if (E[2] < -1.4 || E[2] > 0.4 || Math.abs(E[1]) > 0.7) return null;
    const inside = refractIn(d, [0, 0, 1], 1 / ior);
    return { P0, E, inside, out: refractOut(inside, FAR, ior), roll };
  };
  const lookupUV = (t, D, dir = t.out.dir) => project(v3.rotZ(v3.add(t.E, v3.mul(dir, D)), t.roll));
  const OPTICS = { ...QUIET, Frost: 0, Saturation: 1, Density: 0, Innerreflect: 0, Samples: 16 };
  const wedgeAt = (roll, extra) => ({ preset: 'clear_crystal', time: 2, mesh: 'wedge', ...FLAT, roll,
    overrides: { ...OPTICS, Stage: 'refraction', Backface: true, ...extra } });
  const facePoints = (roll) => {
    const pts = [];
    for (let dy = -60; dy <= 60; dy += 30) for (let dx = -60; dx <= 60; dx += 30) {
      const [x, y] = [cx + dx, cy + dy]; if (traceWedge(x, y, roll, 1.3)) pts.push([x, y]);
    }
    return pts;
  };

  // ---------------------------------------------------------------- the image follows Snell's law
  // 'uv' backdrop: the Refraction TOP stores its own screen position (u, v, 1), so a refraction
  // reading tells where the lookup landed: u = R / B, v = G / B (B carries the transmitted share).
  {
    const rows = [];
    for (const roll of [0, 90]) for (const D of [1.0, 2.5]) {
      const pts = facePoints(roll);
      const got = await floatsAt({ ...wedgeAt(roll, { Ior: 1.3, Dispersion: 0, Scenedepth: D }), backdrop: 'uv' }, pts);
      pts.forEach(([x, y], i) => {
        const t = traceWedge(x, y, roll, 1.3); const e = lookupUV(t, D); const g = got[i];
        rows.push({ roll, D, x, y, expected: e.map((v) => +v.toFixed(4)), measured: [g[0] / g[2], g[1] / g[2]].map((v) => +v.toFixed(4)),
          error_px: +Math.hypot((g[0] / g[2] - e[0]) * W, (g[1] / g[2] - e[1]) * H).toFixed(2) });
      });
    }
    const worst = Math.max(...rows.map((r) => r.error_px));
    check('refraction_lookup_follows_snell', worst <= 2.0, { points: rows.length, worst_error_px: worst, rows: rows.slice(0, 6) },
      'In the image itself (Refraction stage over a backdrop that stores its own screen position), light through a 45-degree prism lands where an independent trace predicts: Snell\'s law at the front face, the exit point on the far face, Snell\'s law again, then Scene depth further (1 and 2.5), projected by the camera. Within 2 pixels at 25 points per case, for a horizontal and a vertical bend (prism turned 90 degrees).');
  }
  {
    // Rainbow order and spread in the image: a left-to-right ramp backdrop, Dispersion 0.3, 16 slices.
    const rows = [];
    for (const roll of [0, 90]) {
      const pts = facePoints(roll);
      const got = await floatsAt({ ...wedgeAt(roll, { Ior: 1.3, Dispersion: 0.3, Scenedepth: 2.0 }), backdrop: roll ? 'uv' : 'ramp' }, pts);
      pts.forEach(([x, y], i) => {
        const sum = [0, 0, 0], weights = [0, 0, 0];
        for (let k = 0; k < 16; k++) {
          const w = (k + 0.5) / 16, n = sliceIor(1.3, 0.3, w);
          const t = traceWedge(x, y, roll, n, 1.3);
          const uv = t.out.dir ? lookupUV(t, 2.0) : [0, 0];   // a trapped slice passes nothing (share 1)
          const value = roll ? uv[1] : uv[0];   // ramp: u in every channel; turned prism: v in G only
          const wt = spectrum(w);
          for (let c = 0; c < 3; c++) { sum[c] += (1 - t.out.share) * value * wt[c]; weights[c] += wt[c]; }
        }
        const expected = sum.map((v, c) => v / weights[c]);
        const g = got[i];
        if (roll) rows.push({ roll, x, y, expected_g: +expected[1].toFixed(4), measured_g: +g[1].toFixed(4) });
        else rows.push({ roll, x, y, expected: expected.map((v) => +v.toFixed(4)), measured: g.slice(0, 3).map((v) => +v.toFixed(4)) });
      });
    }
    const errs = rows.flatMap((r) => r.roll ? [Math.abs(r.expected_g - r.measured_g)] : r.expected.map((v, c) => Math.abs(v - r.measured[c])));
    // Points where red and violet land clearly apart: the test is sensitive there, and must agree on the side.
    const split = rows.filter((r) => !r.roll && Math.abs(r.expected[2] - r.expected[0]) > 0.02);
    const order = split.length >= 5 && split.every((r) => Math.sign(r.measured[2] - r.measured[0]) === Math.sign(r.expected[2] - r.expected[0]));
    check('rainbow_in_the_image_follows_snell', Math.max(...errs) <= 0.004 && order,
      { points: rows.length, worst_error: +Math.max(...errs).toFixed(5), clearly_split_points: split.length, violet_side_correct: order, rows: split.slice(0, 4) },
      'In the image, each colour channel through the prism equals the independently traced 16-slice spectrum: every slice bent at both faces with its Cauchy IOR, weighted by the transmitted share and the documented slice colours. Within 0.004 (about 4 pixels of ramp); violet lands on the side Snell\'s law predicts.');
  }
  {
    // Trapped light leaves nothing behind; below the critical angle, exactly (1 - Fresnel) passes.
    const pts = facePoints(0).slice(0, 9);
    const high = await floatsAt({ ...wedgeAt(0, { Ior: 1.6, Dispersion: 0 }), backdrop: 'uv' }, pts);
    const low = await floatsAt({ ...wedgeAt(0, { Ior: 1.3, Dispersion: 0 }), backdrop: 'uv' }, pts);
    const lowRows = pts.map(([x, y], i) => ({ x, y, expected: +(1 - traceWedge(x, y, 0, 1.3).out.share).toFixed(4), measured: +low[i][2].toFixed(4) }));
    check('trapped_light_is_not_transmitted', high.every((g) => Math.max(g[0], g[1], g[2]) <= 0.002) && lowRows.every((r) => Math.abs(r.expected - r.measured) <= 0.01),
      { ior_1_6_max: Math.max(...high.flatMap((g) => g.slice(0, 3))), ior_1_3: lowRows },
      'In the image (Refraction stage, Inner reflection 0): past the critical angle (IOR 1.6 in the 45-degree prism) nothing of the scene behind gets through; below it (IOR 1.3) exactly 1 - Fresnel of it does, within 0.01.');
    const bHigh = await floatsAt({ ...wedgeAt(0, { Ior: 1.6, Dispersion: 0, Innerreflect: 1, Stage: 'bounce' }), backdrop: 'uv' }, pts);
    const bLow = await floatsAt({ ...wedgeAt(0, { Ior: 1.3, Dispersion: 0, Innerreflect: 1, Stage: 'bounce' }), backdrop: 'uv' }, pts);
    const mean = (a) => a.reduce((s, g) => s + g[2], 0) / a.length;
    check('trapped_light_returns_as_bounce', mean(bHigh) > 0.5 && mean(bHigh) > 4 * mean(bLow),
      { mean_bounce_ior_1_6: +mean(bHigh).toFixed(4), mean_bounce_ior_1_3: +mean(bLow).toFixed(4) },
      'The light the far face traps comes back as the inner bounce: bright where all of it is trapped (IOR 1.6), at least four times dimmer where only the Fresnel share is (IOR 1.3).');
  }
  {
    // Caustic glow: brightest where the exit normal faces away from the light, with the ball-lens size.
    const sphereGlow = (stage) => ({ preset: 'clear_crystal', time: 2, mesh: 'sphere', ...FLAT,
      overrides: { ...QUIET, Stage: stage, Caustic: 1, Causticspread: 1, Ior: 1.5, Dispersion: 0, Thickness: 2, Exittilt: 0, Backface: false,
        Lightdirx: -0.2, Lightdiry: 0.3, Lightdirz: 1.0, Lightcolorr: 1, Lightcolorg: 1, Lightcolorb: 1 } });
    const pts = []; for (let dy = -100; dy <= 100; dy += 20) for (let dx = -100; dx <= 100; dx += 20) if (Math.hypot(dx, dy) < 120) pts.push([cx + dx, cy + dy]);
    const glow = await floatsAt(sphereGlow('caustic'), pts), normal = await floatsAt(sphereGlow('exitnormal'), pts);
    const L = v3.norm([-0.2, 0.3, 1.0]);   // light in front, so the far wall facing away from it is in view
    const rows = pts.map((p, i) => { const N = v3.norm(normal[i].slice(0, 3).map((c) => 2 * c - 1));
      const angle = Math.acos(Math.max(-1, Math.min(1, -v3.dot(N, L))));
      return { angle: +angle.toFixed(3), expected: +Math.exp(-((angle / (1 / 3)) ** 2)).toFixed(4), measured: +glow[i][0].toFixed(4) }; });
    const worst = Math.max(...rows.map((r) => Math.abs(r.expected - r.measured)));
    check('caustic_glow_faces_away_from_light', worst <= 0.02 && Math.max(...rows.map((r) => r.measured)) > 0.5,
      { points: rows.length, worst_error: +worst.toFixed(4), brightest: rows.reduce((a, b) => (b.measured > a.measured ? b : a)) },
      'The caustic glow is the ball-lens spot of the delivered model: exp(-(angle / radius)^2), where angle is between the exit normal and the direction away from the light, and radius |2 - n| / n = 1/3 at IOR 1.5. Within 0.02 on a sphere, and bright where the exit normal faces away from the light.');
  }

  // ---------------------------------------------------------------- the flat guess is exact for a flat sheet
  {
    // Exit tilt -1 assumes a sheet of thickness Thickness, parallel to the near side. On the tilted
    // 0.4-thick slab it must land every lookup where the measured exit (back-face pass) does: same
    // direction (parallel faces) and same sideways shift (path Thickness / cos of the inside angle).
    const slabUV = (extra) => ({ preset: 'clear_crystal', time: 2, mesh: 'slab', spin: 35, tilt: 20, scale: [1, 1, 1], backdrop: 'uv',
      overrides: { ...OPTICS, Stage: 'refraction', Ior: 1.5, Dispersion: 0, Scenedepth: 1.0, ...extra } });
    const measured = await floatsAt(slabUV({ Backface: true }), slabPts);
    const guessed = await floatsAt(slabUV({ Backface: false, Exittilt: -1, Thickness: 0.4 }), slabPts);
    const ball = await floatsAt(slabUV({ Backface: false, Exittilt: 0, Thickness: 0.4 }), slabPts);
    const gap = (a, b) => Math.max(...a.map((g, i) => Math.hypot((g[0] / g[2] - b[i][0] / b[i][2]) * W, (g[1] / g[2] - b[i][1] / b[i][2]) * H)));
    const res = { points: slabPts.length, flat_guess_vs_measured_px: +gap(guessed, measured).toFixed(3), control_ball_guess_vs_measured_px: +gap(ball, measured).toFixed(3) };
    check('flat_guess_matches_measured_slab', res.flat_guess_vs_measured_px <= 0.5 && res.control_ball_guess_vs_measured_px > 2, res,
      'Without the back-face pass, Exit tilt -1 with Thickness 0.4 reproduces the measured image of the tilted 0.4-thick slab within 0.5 pixel (direction and sideways shift). Control: the ball guess (Exit tilt 0) does not.');
  }

  // ---------------------------------------------------------------- frost blurs without grain
  {
    // The brief rules out dithering. Over a smooth backdrop (the 'uv' gradient), frosted glass must give a
    // smooth image: per-pixel noise in the sampling shows as second differences between neighbouring pixels
    // everywhere. The median is used: creases where the surface itself folds (slab edges) are legitimate.
    const smoothness = (o) => page.evaluate((o) => {
      window.preview.draw({ ...o, probe: true }); const f = window.preview.lastProbe(); const [W, H] = window.preview.size;
      const at = (x, y, k) => f[(y * W + x) * 4 + k]; const covered = (x, y) => f[(y * W + x) * 4 + 3] !== 0;
      const values = [];
      for (let y = 10; y < H - 10; y++) for (let x = 10; x < W - 10; x++) {
        let inner = true; for (let d = -8; d <= 8 && inner; d++) if (!covered(x + d, y) || !covered(x, y + d)) inner = false;
        if (!inner) continue;
        let worst = 0;
        for (const k of [0, 1]) worst = Math.max(worst, Math.abs(at(x - 1, y, k) - 2 * at(x, y, k) + at(x + 1, y, k)),
                                                 Math.abs(at(x, y - 1, k) - 2 * at(x, y, k) + at(x, y + 1, k)));
        values.push(worst);
      }
      values.sort((a, b) => a - b);
      const q = (p) => +values[Math.floor(p * (values.length - 1))].toFixed(5);
      return { interior_pixels: values.length, median: q(0.5), p99: q(0.99) };
    }, o);
    const frosted = { ...QUIET, Stage: 'refraction', Frost: 1, Dispersion: 0, Saturation: 1, Backface: false };
    const cases = {
      sphere: await smoothness({ preset: 'clear_crystal', time: 2, mesh: 'sphere', ...FLAT, backdrop: 'uv', overrides: { ...frosted, Ior: 1.2, Scenedepth: 0.5 } }),
      slab: await smoothness({ preset: 'clear_crystal', time: 2, mesh: 'slab', spin: 35, tilt: 20, scale: [1, 1, 1], backdrop: 'uv',
                               overrides: { ...frosted, Ior: 1.5, Exittilt: -1, Thickness: 0.4 } }),
    };
    check('frost_is_smooth_not_grainy', Object.values(cases).every((c) => c.interior_pixels > 20000 && c.median <= 0.002), cases,
      'Frost 1 over a smooth gradient backdrop, on a sphere and a slab: inside the glass (8 pixels from its edge) the median second difference between neighbouring pixels of the read-back screen position stays below 0.002, so the blur adds no pixel-scale noise (no dithering). A copy that jitters the frost samples per pixel gives about 0.012. Checks the image, not function names.');
  }

  // ---------------------------------------------------------------- no false trapping on a ball, at any wavelength
  {
    const R = 133;   // the unit sphere's radius on screen (camera 5 units away, 45-degree field of view)
    const rim = (opts) => page.evaluate(([opts, R]) => {
      window.preview.draw({ ...opts, probe: true }); const f = window.preview.lastProbe(); const [W, H] = window.preview.size;
      let worst = 0, trapped = 0, n = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4; if (f[i + 3] === 0) continue;
        if (opts.mesh === 'sphere' && Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2) > 0.97 * R) continue;
        n++; const m = Math.max(f[i], f[i + 1], f[i + 2]); worst = Math.max(worst, m); if (m >= 0.99) trapped++;
      }
      return { pixels: n, trapped, worst_share: +worst.toFixed(3) };
    }, [opts, R]);
    const ball = (mesh, back, disp) => ({ preset: 'spectral_prism', time: 2, mesh, ...(mesh === 'sphere' ? FLAT : {}),
      overrides: { ...QUIET, Stage: 'tir', Ior: 1.5, Dispersion: disp, Exittilt: 0, Thickness: 1, Backface: back } });
    const cases = {
      sphere_guess_dispersion1: await rim(ball('sphere', false, 1)), sphere_measured_dispersion1: await rim(ball('sphere', true, 1)),
      sphere_measured_dispersion0: await rim(ball('sphere', true, 0)), torus_guess_dispersion1: await rim(ball('torus', false, 1)),
    };
    check('ball_never_traps_any_wavelength', Object.values(cases).every((c) => c.trapped === 0 && c.pixels > 1000), cases,
      'A ball cannot trap light: its exit angle equals its entry angle for every wavelength. On a unit sphere (out to 0.97 of its screen radius) with the ball guess and with the back-face pass, at Dispersion 0 and 1, and on the torus with the ball guess (Exit tilt 0, which assumes a ball everywhere), no red, middle or violet share reaches 0.99. This covers both the per-slice exit normal and the exit march near the silhouette.');
  }

  // ---------------------------------------------------------------- geometry without normals
  {
    const out = {};
    for (const mesh of ['slab', 'sphere']) for (const back of [false, true]) {
      out[`${mesh}_${back ? 'backpass' : 'fallback'}`] = await diff(
        { preset: 'clear_crystal', time: 2, mesh, spin: 35, tilt: 20, scale: [1, 1, 1], noNormals: true, overrides: { ...INVISIBLE, Backface: back } },
        { backdropOnly: true });
    }
    const slabPx = await pixelsAt({ ...slab, noNormals: true }, slabPts);
    out.slab_deviation_backpass_max_255 = Math.max(...slabPx.flatMap((p) => p.slice(0, 3)));
    const fin = [];
    for (const mesh of ['slab', 'sphere', 'torus']) for (const back of [false, true]) for (const stage of ['final', 'refraction', 'exitnormal', 'tir'])
      fin.push(await probe({ preset: 'spectral_prism', time: 2, mesh, noNormals: true, overrides: { Stage: stage, Backface: back } }));
    out.finite_renders = fin.length; out.finite_ok = fin.every((r) => r.nonFinite === 0 && r.covered > 0);
    check('geometry_without_normals', ['slab_fallback', 'slab_backpass', 'sphere_fallback', 'sphere_backpass'].every((k) => out[k].max <= 2)
      && out.slab_deviation_backpass_max_255 <= 2 && out.finite_ok, out,
      'A mesh with no normals (N = 0) uses faceted normals from screen derivatives, in both passes: IOR 1 stays invisible on a slab and a sphere, the slab still gives zero net deviation (faceted normals are exact there), and 24 renders stay finite.');
  }

  // ---------------------------------------------------------------- screen orientation and Flip V
  {
    // Where each lookup lands, read in floats over the 'uv' backdrop, for the prism bending sideways
    // and up/down, with the back-face pass. `variant` is drawn as a build or input that is upside
    // down would make it (preview.js emulates it); the readings must equal the normal ones at the
    // mirrored pixels (flipRaster) or the same pixels (mirrorInputs + Flip V).
    const lookups = async (variant, mirrorRows) => {
      const rows = [];
      for (const roll of [0, 90]) {
        const pts = facePoints(roll);
        const base = { ...wedgeAt(roll, { Ior: 1.3, Dispersion: 0, Scenedepth: 2.0 }), backdrop: 'uv' };
        const normal = await floatsAt(base, pts);
        const other = await floatsAt({ ...base, ...variant, overrides: { ...base.overrides, ...(variant.overrides || {}) } },
          pts.map(([x, y]) => [x, mirrorRows ? H - 1 - y : y]));
        pts.forEach((pt, i) => rows.push(Math.hypot((normal[i][0] / normal[i][2] - other[i][0] / other[i][2]) * W,
                                                   (normal[i][1] / normal[i][2] - other[i][1] / other[i][2]) * H)));
      }
      return { points: rows.length, worst_px: +Math.max(...rows).toFixed(3) };
    };
    const wholeImage = (o) => page.evaluate((o) => {
      window.preview.draw(o); const a = window.preview.pixels().slice();
      window.preview.draw({ ...o, flipRaster: true }); const b = window.preview.pixels(); const [W, H] = window.preview.size;
      let over8 = 0, n = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, j = ((H - 1 - y) * W + x) * 4;
        const d = Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2]));
        if (d > 0) n++; if (d > 8) over8++;
      }
      return { pixels_differing: n, pixels_over_8: over8 };
    }, o);
    const flipped = await lookups({ flipRaster: true }, true);
    const image = await wholeImage({ preset: 'spectral_prism', time: 2 });
    check('bends_follow_screen_orientation', flipped.worst_px <= 0.5 && image.pixels_over_8 <= 2000, { prism_lookups: flipped, spectral_prism_image: image },
      'A build whose screen y runs opposite to the projection\'s y (emulated: the rasteriser flips y; the scene behind and the back-face pass come from the same build) bends light the same way: through the prism, sideways and up/down, every lookup lands on the mirror of its normal position within 0.5 pixel. Over the whole default look, at most 2000 pixels differ by more than 8/255 (where the footprint mip level changes inside a 2 x 2 pixel block, whose derivatives the mirror reads from the other row; the shader before this check differed on about 90,000 pixels by up to 252/255).');
    const flipV = await lookups({ mirrorInputs: true, overrides: { Flipv: true } }, false);
    const flipVImage = await diff({ preset: 'spectral_prism', time: 2, mirrorInputs: true, overrides: { Flipv: true, Backface: true } },
                                  { preset: 'spectral_prism', time: 2, overrides: { Backface: true } });
    check('flip_v_corrects_upside_down_inputs', flipV.worst_px <= 0.5 && flipVImage.pixelsOver2 <= 50, { prism_lookups: flipV, spectral_prism_backpass_image: flipVImage },
      'If the Refraction TOP and the back-face pass arrive upside down, Flip V restores the normal render: it flips the base screen UV and every vertical offset together. Prism lookups within 0.5 pixel; the default look with the back-face pass within 2/255 except at most 50 pixels.');

    // A mirrored projection (uTDMats[].proj with a negative y scale; preview.js emulates it). With a
    // flipped raster as well the image is upright, so every reading must equal the normal one at the
    // same pixel; alone it is upside down, so at the mirrored pixel. Bends: projectOffset() takes
    // differences of projected points, which carry the projection's sign. Flat-image reflection: its
    // offset is a camera-space direction, so it needs the projection's sign on top of screenSign
    // (cam.viewSign). Over a Reflection TOP that stores its own coordinates, the reflection stage shows
    // where each flat-image lookup landed (Mirror 1, no blur, Flat image warp 0.6).
    const uprightBends = await lookups({ projFlipY: true, flipRaster: true }, false);
    const upsideDownBends = await lookups({ projFlipY: true }, true);
    const FLAT_IMAGE = { preset: 'spectral_prism', time: 2, reflectionFrom: 'uv',
      overrides: { ...QUIET, Stage: 'reflection', Reflectmode: 'screen', Reflection: 1, Mirror: 1, Reflectblur: 0,
                   Reflectcolorr: 1, Reflectcolorg: 1, Reflectcolorb: 1, Screenwarp: 0.6 } };
    const flatImage = await page.evaluate(([base, variants]) => {
      const grab = (o) => { window.preview.draw({ ...o, probe: true }); return window.preview.lastProbe().slice(); };
      const [W, H] = window.preview.size;
      const a = grab(base);
      let glass = 0, shifted = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (a[i + 3] === 0) continue;
        glass++; if (Math.abs(a[i + 1] - (y + 0.5) / H) * H > 8) shifted++;
      }
      const out = { normal: { glass_pixels: glass, pixels_read_over_8px_up_or_down: shifted } };
      for (const [name, o, mirrored] of variants) {
        const b = grab({ ...base, ...o });
        let n = 0, worst = 0, over1 = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4, j = ((mirrored ? H - 1 - y : y) * W + x) * 4;
          if (a[i + 3] === 0 || b[j + 3] === 0) continue;
          n++;
          const e = Math.hypot((b[j] - a[i]) * W, (b[j + 1] - (mirrored ? 1 - a[i + 1] : a[i + 1])) * H);
          worst = Math.max(worst, e); if (e > 1) over1++;
        }
        out[name] = { pixels: n, worst_px: +worst.toFixed(3), pixels_over_1px: over1 };
      }
      return out;
    }, [FLAT_IMAGE, [['mirrored_projection_upright', { projFlipY: true, flipRaster: true }, false],
                     ['mirrored_projection_upside_down', { projFlipY: true }, true],
                     ['flipped_raster_control', { flipRaster: true }, true]]]);
    const flatOk = ['mirrored_projection_upright', 'mirrored_projection_upside_down', 'flipped_raster_control']
      .every((k) => flatImage[k].pixels > 90000 && flatImage[k].worst_px <= 1);
    check('mirrored_projection_keeps_offsets_the_right_way', uprightBends.worst_px <= 0.5 && upsideDownBends.worst_px <= 0.5
      && flatImage.normal.pixels_read_over_8px_up_or_down > 10000 && flatOk,
      { prism_lookups_upright: uprightBends, prism_lookups_upside_down: upsideDownBends, flat_image_reflection: flatImage },
      'A build whose projection matrix has a negative y scale (emulated, with and without a flipped raster) bends and reflects the same way as the normal build: prism lookups land on the same or the mirrored position within 0.5 pixel, and every flat-image reflection lookup of the Spectral Prism torus within 1 pixel. Before the fix the flat-image offset ran up where the bends ran down (it ignored the projection\'s sign: 0 of 98,796 glass pixels agreed in direction, verifier\'s measurement).');
  }

  // ---------------------------------------------------------------- the back-face pass ignores any background
  {
    // The whole sphere, read back as floats, with the back-face pass cleared to different backgrounds
    // (as a camera background colour could add). Near the rim the exit search samples texels outside
    // the glass, so a background read as glass would change the result there.
    const rows = {};
    for (const stage of ['thickness', 'exitnormal', 'final']) {
      rows[stage] = await page.evaluate(([stage, QUIET]) => {
        const o = (bg) => ({ preset: 'clear_crystal', time: 2, mesh: 'sphere', tilt: 0, spin: 0, scale: [1, 1, 1], backClear: bg, probe: true,
          overrides: { ...QUIET, Backface: true, Stage: stage, Thickness: 2.0, Ior: 1.5, Dispersion: 0 } });
        window.preview.draw(o([0, 0, 0, 0])); const a = window.preview.lastProbe().slice();
        const res = {};
        for (const bg of [[0.2, 0.3, 0.4, 0.5], [1, 1, 1, 1]]) {
          window.preview.draw(o(bg)); const b = window.preview.lastProbe();
          let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-4) n++;
          res['alpha_' + bg[3]] = n;
        }
        return res;
      }, [stage, QUIET]);
    }
    const d1 = await diff({ preset: 'clear_crystal', time: 2, mesh: 'torus', backClear: [0.3, 0.3, 0.3, 0.7], overrides: { ...INVISIBLE, Backface: true } }, { backdropOnly: true });
    check('backface_background_reads_as_empty', Object.values(rows).every((r) => Object.values(r).every((n) => n === 0)) && d1.max <= 2,
      { values_changed_by_background: rows, ior1_with_background_alpha_0_7: d1 },
      'The back-face pass stores minus the distance, so a non-zero background (as a camera background colour could add) still reads as empty: on a sphere, the measured path, exit normal and final image are identical, value for value, with backgrounds of alpha 0, 0.5 and 1, and IOR 1 stays invisible. (The first encoding, distance in alpha with 0 = empty, changes 24 values at the rim.)');
  }

  // ---------------------------------------------------------------- compositing: objects in front of the glass
  {
    // Family sync R2: the README's route draws the glass with a Render Pass TOP into the scene render,
    // keeping its depth (Clear Depth Buffer and Clear to Camera Color off). The preview emulates it by
    // drawing the glass into a buffer that already holds the scene's colour and the occluder's depth.
    // (Until the sync the README listed every occluder in a second, glass-only render instead; the
    // preview drew that the same way.)
    const res = await page.evaluate(() => {
      const o = { preset: 'spectral_prism', time: 2 };
      window.preview.draw({ ...o, probe: true }); const glass = window.preview.lastProbe().slice();
      window.preview.draw({ ...o, occluder: {}, backdropOnly: true }); const scene = window.preview.pixels().slice();
      window.preview.draw({ ...o, backdropOnly: true }); const empty = window.preview.pixels().slice();
      window.preview.draw({ ...o, occluder: { renderPass: true } }); const hold = window.preview.pixels().slice();
      window.preview.draw({ ...o, occluder: {} }); const plain = window.preview.pixels().slice();
      const [W, H] = window.preview.size;
      // Occluder pixels over the glass: the ball is in the scene render, the glass covers them; 2 px away from any edge.
      const ball = (x, y) => { const i = (y * W + x) * 4; return Math.abs(scene[i] - empty[i]) + Math.abs(scene[i + 1] - empty[i + 1]) + Math.abs(scene[i + 2] - empty[i + 2]) > 30; };
      let n = 0, holdMax = 0, plainMax = 0;
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        let inner = true; for (let d = -2; d <= 2 && inner; d++) if (!ball(x + d, y) || !ball(x, y + d)) inner = false;
        if (!inner || glass[(y * W + x) * 4 + 3] === 0) continue;
        const i = (y * W + x) * 4; n++;
        holdMax = Math.max(holdMax, Math.abs(hold[i] - scene[i]), Math.abs(hold[i + 1] - scene[i + 1]), Math.abs(hold[i + 2] - scene[i + 2]));
        plainMax = Math.max(plainMax, Math.abs(plain[i] - scene[i]), Math.abs(plain[i + 1] - scene[i + 1]), Math.abs(plain[i + 2] - scene[i + 2]));
      }
      return { occluder_pixels_over_glass: n, render_pass_max_diff: holdMax, over_top_max_diff: plainMax };
    });
    check('render_pass_keeps_foreground_in_front', res.occluder_pixels_over_glass > 500 && res.render_pass_max_diff <= 2 && res.over_top_max_diff > 40, res,
      'An opaque ball between the camera and the glass: with the README\'s Render Pass TOP route (the glass drawn into the scene render, whose depth is kept), the image shows the ball exactly as the scene render does wherever it covers the glass, with no occluder listed anywhere. Control: laid over the scene with an Over TOP (the fallback), the glass is drawn over the ball. (Renamed from holdout_keeps_foreground_in_front: the emulation and thresholds are unchanged.)');
  }

  // ---------------------------------------------------------------- lookups stay in front of the camera
  {
    // A second page compiles an instrumented copy: projectOffset() records the smallest ratio between a
    // projected point's distance and its reference point's distance (clip w), and the glass outputs it.
    const ratioPatch = [
      ['vec2 projectOffset(vec3 p, vec3 from, PrismCamera cam)', 'float gMinRatio = 1e9;\nvec2 projectOffset(vec3 p, vec3 from, PrismCamera cam)'],
      ['    return 0.5 * (a.xy / a.w - b.xy / b.w) * cam.screenSign;', '    gMinRatio = min(gMinRatio, a.w / b.w);\n    return 0.5 * (a.xy / a.w - b.xy / b.w) * cam.screenSign;'],
    ];
    const page2 = await openPage([...ratioPatch, ['    writeColour(vec4(colour, alpha));', '    writeColour(vec4(gMinRatio, 0.0, 0.0, 1.0));']],
                                 [...ratioPatch, ['    fragColor = TDOutputSwizzle(vec4(colour, alpha));', '    fragColor = TDOutputSwizzle(vec4(gMinRatio, 0.0, 0.0, 1.0));']]);
    const rows = [];
    for (const preset of ['spectral_prism', 'trapped_light']) for (const cameraZ of [1.8, 3, 5]) for (const D of [2.2, 10, 50]) for (const back of [false, true]) {
      const r = await page2.evaluate((o) => { window.preview.draw({ ...o, probe: true }); const f = window.preview.lastProbe();
        let min = 1e9, n = 0; for (let i = 0; i < f.length; i += 4) if (f[i + 3] !== 0) { n++; min = Math.min(min, f[i]); }
        return { glass: n, min_ratio: +min.toFixed(4) }; }, { preset, time: 2, cameraZ, overrides: { Scenedepth: D, Backface: back } });
      rows.push({ preset, cameraZ, D, back, ...r });
    }
    await page2.close();
    check('lookups_stay_in_front_of_camera', rows.every((r) => r.glass > 0 && r.min_ratio >= 0.4995),
      { renders: rows.length, smallest_ratio: Math.min(...rows.map((r) => r.min_ratio)), rows: rows.filter((r) => r.D === 50).slice(0, 6) },
      'Every point the shader projects (scene lookups, bounce lookups, the exit march and per-slice re-reads) stays at least half as far from the camera as its reference point, so none lands near or behind the camera: Scene depth up to 50, camera 1.8 to 5 units away, with and without the back-face pass (instrumented copy of the delivered shader).');

    // Large Scene depth must not turn the glass grainy, and the footprint level must not blur it
    // beyond the true image: the mean absolute Laplacian inside the glass is compared with a 2 x 2
    // supersampled render of the same view (1920 x 1080 without the footprint level, averaged down).
    const lapOf = (p, mask, W, H) => {
      let sum = 0, n = 0;
      for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
        let ok = true; for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2; dx++) if (!(mask[(y + dy) * W + x + dx] > 0)) { ok = false; break; }
        if (!ok) continue;
        let lap = 0;
        for (let k = 0; k < 3; k++) { const c = (yy, xx) => p[(yy * W + xx) * 4 + k];
          lap = Math.max(lap, Math.abs(4 * c(y, x) - c(y, x - 1) - c(y, x + 1) - c(y - 1, x) - c(y + 1, x))); }
        sum += lap; n++;
      }
      return sum / n;
    };
    const image = (pg, o, down) => pg.evaluate(([o, down]) => {
      window.preview.draw(o); const p = window.preview.pixels(); const [W, H] = window.preview.size;
      if (down === 1) return Array.from(p);
      const w = W / down, h = H / down, out = new Array(w * h * 4).fill(0);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < 4; k++)
        out[(Math.floor(y / down) * w + Math.floor(x / down)) * 4 + k] += p[(y * W + x) * 4 + k] / (down * down);
      return out;
    }, [o, down]);
    const noFootprint = [['    return max(base, 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1.0)) - 2.0);', '    return base + 0.0 * (dx.x + dy.x);']];
    const big = await browser.newPage();
    big.on('pageerror', (e) => errors.push(String(e)));
    await big.addInitScript((p) => { window.previewPatch = p; }, noFootprint);
    await big.goto(`http://127.0.0.1:${port}/checks/preview/index.html?harness=1&w=${2 * W}&h=${2 * H}`);
    await big.evaluate(() => window.previewReady);
    const ratios = {};
    for (const preset of ['spectral_prism', 'trapped_light']) for (const D of [2.2, 20]) {
      const o = { preset, time: 2, overrides: { Scenedepth: D } };
      const mask = await page.evaluate((o) => { window.preview.draw({ ...o, probe: true });
        return Array.from(window.preview.lastProbe().filter((_, i) => i % 4 === 3)); }, o);
      const delivered = lapOf(await image(page, o, 1), mask, W, H), truth = lapOf(await image(big, o, 2), mask, W, H);
      ratios[`${preset}_depth_${D}`] = { mean_laplacian: +delivered.toFixed(2), supersampled_2x2: +truth.toFixed(2), ratio: +(delivered / truth).toFixed(3) };
    }
    await big.close();
    check('large_scene_depth_stays_smooth', Object.values(ratios).every((r) => r.ratio >= 0.85 && r.ratio <= 1.2), ratios,
      'At Scene depth 2.2 and 20 (Spectral Prism, Trapped Light), the glass is no grainier and no blurrier than a 2 x 2 supersampled render of the same view: the mean absolute Laplacian inside the glass stays within 0.85 to 1.2 times the supersampled one. Each lookup reads a mip level that rises once its footprint passes 4 texels per pixel. (Changed in the family sync: the test used to require the Laplacian to grow at most 1.8 times from Scene depth 2.2 to 20, but the supersampled render itself grows 1.85 and 2.06 times; the 6a58487 full-footprint level met it by over-blurring, 0.55 to 0.79 times the supersampled image; no level at all gives up to 1.53 times. See review.md.)');
  }

  // ================================================================ family sync (core rounds 2-3, merge items C1-C9)
  // These fail on the 6a58487 material (node checks/preview_tests.cjs <port> --reference), except
  // the guards marked as such. review.md (Family sync) has the red run.
  const PRESET_NAMES = await page.evaluate(() => window.preview.presets.order);

  // Pixel-difference statistics of two renders: max, count over a threshold, 99th percentile.
  const stats = (a, b, threshold) => page.evaluate(([a, b, threshold]) => {
    window.preview.draw(a); const pa = window.preview.pixels().slice();
    window.preview.draw(b); const pb = window.preview.pixels();
    const ds = [];
    let max = 0, over = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      if (d > 0) ds.push(d);
      max = Math.max(max, d); if (d > threshold) over++;
    }
    ds.sort((x, y) => x - y);
    const total = pa.length / 4;
    const p99 = ds.length > total * 0.01 ? ds[ds.length - Math.ceil(total * 0.01)] : 0;
    return { max, [`pixelsOver${threshold}`]: over, p99OfAllPixels: p99 };
  }, [a, b, threshold]);

  // Like diff(), with alpha too: for renders over a transparent scene.
  const diffRGBA = (a, b) => page.evaluate(([a, b]) => {
    window.preview.draw(a); const pa = window.preview.pixels().slice();
    window.preview.draw(b); const pb = window.preview.pixels();
    let max = 0, over = 0, over1 = 0, alphaMax = 0;
    for (let i = 0; i < pa.length; i += 4) {
      let d = 0;
      for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(pa[i + k] - pb[i + k]));
      alphaMax = Math.max(alphaMax, Math.abs(pa[i + 3] - pb[i + 3]));
      max = Math.max(max, d); if (d > 2) over++; if (d > 1) over1++;
    }
    return { max, alphaMax, pixelsOver2: over, pixelsOver1: over1 };
  }, [a, b]);

  // ---------------------------------------------------------------- R1: integrated drift clock
  {
    // Consecutive frames: the second draw continues the drift like a running component
    // (presets.py advance(), mirrored in preview.js). The object does not spin (spin: 0).
    const frames = (a, b) => stats({ spin: 0, ...a }, { spin: 0, ...b, drift: 'continue' }, 8);
    const morphFrame = (stage, T) => frames(
      { preset: 'spectral_prism', time: T, overrides: { Stage: stage, Morphtarget: 'lavender_prism', Morph: 0.5 } },
      { preset: 'spectral_prism', time: T + 1 / 60, overrides: { Stage: stage, Morphtarget: 'lavender_prism', Morph: 0.51 } });
    const morph = {};
    for (const stage of ['final', 'film']) for (const T of [2, 3600]) morph[`${stage}_t${T}`] = await morphFrame(stage, T);
    check('morph_frame_is_smooth_after_an_hour',
      ['final', 'film'].every((st) => morph[`${st}_t3600`].max <= morph[`${st}_t2`].max + 12
        && morph[`${st}_t3600`].p99OfAllPixels <= morph[`${st}_t2`].p99OfAllPixels + 3), morph,
      'One frame of a 100-frame A/B morph (Spectral Prism toward Lavender Prism, Morph 0.50 to 0.51 in 1/60 s) changes the image no more after an hour than after 2 s: the ripple and film drift is added up frame by frame, so changing its speed never throws the pattern. (6a58487 multiplied absolute time by the morphed speed in the shader.)');
    const lavender = (T, speed) => ({ preset: 'lavender_prism', time: T, overrides: { Stage: 'normal', Wobblespeed: speed } });
    const steady = await frames(lavender(3600, 0.6), lavender(3600 + 1 / 60, 0.6));
    const nudged = await frames(lavender(3600, 0.6), lavender(3600 + 1 / 60, 0.61));
    check('speed_change_is_smooth_after_an_hour', nudged.max <= Math.max(steady.max, 2) + 2, { steady, nudged },
      'After an hour, nudging Wobble speed from 0.60 to 0.61 changes one frame no more than one frame of motion at a fixed speed does (Lavender Prism, normal stage).');
  }

  // ---------------------------------------------------------------- R5: shader hygiene
  {
    const d1 = await diff({ preset: 'clear_crystal', time: 2, overrides: { ...INVISIBLE, Wobble: 0.6, Wobblescale: 1.6, Wobblespeed: 0.6 } },
                          { backdropOnly: true });
    const d2 = await diff({ preset: 'clear_crystal', time: 2, overrides: { ...INVISIBLE, Wobble: 0.6, Wobblescale: 1.6, Wobblespeed: 0.6, Backface: true } },
                          { backdropOnly: true });
    check('ior1_invisible_with_wobble', d1.max <= 2 && d2.max <= 2, { fallback: d1, backpass: d2 },
      'Ripples do not undo the silhouette fix: at IOR 1 the rippled glass is still invisible, with and without the back-face pass (normals are turned toward the camera, and the far side\'s away from it, after the wobble).');

    // The same torus with its Geometry COMP scaled 0.1 and 10 times, the camera moved with it, and
    // Object size scaled with it as Fit to Glass geometry sets it: the rippled normals must not change
    // (normal stage). Family close G1: the ripples count the COMP's scale, so the expectation now
    // includes the fitted Object size (left at the demo's own size, the scaled ones give 50/255 on 70,554
    // pixels and 80/255 on 81,915; review.md, Family close).
    const scaled = (k) => ({ preset: 'lavender_prism', time: 2, scale: [k, k, 0.6 * k], cameraZ: 5 * k, near: 0.1 * k, far: 100 * k,
      overrides: { Stage: 'normal', Wobble: 0.6, Objectsize: k * DEMO_SIZE } });
    const small = await stats(scaled(0.1), scaled(1), 8), large = await stats(scaled(10), scaled(1), 8);
    check('wobble_independent_of_object_scale', small.max <= 12 && large.max <= 12 && small.pixelsOver8 <= 50 && large.pixelsOver8 <= 50,
      { scale_0_1: small, scale_10: large },
      'Wobble looks the same on a Geometry COMP scaled 0.1 or 10 times (camera moved with it, Object size set to the scale as Fit sets it; normal stage): the ripple slope is multiplied by the cube root of the scale\'s volume change. 6a58487 divided the tilt by the scale (ten times too strong at 0.1).');

    // Geometry without normals at a tenth of the size: the faceted normal's degeneracy test is relative.
    const faceted = (k) => ({ preset: 'clear_crystal', time: 2, mesh: 'slab', spin: 35, tilt: 20, scale: [1, 1, 1], noNormals: true,
      sopScale: k, cameraZ: 5 * k, near: 0.1 * k, far: 100 * k, overrides: { Stage: 'normal' } });
    const facet = await stats(faceted(0.05), faceted(1), 8);
    check('faceted_normal_is_scale_free', facet.pixelsOver8 <= 50, facet,
      'A mesh without normals built at a twentieth of the size (camera moved with it) gets the same faceted normals: the degeneracy test compares the cross product with the derivatives\' own size. 6a58487 used an absolute threshold, so small objects fell back to facing the camera.');
  }

  // ---------------------------------------------------------------- R6: frost disc
  {
    // Over the 'uv' backdrop at IOR 1 every lookup lands on its own pixel plus its frost offset, so
    // the read-back position shows the frost disc's average offset: the image shift.
    const shift = await page.evaluate(() => {
      const o = (frost) => ({ preset: 'clear_crystal', time: 2, mesh: 'sphere', tilt: 0, spin: 0, scale: [1, 1, 1], backdrop: 'uv', probe: true,
        overrides: { Reflection: 0, Rim: 0, Specular: 0, Diffuse: 0, Iridescence: 0, Wobble: 0, Caustic: 0, Ior: 1, Dispersion: 0,
                     Saturation: 1, Density: 0, Stage: 'refraction', Frost: frost, Samples: 16, Objectsize: 1 } });
      window.preview.draw(o(0)); const a = window.preview.lastProbe().slice();
      window.preview.draw(o(1)); const b = window.preview.lastProbe(); const [W, H] = window.preview.size;
      let n = 0, du = 0, dv = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2) > 80 || a[i + 2] <= 0 || b[i + 2] <= 0) continue;
        n++; du += b[i] / b[i + 2] - a[i] / a[i + 2]; dv += b[i + 1] / b[i + 2] - a[i + 1] / a[i + 2];
      }
      return { pixels: n, shift_px: [+(du / n * W).toFixed(2), +(dv / n * H).toFixed(2)], shift_length_px: +Math.hypot(du / n * W, dv / n * H).toFixed(2) };
    });
    check('frost_does_not_shift_the_image', shift.pixels > 10000 && shift.shift_length_px <= 2.0, shift,
      'Frost 1 at 16 samples blurs the view through a sphere without moving it: the read-back screen position moves on average by at most 2 pixels (the disc spreads 0.25 scene units, about 32 pixels at this distance). The frost points come from the R2 sequence, whose average stays near the centre; 6a58487\'s golden-angle spiral put them on one arm (average offset 0.14 of the radius).');
  }

  // ---------------------------------------------------------------- R8: colour parameters and energy conserving
  {
    const mirror = { ...QUIET, Reflection: 1, Mirror: 1, Conserve: true };  // QUIET turns reflections off; back on here
    const d = await diff({ preset: 'clear_crystal', time: 2, overrides: { ...mirror, Stage: 'final' } },
                         { preset: 'clear_crystal', time: 2, overrides: { ...mirror, Stage: 'reflection' } });
    check('energy_conserving_mirror_is_pure_reflection', d.max <= 2, d,
      'With Energy conserving on and Mirror 1, nothing shows through: the final image equals the reflection stage (bounce and glow included, since they travel through the glass).');
    const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lavender = [0.76, 0.64, 1.0];  // Lavender Prism's glass colour (its light is white)
    const e = await diff({ preset: 'lavender_prism', time: 2, overrides: { Stage: 'body', Colourspace: 'srgb' } },
                         { preset: 'lavender_prism', time: 2, overrides: { Stage: 'body', Colourspace: 'raw',
                           Glasscolorr: srgbToLinear(lavender[0]), Glasscolorg: srgbToLinear(lavender[1]), Glasscolorb: srgbToLinear(lavender[2]) } });
    check('srgb_colour_mode_decodes_colours', e.max <= 2, e,
      'Colour parameters set to sRGB render like the same colours converted to linear by hand (Lavender Prism, body stage).');
  }

  // ---------------------------------------------------------------- C1: the Refraction TOP's alpha
  {
    const EMPTY = [0, 0, 0, 0], HALF = [0.25, 0.25, 0.25, 0.5];  // premultiplied, as a Render TOP stores them
    const empty = await diffRGBA({ preset: 'clear_crystal', time: 2, flatBackdrop: EMPTY, overrides: INVISIBLE },
                                 { backdropOnly: true, flatBackdrop: EMPTY });
    const emptyBack = await diffRGBA({ preset: 'clear_crystal', time: 2, flatBackdrop: EMPTY, overrides: { ...INVISIBLE, Backface: true } },
                                     { backdropOnly: true, flatBackdrop: EMPTY });
    const half = await diffRGBA({ preset: 'clear_crystal', time: 2, flatBackdrop: HALF, overrides: INVISIBLE },
                                { backdropOnly: true, flatBackdrop: HALF });
    check('transparent_scene_stays_transparent', empty.max <= 2 && emptyBack.max <= 2,
      { alpha_0_scene: empty, alpha_0_scene_backface_pass: emptyBack, known_limit_alpha_half_scene_not_asserted: half },
      'Over a Refraction TOP with a transparent background (alpha 0), invisible glass (IOR 1, no tint or light terms) leaves the image exactly as the scene: colour and alpha, with the back-face pass off and on. (6a58487 wrote alpha 1, so clear glass turned the empty background opaque black.) Measured, not asserted: where the scene is only partly covered (alpha 0.5), the glass draws the bent scene and blending adds the scene behind it again by the see-through share, so the pixel comes out brighter and more opaque (a documented limit).');
    const tinted = { preset: 'lavender_prism', time: 2, flatBackdrop: EMPTY };
    const d = await diffRGBA(tinted, { ...tinted, refraction: false });
    const tintedBack = await diffRGBA({ ...tinted, overrides: { Backface: true } }, { ...tinted, refraction: false, overrides: { Backface: true } });
    check('empty_scene_matches_no_refraction_top', d.max <= 2 && tintedBack.max <= 2, { back_face_pass_off: d, back_face_pass_on: tintedBack },
      'Where the Refraction TOP is empty (alpha 0), the glass blends exactly as it does with no Refraction TOP connected (Lavender Prism, colour and alpha, with the back-face pass off and on; bounce and glow stay in both): one formula covers both.');
    // Guard (passes on both materials): over an opaque scene nothing changes. Ripples, film and frost are
    // off, because the sync changes those on purpose (R1 lattice wrap, R5 re-facing, R6 frost disc), and
    // the 6a58487 copy gets the synced footprint level (2 levels lower, also on purpose; decisions.json).
    const footprintNow = [['    return max(base, 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1.0)));',
                           '    return max(base, 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1.0)) - 2.0);']];
    const page4 = await openPage([], footprintNow);
    // Object size 1: the 6a58487 bindings had none, so its lengths were the raw values (the default
    // is the demo's 0.872517 since the family close).
    const SAME = { Wobble: 0, Iridescence: 0, Frost: 0, Objectsize: 1 };
    const seen = {};
    for (const name of PRESET_NAMES) for (const back of [false, true]) {
      const o = { preset: name, time: 2, mesh: 'knot', scale: [1, 1, 1], overrides: { ...SAME, Backface: back } };
      seen[`${name}${back ? '_backpass' : ''}`] = await page4.evaluate(([a, b]) => {
        window.preview.draw(a); const pa = window.preview.pixels().slice();
        window.preview.draw(b); const pb = window.preview.pixels();
        let max = 0, over1 = 0;
        for (let i = 0; i < pa.length; i += 4) {
          let dd = 0; for (let k = 0; k < 4; k++) dd = Math.max(dd, Math.abs(pa[i + k] - pb[i + k]));
          max = Math.max(max, dd); if (dd > 1) over1++;
        }
        return { max, pixelsOver1: over1 };
      }, [o, { ...o, reference: true }]);
    }
    await page4.close();
    check('opaque_scene_matches_pre_sync', Object.values(seen).every((r) => r.max <= 1 || r.pixelsOver1 <= 12), seen,
      'Over an opaque Refraction TOP (the demo backdrop), each of the twelve presets with ripples, film and frost off renders as the 6a58487 material did (with the synced footprint level patched in), within 1/255 including alpha (knot, back-face pass off and on), except at most 12 pixels per render: the silhouette pixels where 6a58487\'s derivative-based screen orientation came out wrong (screen_orientation_has_no_wrong_pixels). So covered = 1, Colour parameters Auto in a pass-through project, Object size 1, fog off, no extra colour buffers and the cap at 1024 change nothing.');
  }

  // ---------------------------------------------------------------- C2: extra colour buffers
  {
    const CLEAR = [0.5, 0.5, 0.5, 0.5];
    const mrt = await page.evaluate(([CLEAR]) => {
      const o = { preset: 'spectral_prism', time: 2, clearBuffers: CLEAR };
      window.preview.draw({ ...o, probe: true }); const single = window.preview.lastProbe().slice();
      window.preview.draw({ ...o, buffers: 3 }); const b = window.preview.lastBuffers();
      let glass = 0, buffer0Max = 0; const extraNonZero = [0, 0, 0];
      for (let i = 0; i < single.length; i += 4) {
        if (single[i + 3] === CLEAR[3] && single[i] === CLEAR[0]) continue;  // no glass here
        glass++;
        for (let k = 0; k < 4; k++) buffer0Max = Math.max(buffer0Max, Math.abs(b[0][i + k] - single[i + k]));
        for (const j of [1, 2]) if (b[j][i] || b[j][i + 1] || b[j][i + 2] || b[j][i + 3]) extraNonZero[j]++;
      }
      return { glass_pixels: glass, buffer0_max_float_diff: buffer0Max, buffer1_pixels_not_zero: extraNonZero[1],
               buffer2_pixels_not_zero: extraNonZero[2] };
    }, [CLEAR]);
    check('extra_colour_buffers_get_zeros', mrt.glass_pixels > 1000 && mrt.buffer0_max_float_diff === 0
      && mrt.buffer1_pixels_not_zero === 0 && mrt.buffer2_pixels_not_zero === 0, mrt,
      'In a render with three colour buffers (TD_NUM_COLOR_BUFFERS 3, cleared to 0.5, blending off), buffer 0 holds exactly the single-buffer glass and buffers 1 and 2 hold zeros wherever the glass is drawn (with the material\'s premultiplied blending, zeros leave those buffers unchanged). 6a58487 wrote buffer 0 only.');
  }

  // ---------------------------------------------------------------- C3 (rejected; this test guards the decision)
  {
    // At the default 16 slices, high dispersion already matches a 64-slice render closely. The fan-gap
    // mip level from the blobs study made it worse in this study too (decisions.json), so a change
    // that blurs the rainbow fan fails here.
    const dispersed = {};
    for (const preset of ['clear_crystal', 'prism_chrome', 'spectral_prism']) {
      dispersed[preset] = await page.evaluate((preset) => {
        const o = (n) => ({ preset, time: 2, sampleCap: n > 32 ? n : undefined, overrides: { Stage: 'refraction', Dispersion: 1, Samples: n } });
        const grab = (opts) => { window.preview.draw(opts); return window.preview.pixels().slice(); };
        const bg = grab({ backdropOnly: true }), a = grab(o(16)), b = grab(o(64));
        const d = (x, y, i) => Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
        let glass = 0, sum = 0, over32 = 0, max = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (d(b, bg, i) === 0 && d(a, bg, i) === 0) continue;
          glass++; const e = d(a, b, i); sum += e; max = Math.max(max, e); if (e > 32) over32++;
        }
        return { glass_pixels: glass, mean: +(sum / glass).toFixed(2), max, pixelsOver32: over32 };
      }, preset);
    }
    check('dispersion_converges_with_samples', Object.values(dispersed).every((r) => r.pixelsOver32 <= 50 && r.mean <= 2.5), dispersed,
      'Dispersion 1 at the default 16 slices agrees with a 64-slice render (refraction stage, torus, Clear Crystal, Prism Chrome and Spectral Prism): mean difference within 2.5/255 and at most 50 of about 99,000 glass pixels over 32/255. A fan-gap mip level as wide as the whole gap between slices (tried in the family sync, from the blobs study) fails this on Spectral Prism: mean 4.79/255 and 1,510 pixels over 32/255. A quarter of the gap (what the blobs study adopted) passes but changes no pixel on Clear Crystal or Prism Chrome (decisions.json, C3).');
  }

  // ---------------------------------------------------------------- C5: output cap
  {
    const floats = (o) => page.evaluate((o) => {
      window.preview.draw(o); const f = window.preview.lastProbe();
      let nonFinite = 0, maxRGB = 0, minA = 0;
      for (let i = 0; i < f.length; i += 4) {
        for (let k = 0; k < 4; k++) if (!Number.isFinite(f[i + k])) nonFinite++;
        maxRGB = Math.max(maxRGB, f[i], f[i + 1], f[i + 2]); minA = Math.min(minA, f[i + 3]);
      }
      return { nonFinite, maxRGB: +maxRGB.toFixed(1), minAlpha: +minA.toFixed(1) };
    }, o);
    const hot = await floats({ preset: 'clear_crystal', time: 2, probe: true,
      overrides: { Lightcolorr: 2e5, Lightcolorg: 2e5, Lightcolorb: 2e5, Specular: 5 } });
    const far = await floats({ preset: 'clear_crystal', time: 2, mesh: 'sphere', spin: 0, tilt: 0, scale: [1, 1, 1], readBack: true,
      cameraZ: 1500, fov: 2 * Math.atan(Math.tan(22.5 * Math.PI / 180) * 5 / 1500) * 180 / Math.PI, far: 3000,
      overrides: { Backface: true } });
    check('output_fits_half_float', hot.nonFinite === 0 && hot.maxRGB <= 1024 && far.minAlpha < -1400, { hot_highlight: hot, back_pass_far_away: far },
      'A light colour of 200,000 (a typed value, or an HDR multiplier) gives finite colour no higher than 1024, which a 16-bit float render stores (half floats end at 65504; 6a58487 wrote values far above that). The cap is on colour only: the back-face pass of a sphere 1500 units away still stores minus distances below -1400 in alpha.');
  }

  // ---------------------------------------------------------------- C6: screen orientation, measured per pixel
  {
    // Instrumented copies output the screen orientation each pixel measured. In TouchDesigner's usual
    // orientation (and in the preview's normal raster) it is +1, +1 everywhere.
    const signPatch = [['    writeColour(vec4(colour, alpha));', '    writeColour(vec4(cam.screenSign * 0.25 + 0.5, 0.5, 1.0));']];
    const signRefPatch = [['    fragColor = TDOutputSwizzle(vec4(colour, alpha));', '    fragColor = TDOutputSwizzle(vec4(cam.screenSign * 0.25 + 0.5, 0.5, 1.0));']];
    // 960 x 540, and an odd size (481 x 271), where one pixel row and one column sit exactly on the
    // screen's centre lines: there the projected and the raster position are both 0.
    const rows = {};
    for (const size of [null, [481, 271]]) {
      const page3 = await openPage(signPatch, signRefPatch, size);
      for (const mesh of ['torus', 'knot']) for (const flip of [false, true]) {
        rows[`${mesh}${flip ? '_flipped_raster' : ''}${size ? `_${size[0]}x${size[1]}` : ''}`] = await page3.evaluate(([mesh, flip, names]) => {
          let wrong = 0, glass = 0, wrongCentreLines = 0;
          const [W, H] = window.preview.size;
          for (const preset of names) {
            window.preview.draw({ preset, mesh, time: 2, flipRaster: flip, probe: true, ...(mesh === 'knot' ? { scale: [1, 1, 1] } : {}) });
            const f = window.preview.lastProbe(); const ey = flip ? 0.25 : 0.75;
            for (let i = 0; i < f.length; i += 4) {
              if (f[i + 3] === 0) continue;
              glass++;
              if (f[i] !== 0.75 || f[i + 1] !== ey) {
                wrong++; const p = i / 4;
                if (2 * (p % W) === W - 1 || 2 * Math.floor(p / W) === H - 1) wrongCentreLines++;
              }
            }
          }
          return { size: [W, H], renders: names.length, glass_pixels: glass, wrong_sign_pixels: wrong, of_them_on_a_centre_line: wrongCentreLines };
        }, [mesh, flip, PRESET_NAMES]);
      }
      await page3.close();
    }
    // Family close G2: the family's survey, as Liquid Glass Lit and the core run it, on this shader.
    // Each preset at its own pose on the torus, knot and sphere, normal and flipped raster, at
    // 480 x 270 and 481 x 271; two readouts: the glass alone in a float target (one sample per
    // pixel) and the 4x multisampled canvas (blue = how many samples the glass covers). The
    // instrumented copy writes the orientation as 1 or 0 per axis: cam.viewSign, the core's `orient`.
    const familyPatch = [['    writeColour(vec4(colour, alpha));', '    writeColour(vec4(step(vec2(0.0), cam.viewSign), 1.0, 1.0));']];
    const familyRefPatch = [['    fragColor = TDOutputSwizzle(vec4(colour, alpha));', '    fragColor = TDOutputSwizzle(vec4(step(vec2(0.0), cam.screenSign), 1.0, 1.0));']];
    const family = {};
    for (const size of [[480, 270], [481, 271]]) {
      const page5 = await openPage(familyPatch, familyRefPatch, size);
      for (const mesh of ['torus', 'knot', 'sphere']) for (const flip of [false, true]) {
        family[`${mesh}${flip ? '_flipped_raster' : ''}_${size[0]}x${size[1]}`] = await page5.evaluate(([mesh, flip, names]) => {
          const [W, H] = window.preview.size;
          const onCentreLine = (p) => Math.abs(p % W + 0.5 - W / 2) <= 1 || Math.abs(Math.floor(p / W) + 0.5 - H / 2) <= 1;
          const single = { glass_pixels: 0, wrong_sign_pixels: 0, of_them_within_a_pixel_of_a_centre_line: 0 };
          const multi = { glass_pixels: 0, wrong_sign_pixels: 0, of_them_within_a_pixel_of_a_centre_line: 0 };
          const count = (r, p, wrong) => { r.glass_pixels++; if (wrong) { r.wrong_sign_pixels++; if (onCentreLine(p)) r.of_them_within_a_pixel_of_a_centre_line++; } };
          names.forEach((preset, k) => {
            const o = { preset, mesh, time: 2, spin: 13.7 * k, tilt: 20 + 2.5 * k, flipRaster: flip, flatBackdrop: [0, 0, 0, 1],
              ...(mesh === 'torus' ? {} : { scale: [1, 1, 1] }) };
            window.preview.draw({ ...o, probe: true });
            const f = window.preview.lastProbe();
            for (let i = 0; i < f.length; i += 4) if (f[i + 3] > 0) count(single, i / 4, f[i] !== 1 || f[i + 1] !== (flip ? 0 : 1));
            window.preview.draw(o);
            const px = window.preview.pixels();  // one wrong sample of four is 64/255
            for (let i = 0; i < px.length; i += 4) if (px[i + 2] > 0) count(multi, i / 4, px[i + 2] - px[i] > 32 || (flip ? px[i + 1] > 32 : px[i + 2] - px[i + 1] > 32));
          });
          return { size: [W, H], renders: names.length, single_sample: single, multisampled: multi };
        }, [mesh, flip, PRESET_NAMES]);
      }
      await page5.close();
    }
    check('screen_orientation_has_no_wrong_pixels', Object.values(rows).every((r) => r.glass_pixels > 100000 && r.wrong_sign_pixels === 0)
      && Object.values(family).every((r) => r.single_sample.glass_pixels > 100000 && r.single_sample.wrong_sign_pixels <= 2 && r.multisampled.wrong_sign_pixels <= 10),
      { this_study: rows, family_survey: family },
      'The screen orientation is right at every glass pixel of the twelve presets on the torus and the knot, in a normal and a flipped raster, at 960 x 540 and at the odd size 481 x 271: it compares the pixel\'s projected position with its raster position, and only on a centre line of an odd-sized render, where both are 0, takes the sign of the projected position\'s screen derivatives. 6a58487 took the sign of derivatives everywhere, which came out wrong on one silhouette pixel per render here (the core study measured 2 to 5 on its knot, up to 50/255 off). The comparison alone, with +1 on ties, was wrong on the whole centre row at 481 x 271 in a flipped raster (1,524 torus and 1,548 knot pixels). Family close G2: the family\'s survey with Liquid Glass Lit\'s and the core\'s thresholds too (each preset at its own pose on the torus, knot and sphere, 480 x 270 and 481 x 271): at most 2 wrong single-sample pixels and 10 wrong multisampled pixels per row of twelve renders (20 until the family critic\'s centre-line round; measured here: at most 1 and 2). The few the family allows are a centre-line pixel on a nearly edge-on surface (the tie keeps +1) and silhouette pixels where the glass covers one to three samples of four. Whether those are visible in TouchDesigner is a family open question with a pending native check (co-design.json; validation.json, centre_line_residual).');
  }

  // ---------------------------------------------------------------- C7: fog
  {
    // The preview's TDFog stand-in mixes in a constant fog colour (a test model, not TouchDesigner's
    // fog curve). Full red fog over half-opaque invisible glass: each glass pixel must be half the
    // scene (seen through) plus half the fog (the glass's own share), never fog on top of fog.
    const RED = [1, 0, 0, 1];
    const fogged = await page.evaluate(([INVISIBLE, RED]) => {
      window.preview.draw({ backdropOnly: true }); const bg = window.preview.pixels().slice();
      const run = (opacity) => {
        window.preview.draw({ preset: 'clear_crystal', time: 2, fog: RED, overrides: { ...INVISIBLE, Opacity: opacity } });
        const px = window.preview.pixels(); let glass = 0, off2 = 0;
        for (let i = 0; i < px.length; i += 4) {
          const scene = [bg[i], bg[i + 1], bg[i + 2]];
          const mixed = [0.5 * scene[0] + 127.5, 0.5 * scene[1], 0.5 * scene[2]];
          const off = (t) => Math.max(...[0, 1, 2].map((k) => Math.abs(px[i + k] - t[k])));
          if (off(scene) > 2) glass++;
          if (Math.min(off(scene), off(mixed)) > 2) off2++;  // neither: only antialiased silhouette pixels
        }
        return { glass_pixels: glass, pixels_neither_over_2: off2 };
      };
      return { opacity_half: run(0.5), opacity_0: run(0) };
    }, [INVISIBLE, RED]);
    check('fog_adds_only_the_glass_share', fogged.opacity_half.glass_pixels > 1000 && fogged.opacity_half.pixels_neither_over_2 <= 1500
      && fogged.opacity_0.glass_pixels === 0, fogged,
      'With full fog (preview stand-in) on invisible glass at Opacity 0.5, every glass pixel is half the scene plus half the fog colour within 2/255 (only antialiased silhouette pixels are neither), and at Opacity 0 the fogged glass leaves no trace. With fog off TDFog changes nothing (opaque_scene_matches_pre_sync). 6a58487 ignored fog. TouchDesigner\'s own fog is a native check.');
  }

  // ---------------------------------------------------------------- C8: Object size
  {
    // The same torus built at 0.1 and 10 units (the SOP itself, not the Geometry COMP's scale), the
    // camera moved with it, and Object size set to match: each preset looks as it does at size 1.
    const sized = {};
    for (const preset of ['spectral_prism', 'lavender_prism', 'frosted_ice', 'caustic_heart']) for (const back of [false, true]) {
      const base = { preset, time: 2, overrides: { Backface: back } };
      sized[`${preset}${back ? '_backpass' : ''}`] = {
        size_0_1: await stats({ ...base, sopScale: 0.1, cameraZ: 0.5, near: 0.01, overrides: { Backface: back, Objectsize: 0.1 * DEMO_SIZE } }, base, 8),
        size_10: await stats({ ...base, sopScale: 10, cameraZ: 50, far: 1000, overrides: { Backface: back, Objectsize: 10 * DEMO_SIZE } }, base, 8),
      };
    }
    check('object_size_carries_presets_over', Object.values(sized).every((r) => Object.values(r).every((x) => x.pixelsOver8 <= 50)), sized,
      'A preset looks the same on an object built 0.1 or 10 units across, with Object size set to match (what Fit to Glass geometry measures): Thickness, Scene depth, frost, tint, ripples and film all follow, with and without the back-face pass (final image, at most 50 pixels over 8/255). 6a58487 had no Object size: its lengths stayed in scene units.');

    // Family close G1 (Liquid Glass Lit's test, ported through the core): the same torus scaled by its
    // Geometry COMP instead, TouchDesigner's usual way to size an object, with the camera moved with it.
    // Fit to Glass geometry then sets Object size to the demo's size times that scale (half the bounds
    // x the COMP's world scale, over 1.45). Object size is the object's size in the world, so the
    // ripple and film patterns must follow it as the lengths do. On c94e849 they stayed in object
    // space: k times as many per unit of the object at the fitted size.
    const comp = {};
    for (const [preset, stage, back] of [['lavender_prism', 'normal', false], ['prism_chrome', 'film', false],
      ['spectral_prism', 'final', false], ['lavender_prism', 'final', false], ['prism_chrome', 'final', false],
      ['frosted_ice', 'final', false], ['spectral_prism', 'final', true]]) {
      const base = { preset, time: 2, overrides: { Stage: stage, Backface: back } };
      const at = (k) => ({ ...base, scale: [k, k, 0.6 * k], cameraZ: 5 * k, near: 0.1 * k, far: 100 * k,
        overrides: { Stage: stage, Backface: back, Objectsize: k * DEMO_SIZE } });
      comp[`${preset}_${stage}${back ? '_backpass' : ''}`] = {
        comp_scale_0_1: await stats(at(0.1), base, 8), comp_scale_10: await stats(at(10), base, 8),
      };
    }
    check('fit_size_carries_presets_over_comp_scale', Object.values(comp).every((r) => Object.values(r).every((x) => x.pixelsOver8 <= 50)), comp,
      'A preset looks the same on the demo torus scaled 0.1 or 10 by its Geometry COMP, with Object size set to the demo\'s size times that scale (what Fit to Glass geometry sets) and the camera moved with it: the ripples (Lavender Prism, normal stage), the film bands (Prism Chrome, film stage) and the final image of four looks, one with the back-face pass, at most 50 pixels over 8/255. The pattern lookups are multiplied by the world scale, so Object size means the same world size for the patterns as for Thickness, Scene depth, Frost and Tint density (the family rule; Liquid Glass Lit\'s test, as in the core study).');
  }

  // ---------------------------------------------------------------- C9: demo backdrops
  {
    const checker = await diffRGBA({ backdropOnly: true, overrides: { Backdrop: 'checker' } }, { backdropOnly: true, backdropFrom: 'core-6a58487' });
    const type = await diffRGBA({ backdropOnly: true, overrides: { Backdrop: 'type' } }, { backdropOnly: true, backdropFrom: 'prism-6a58487-type' });
    const control = await diffRGBA({ backdropOnly: true, backdropFrom: 'prism-6a58487-checker' }, { backdropOnly: true, backdropFrom: 'core-6a58487' });
    const byDefault = await diffRGBA({ backdropOnly: true }, { backdropOnly: true, overrides: { Backdrop: 'type' } });
    check('backdrop_menu_matches_the_family', checker.max === 0 && type.max <= 1 && byDefault.max === 0 && control.pixelsOver2 > 1000,
      { checker_vs_core_6a58487: checker, type_vs_prism_6a58487: type, default_is_type: byDefault, control_old_prism_checker_vs_core: control },
      'Study > Demo backdrop: Checker is the core study\'s demo scene exactly (its 6a58487 backdrop), so contact sheets compare across the family; Type, the default, is this study\'s bold type on black (within 1/255: its smoothstep edges are now in increasing order). Control: the 6a58487 light checkerboard of this study differs from the core\'s on many pixels.');
  }

  await browser.close();
  const report = { ok: results.every((r) => r.ok) && !errors.length, passed: results.filter((r) => r.ok).length,
    total: results.length, errors, results,
    material: referenceRun ? 'checks/reference (commit 6a58487)' : 'delivered',
    scope: 'Shader maths and study.json bindings in WebGL2 (SwiftShader). Not a TouchDesigner render.' };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
})();
