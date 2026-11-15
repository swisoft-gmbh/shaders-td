// Property tests of the delivered GLSL, run through the WebGL2 preview.
//
//   node checks/preview_tests.cjs <port>     (serve the study folder on <port> first)
//   TESTS=name,name node checks/preview_tests.cjs <port>    (run only some tests)
//   node checks/preview_tests.cjs <port> --reference   (draw this study's material as it was at
//                                                       commit 6a58487, checks/reference/, to see
//                                                       which tests guard the family sync)
//
// Each test states a relationship that must hold whatever the look, e.g.
// "amplitude 0 renders exactly the core Liquid Glass". Renders compare pixels;
// geometry tests run only the vertex stage (transform feedback) and read every
// moved vertex. Several compare the shader with checks/flow_reference.cjs, a
// float64 copy of the field written from its definition. They test the shader
// maths and the study.json bindings in a browser GPU (SwiftShader), not
// TouchDesigner. Tests marked "family sync" come from the core study's audit
// rounds 2 and 3 and the family's merge items (review.md, Family sync); those
// marked "family close" from the family close (review.md, Family close).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { makeFlow, instanceSeed, NORMALS, NORMAL_STEP } = require('./flow_reference.cjs');

const QUIET = { Reflection: 0, Rim: 0, Specular: 0, Diffuse: 0, Iridescence: 0, Wobble: 0 };
const INVISIBLE = { ...QUIET, Ior: 1.0, Dispersion: 0, Frost: 0, Density: 0, Saturation: 1, Stage: 'final' };
// A busy field: every ingredient on, so the normal tests cover all of them.
const BUSY = { Amplitude: 0.15, Swell: 1.0, Swellscale: 1.0, Ripples: 0.3, Ripplescale: 5.0,
               Waves: 0.5, Wavelength: 1.0, Sag: 0.8, Drip: 0.6 };
// Object size 1: the family's reference size (the core's demo torus, radius 1.45). Since the family
// close the default here is 1 / 1.45, what Fit sets on the demo sphere. Tests whose stated numbers
// are glass lengths measured before the family close pin Object size 1, so they measure what they did.
const AT_REFERENCE_SIZE = { Objectsize: 1 };
const want = (name) => !process.env.TESTS || process.env.TESTS.split(',').includes(name);
const PRESETS = ['clear_crystal', 'prism_chrome', 'violet_gel', 'sapphire_drop', 'chrome_type', 'frosted_ice',
  'amber_honey', 'emerald_bottle', 'rose_quartz', 'liquid_mercury', 'oil_slick', 'aqua_jelly'];
const referenceRun = process.argv.includes('--reference');

(async () => {
  const port = process.argv[2];
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  async function open(study, size = [480, 270], setup = null) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    if (setup) await setup(page);
    await page.goto(`http://127.0.0.1:${port}/checks/preview/index.html?harness=1&study=${study}&w=${size[0]}&h=${size[1]}`);
    await page.evaluate(() => window.previewReady);
    if (referenceRun && study === 'flow') await page.evaluate(() => {  // every flow draw uses the 6a58487 material
      for (const k of ['draw', 'vertices', 'advance']) {
        const f = window.preview[k];
        window.preview[k] = (o = {}) => f({ ...o, reference: true });
      }
    });
    return page;
  }
  const flow = await open('flow');
  const [W, H] = await flow.evaluate(() => window.preview.size);
  const presets = await flow.evaluate(() => window.preview.presets);
  const study = await flow.evaluate(() => window.preview.study);
  const defaults = Object.fromEntries(study.controls.filter((c) => c.default != null).map((c) => [c.name, c.default]));

  const render = (page, opts) => page.evaluate((o) => { window.preview.draw(o); return Array.from(window.preview.pixels()); }, opts);
  const vertices = (opts) => flow.evaluate((o) => window.preview.vertices(o), opts);
  function compare(pa, pb) {
    let max = 0, over = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      max = Math.max(max, d); if (d > 2) over++;
    }
    return { max, pixelsOver2: over };
  }
  const coverage = (px) => { const c = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) c[i] = px[4 * i + 3] > 0 ? 1 : 0; return c; };
  const count = (c) => c.reduce((a, b) => a + b, 0);
  const xor = (a, b) => a.reduce((s, v, i) => s + (v !== b[i] ? 1 : 0), 0);
  // Uncovered pixels that cannot be reached from the image border: holes in the surface.
  function holes(c) {
    const seen = new Uint8Array(W * H), stack = [];
    const push = (x, y) => { const k = y * W + x; if (!c[k] && !seen[k]) { seen[k] = 1; stack.push(k); } };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
    while (stack.length) {
      const k = stack.pop(), x = k % W, y = (k - x) / W;
      if (x > 0) push(x - 1, y); if (x < W - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < H - 1) push(x, y + 1);
    }
    let n = 0; for (let k = 0; k < W * H; k++) if (!c[k] && !seen[k]) n++;
    return n;
  }
  const v3 = (a, k) => [a[3 * k], a[3 * k + 1], a[3 * k + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
  const angle = (a, b) => Math.acos(Math.min(1, dot(unit(a), unit(b)))) * 180 / Math.PI;
  const percentile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const stats = (xs) => ({ mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toPrecision(3),
                           p99: +percentile(xs, 0.99).toPrecision(3), max: +Math.max(...xs).toPrecision(3) });
  // Column-major 4x4 helpers (the preview's matrices).
  const point = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
  const mat3 = (m) => [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];  // columns
  const apply3 = (c, v) => [0, 1, 2].map((r) => c[0][r] * v[0] + c[1][r] * v[1] + c[2][r] * v[2]);
  const mul4 = (a, b) => { const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o; };
  // The cofactor matrix applied to n: proportional to the inverse transpose (normal transform).
  const cofactor = (m, n) => { const [c0, c1, c2] = mat3(m);
    const k0 = cross(c1, c2), k1 = cross(c2, c0), k2 = cross(c0, c1);
    return [0, 1, 2].map((r) => n[0] * k0[r] + n[1] * k1[r] + n[2] * k2[r]); };
  const inverse3 = (m) => { const [c0, c1, c2] = mat3(m), det = dot(c0, cross(c1, c2));  // rows of the inverse
    return [cross(c1, c2), cross(c2, c0), cross(c0, c1)].map((row) => row.map((x) => x / det)); };
  const applyRows = (rows, v) => rows.map((row) => dot(row, v));

  // Reference parameters for one preview call, as the shader would receive them.
  function reference(opts, v) {
    const p = { ...defaults, ...presets.presets[opts.preset].values, ...(opts.overrides || {}) };
    const it = (opts.instances || [{ id: 0 }])[0];
    const g = [p.Gravityx, p.Gravityy, p.Gravityz];
    let down = applyRows(inverse3(v.instance), applyRows(inverse3(v.world), g));
    down = Math.hypot(...down) > 1e-12 ? unit(down) : [0, 0, 0];
    const U = { amp: p.Amplitude, t: opts.time * p.Flowspeed, swell: p.Swell, swellscale: p.Swellscale,
      ripples: p.Ripples, ripplescale: p.Ripplescale, waves: p.Waves, wavelength: p.Wavelength,
      dir: [p.Wavedirx, p.Wavediry, p.Wavedirz], sag: p.Sag, drip: p.Drip, along: p.Displacealong,
      centre: [p.Flowcentrex, p.Flowcentrey, p.Flowcentrez], size: p.Flowsize, down,
      seed: instanceSeed(p.Instancevary, it.id ?? 0) };
    return { U, F: makeFlow(U), M: mul4(v.world, v.instance) };
  }
  // Shader output against the float64 reference, vertex by vertex.
  async function againstReference(opts, normalAt) {
    const v = await vertices(opts);
    const { U, F, M } = reference(opts, v);
    const pos = [], flowErr = [], normal = [], area = [];
    for (let k = 0; k < v.count; k++) {
      const rest = v3(v.rest, k), exact = F.normal(rest, normalAt);
      pos.push(Math.hypot(...sub(point(M, F.moved(rest, normalAt)), v3(v.vWorldPos, k))) / U.size);
      flowErr.push(Math.abs(F.flow(rest, normalAt) - v.vFlow[k]));
      normal.push(angle(cofactor(M, exact), v3(v.vWorldNormal, k)));
      area.push(Math.hypot(...exact) / (4 * NORMAL_STEP * NORMAL_STEP));  // moved patch area / rest area
    }
    return { vertices: v.count, flow_time: +U.t.toFixed(3), position_error_object_sizes: stats(pos),
             vflow_error: stats(flowErr), normal_error_deg: stats(normal),
             normals_over_5_deg: normal.filter((x) => x > 5).length,
             area_ratio: { min: +Math.min(...area).toPrecision(3), under_a_quarter: area.filter((x) => x < 0.25).length } };
  }

  const results = [];
  const check = (name, ok, evidence, claim) => {
    results.push({ name, ok, claim, evidence });
    process.stderr.write(`${ok ? 'pass' : 'FAIL'} ${name}\n`);  // progress; the report goes to stdout
  };

  // 1. Amplitude 0 reproduces the core study, for every preset, on the core's torus and on a sphere.
  if (want('amplitude0_matches_core')) {
    const core = await open('core');
    const rows = [];
    for (const preset of presets.order) {
      for (const mesh of ['torus', 'sphere']) {
        if (mesh === 'sphere' && !['prism_chrome', 'violet_gel', 'liquid_mercury'].includes(preset)) continue;
        const opts = { preset, time: 2, mesh, cameraZ: 5 };
        const a = await render(flow, { ...opts, overrides: { ...AT_REFERENCE_SIZE, Amplitude: 0 } });
        const b = await render(core, opts);
        rows.push({ preset, mesh, ...compare(a, b) });
      }
    }
    // The same Object size value in both, here 1.45 (both Fits on a torus 1.45 times the demo's).
    for (const preset of ['prism_chrome', 'amber_honey']) {
      const opts = { preset, time: 2, mesh: 'torus', cameraZ: 5 };
      const a = await render(flow, { ...opts, overrides: { Amplitude: 0, Objectsize: 1.45 } });
      rows.push({ preset, mesh: 'torus', object_size: 1.45, ...compare(a, await render(core, { ...opts, overrides: { Objectsize: 1.45 } })) });
    }
    // Family close G1: the torus scaled 3 by its Geometry COMP, each at what its own Fit sets there.
    // Object size has one meaning (world radius / 1.45), so both Fits give 3, and the ripple and film
    // lookups count the COMP's scale through the shared pixel stage. On c94e849 this study's Fit gave
    // 1.45 (half the SOP's side) and its pixel stage looked the patterns up in object space.
    for (const preset of ['aqua_jelly', 'oil_slick', 'prism_chrome']) {
      const opts = { preset, time: 2, mesh: 'torus', scale: 3, cameraZ: 15, far: 100 };
      const a = await render(flow, { ...opts, overrides: { Amplitude: 0, Objectsize: 3 } });
      rows.push({ preset, mesh: 'torus', comp_scale: 3, object_size: 3, ...compare(a, await render(core, { ...opts, overrides: { Objectsize: 3 } })) });
    }
    await core.close();
    // Family close G2: at the odd size 481 x 271 in a flipped raster the centre row sits exactly on the
    // centre line, where the core's tie-break decides the screen orientation. The same pixel stage
    // must give the same image there too.
    const flowOdd = await open('flow', [481, 271]), coreOdd = await open('core', [481, 271]);
    for (const preset of ['prism_chrome', 'chrome_type', 'sapphire_drop']) {
      const opts = { preset, time: 2, mesh: 'torus', cameraZ: 5, flipRaster: true };
      const a = await render(flowOdd, { ...opts, overrides: { ...AT_REFERENCE_SIZE, Amplitude: 0 } });
      rows.push({ preset, mesh: 'torus', odd_size_flipped_raster: '481x271', ...compare(a, await render(coreOdd, opts)) });
    }
    await flowOdd.close(); await coreOdd.close();
    const worst = Math.max(...rows.map((r) => r.max));
    check('amplitude0_matches_core', worst === 0, { renders: rows.length, worst_max_difference: worst, rows },
      'With Amplitude 0, every one of the 12 presets renders bit-identically to the current core Liquid Glass shaders (checks/core_reference: the core working tree after the family close) at the same settings on the core demo torus; three of them also on a sphere; two also with Object size 1.45 in both. Family close: three on the torus scaled 3 by its Geometry COMP, each at the Object size its own Fit sets there (3 in both: one meaning), and three at the odd size 481 x 271 in a flipped raster, where the centre row is decided by the core\'s centre-line tie-break.');
  }

  // 2. Amplitude 0 leaves every vertex exactly where TDDeform puts it, with TDDeformNorm's normal.
  if (want('amplitude0_vertex_identity')) {
    const v = await vertices({ preset: 'prism_chrome', time: 2, mesh: 'sphere', detail: 48, spin: 30, tilt: 20,
                               scale: [1.5, 0.8, 1.2], overrides: { Amplitude: 0 } });
    let maxP = 0, maxN = 0;
    for (let k = 0; k < v.count; k++) {
      maxP = Math.max(maxP, ...sub(point(v.world, v3(v.rest, k)), v3(v.vWorldPos, k)).map(Math.abs));
      maxN = Math.max(maxN, ...sub(unit(cofactor(v.world, v3(v.restNormal, k))), unit(v3(v.vWorldNormal, k))).map(Math.abs));
    }
    check('amplitude0_vertex_identity', maxP < 1e-5 && maxN < 1e-5, { vertices: v.count, max_position_error: maxP, max_normal_error: maxN },
      'With Amplitude 0, each vertex lands exactly at its transformed rest position, with the inverse-transpose normal (non-uniform scale 1.5, 0.8, 1.2).');
  }

  // 3. The motion, its Displacement-stage value and the rebuilt normals match the float64 reference.
  if (want('normals_match_finite_differences') || want('motion_matches_float64_reference')) {
    const sphere = NORMALS.sphere([0, 0, 0]);
    const still = { preset: 'prism_chrome', mesh: 'sphere', detail: 64, spin: 0, tilt: 0 };
    const cases = {
      busy: [{ ...still, time: 2, overrides: { ...BUSY } }, sphere],
      busy_rotated_nonuniform_scale: [{ ...still, time: 2, spin: 35, tilt: 20, scale: [1.6, 0.7, 1.1], overrides: { ...BUSY } }, sphere],
      finest_scales: [{ ...still, time: 2, overrides: { ...BUSY, Amplitude: 0.05, Swellscale: 4, Ripplescale: 16, Wavelength: 0.25 } }, sphere],
      waves_own_direction: [{ ...still, time: 3, overrides: { Amplitude: 0.12, Swell: 0, Ripples: 0, Waves: 1, Wavelength: 0.7,
                                                                 Wavedirx: 0.2, Wavediry: 1, Wavedirz: 0.5, Sag: 0, Drip: 0 } }, sphere],
      sag_and_drip: [{ ...still, time: 5, overrides: { Amplitude: 0.2, Swell: 0.5, Ripples: 0, Waves: 0, Sag: 1.2, Drip: 1 } }, sphere],
      instance_7_variation_1: [{ ...still, time: 2, instances: [{ id: 7 }], overrides: { ...BUSY, Instancevary: 1 } }, sphere],
      model_x10_off_origin: [{ ...still, time: 2, rest: { scale: 10, offset: [3, -2, 1] },
                               overrides: { ...BUSY, Objectsize: 10 * defaults.Objectsize, Flowsize: 10, Flowcentrex: 3, Flowcentrey: -2, Flowcentrez: 1 } }, NORMALS.sphere([3, -2, 1])],
      after_24_hours: [{ ...still, time: 86400, overrides: { ...BUSY } }, sphere],
      after_1_week_speed_0_9: [{ ...still, time: 604800, overrides: { ...BUSY, Flowspeed: 0.9 } }, sphere],
      // Amplitude at its slider maximum: the waves squeeze parts of the surface to under a quarter of
      // their rest area without folding it. Those normals are valid and must be rebuilt, not replaced
      // by the rest normal (verifier finding V1). The nudge's own step error grows where the surface is
      // squeezed, so this one case has a looser tolerance; a rest normal kept by mistake is 20 to 46 degrees off.
      squeezed_chrome_type_amplitude_0_5: [{ ...still, preset: 'chrome_type', time: 4, overrides: { Amplitude: 0.5 } }, sphere],
    };
    const TOLERANCE_DEG = { squeezed_chrome_type_amplitude_0_5: 1.0 };  // every other case: 0.5
    const tolerance = (name) => TOLERANCE_DEG[name] ?? 0.5;
    const out = {};
    for (const [name, [opts, normalAt]] of Object.entries(cases)) out[name] = await againstReference({ ...opts, overrides: { ...opts.overrides, Displacealong: 'centre' } }, normalAt);
    const worst = (f) => Math.max(...Object.values(out).map(f));
    const squeezed = out.squeezed_chrome_type_amplitude_0_5;
    check('normals_match_finite_differences',
      Object.entries(out).every(([k, r]) => r.normal_error_deg.max < tolerance(k)) && squeezed.area_ratio.under_a_quarter > 0,
      { tolerance_deg: { every_case: 0.5, ...TOLERANCE_DEG }, displace_along: 'centre', reference: 'float64 central differences of the moved surface (checks/flow_reference.cjs)',
        cases: Object.fromEntries(Object.entries(out).map(([k, r]) => [k, { flow_time: r.flow_time, ...r.normal_error_deg,
          normals_over_5_deg: r.normals_over_5_deg, area_ratio: r.area_ratio }])) },
      'In crack-free mode, the shader normal of every vertex of the displaced sphere is within 0.5 degrees of the float64 finite-difference normal of the moved surface: busy field, rotation with non-uniform scale, the finest control scales, an instance with variation, a 10x model away from the origin, and after 24 hours and a week of flow. At the Amplitude maximum (Chrome Type motion at 0.5, flow time 2), where the field squeezes some vertices to under a quarter of their rest area without folding the surface, every normal is within 1 degree: squeezed points keep their rebuilt normal.');
    check('motion_matches_float64_reference', worst((r) => r.position_error_object_sizes.max) < 1e-3 && worst((r) => r.vflow_error.max) < 0.01,
      { tolerance: { position_object_sizes: 1e-3, vflow: 0.01 },
        cases: Object.fromEntries(Object.entries(out).map(([k, r]) => [k, { vertices: r.vertices, flow_time: r.flow_time,
          position_error_object_sizes: r.position_error_object_sizes, vflow_error: r.vflow_error }])) },
      'Every vertex moves where the float64 field puts it, and the Displacement stage value (vFlow) matches, for each ingredient, the wave direction, drip, instance seed, Object size and Flow centre, a transformed object, and long run times (the wrapped flow time and folded noise drift give the same surface as the unwrapped field).');
  }

  // 4. Normal mode: positions are exact, normals approximate (the documented trade-off).
  if (want('normal_mode_error_is_bounded')) {
    const torus = NORMALS.torus(1.0), sphere = NORMALS.sphere([0, 0, 0]);
    const base = { mesh: 'torus', detail: 96, spin: 0, tilt: 0, time: 2 };
    const run = (preset, mesh, overrides, normalAt, along = 'normal') => againstReference(
      { ...base, preset, mesh, overrides: { ...overrides, Displacealong: along } }, normalAt);
    const out = {
      sphere_busy: await run('prism_chrome', 'sphere', BUSY, sphere),
      torus_busy: await run('prism_chrome', 'torus', BUSY, torus),
      torus_aqua_jelly: await run('aqua_jelly', 'torus', {}, torus),
      torus_liquid_mercury: await run('liquid_mercury', 'torus', {}, torus),
      torus_aqua_jelly_amplitude_0_5: await run('aqua_jelly', 'torus', { Amplitude: 0.5 }, torus),
      torus_aqua_jelly_crack_free: await run('aqua_jelly', 'torus', {}, torus, 'centre'),
    };
    const presetCases = ['sphere_busy', 'torus_busy', 'torus_aqua_jelly', 'torus_liquid_mercury'];
    const ok = presetCases.every((k) => out[k].normal_error_deg.p99 < 10 && out[k].normal_error_deg.max < 15
                                        && out[k].position_error_object_sizes.max < 1e-3)
      && out.torus_aqua_jelly_crack_free.normal_error_deg.max < 0.5
      && out.torus_aqua_jelly_amplitude_0_5.normal_error_deg.max > out.torus_aqua_jelly.normal_error_deg.max;
    check('normal_mode_error_is_bounded', ok,
      { bound_at_preset_amplitudes: { p99_deg: 10, max_deg: 15 },
        cases: Object.fromEntries(Object.entries(out).map(([k, r]) => [k, { normal_error_deg: r.normal_error_deg,
          position_error_object_sizes_max: r.position_error_object_sizes.max }])) },
      'Displace along Normal moves points exactly as defined, but rebuilds normals as if the surface were locally flat, so they are approximate: at preset amplitudes on the demo sphere and torus, 99% of vertices are within 10 degrees and all within 15 of the true normal of the moved surface; the error grows with Amplitude and curvature (recorded at 0.5, the control maximum). Crack-free mode on the same torus stays within 0.5 degrees.');
  }

  // 5. Silhouette coverage changes with amplitude.
  if (want('silhouette_coverage_changes')) {
    const cov = async (amp) => coverage(await render(flow, { preset: 'prism_chrome', time: 2, mesh: 'sphere', glassOnly: true,
      overrides: { Amplitude: amp, Stage: 'normal' } }));
    const c0 = await cov(0), c1 = await cov(0.06), c2 = await cov(0.18);
    const d1 = xor(c0, c1), d2 = xor(c0, c2);
    check('silhouette_coverage_changes', d1 > 0 && d2 > d1,
      { covered_px: { a0: count(c0), a006: count(c1), a018: count(c2) }, changed_px_vs_a0: { a006: d1, a018: d2 } },
      'The rendered alpha coverage (the silhouette) changes when Amplitude rises from 0, and changes more at a larger amplitude.');
  }

  // 6. Coincident vertices with different normals stay together in crack-free mode.
  if (want('crack_free_keeps_coincident_vertices_together')) {
    const spread = async (along) => {
      const v = await vertices({ preset: 'clear_crystal', time: 2, mesh: 'box', detail: 64, spin: 25, tilt: 20,
                                 overrides: { ...BUSY, Displacealong: along } });
      const groups = new Map();
      for (let k = 0; k < v.count; k++) {
        const key = v3(v.rest, k).map((x) => Math.round(x * 1e4)).join(',');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(k);
      }
      let shared = 0, max = 0;
      for (const ks of groups.values()) {
        if (ks.length < 2) continue;
        shared++;
        for (const k of ks.slice(1)) max = Math.max(max, Math.hypot(...sub(v3(v.vWorldPos, k), v3(v.vWorldPos, ks[0]))));
      }
      return { shared_positions: shared, max_gap: max };
    };
    const centre = await spread('centre'), normal = await spread('normal');
    const pic = async (along) => holes(coverage(await render(flow, { preset: 'clear_crystal', time: 2, mesh: 'box', detail: 64,
      spin: 25, glassOnly: true, overrides: { ...BUSY, Displacealong: along, Stage: 'normal' } })));
    const holesCentre = await pic('centre'), holesNormal = await pic('normal');
    check('crack_free_keeps_coincident_vertices_together', centre.max_gap < 1e-5 && normal.max_gap > 0.01 && holesCentre === 0 && holesNormal > 0,
      { box_divisions: 16, crack_free: { ...centre, holes_px: holesCentre }, along_normal: { ...normal, holes_px: holesNormal } },
      'On a box whose edges and corners repeat each position with different normals, crack-free mode moves all copies of a position identically (gap under 1e-5) and the render has no holes; along-the-normal mode separates them and holes appear.');
  }

  // 7. A point at Flow centre does not spike out of an open sheet in crack-free mode.
  if (want('centre_point_stays_on_sheet')) {
    const v = await vertices({ preset: 'prism_chrome', time: 2, mesh: 'grid', detail: 128, spin: 0, tilt: 0,
                               overrides: { Displacealong: 'centre' } });
    let atCentre = -1, maxOut = 0;
    for (let k = 0; k < v.count; k++) {
      maxOut = Math.max(maxOut, Math.abs(v.vWorldPos[3 * k + 2]));
      if (Math.hypot(...v3(v.rest, k)) < 1e-6) atCentre = k;
    }
    check('centre_point_stays_on_sheet', atCentre >= 0 && maxOut < 1e-6,
      { vertices: v.count, vertex_at_centre: atCentre, max_out_of_plane: maxOut },
      'On the demo grid through Flow centre, crack-free mode only slides points within the sheet: no vertex leaves the plane, including the one exactly at the centre (its direction fades to zero there).');
  }

  // 8. The moved glass still obeys the core's invisibility rule.
  if (want('moving_glass_at_ior1_is_invisible')) {
    const d = compare(await render(flow, { preset: 'clear_crystal', time: 2, mesh: 'sphere', overrides: { ...INVISIBLE, ...BUSY } }),
                      await render(flow, { backdropOnly: true }));
    check('moving_glass_at_ior1_is_invisible', d.max <= 2, d,
      'Even while the surface moves (busy field), glass with IOR 1 and no tint, dispersion or light terms shows exactly the refraction TOP.');
  }

  // 9. The pixel shader is the core's plus the documented additions, also while the surface moves.
  if (want('pixel_stage_matches_core_while_moving')) {
    const hybrid = await open('hybrid');
    const rows = [];
    for (const [preset, overrides] of [['prism_chrome', {}], ['sapphire_drop', {}], ['oil_slick', { ...BUSY }], ['violet_gel', { Backface: true }]]) {
      const opts = { preset, time: 2, mesh: 'sphere', overrides: { ...overrides, Stage: 'final' } };
      rows.push({ preset, ...compare(await render(flow, opts), await render(hybrid, opts)) });
    }
    await hybrid.close();
    const worst = Math.max(...rows.map((r) => r.max));
    check('pixel_stage_matches_core_while_moving', worst === 0, { worst_max_difference: worst, rows },
      'With the surface moving, the flow pixel shader renders the final image bit-identically to the current core pixel shader (checks/core_reference) fed by the same flow vertex shader, with the back-face pass off and on: the additions change nothing outside the Displacement stage.');
  }

  // 10. Correct normals changes shading only, never the silhouette.
  if (want('correct_normals_changes_shading_not_silhouette')) {
    const base = { preset: 'prism_chrome', time: 2, mesh: 'sphere', glassOnly: true };
    const on = await render(flow, { ...base, overrides: { ...BUSY, Stage: 'normal', Correctnormals: true } });
    const off = await render(flow, { ...base, overrides: { ...BUSY, Stage: 'normal', Correctnormals: false } });
    const shade = compare(on, off);
    check('correct_normals_changes_shading_not_silhouette', xor(coverage(on), coverage(off)) === 0 && shade.pixelsOver2 > 1000,
      { coverage_changed_px: xor(coverage(on), coverage(off)), shading: shade },
      'Turning Correct normals off keeps the same moved outline (identical coverage) but changes the normals, so shading differs.');
  }

  // 11. Geometry without normals still moves and renders.
  if (want('no_normals_falls_back')) {
    const v = await vertices({ preset: 'prism_chrome', time: 2, mesh: 'sphere_nonormals', detail: 48, overrides: { ...BUSY } });
    let moved = 0, normal = 0;
    for (let k = 0; k < v.count; k++) {
      moved = Math.max(moved, Math.hypot(...sub(v3(v.vWorldPos, k), point(v.world, v3(v.rest, k)))));
      normal = Math.max(normal, Math.hypot(...v3(v.vWorldNormal, k)));
    }
    const opts = { preset: 'prism_chrome', time: 2, glassOnly: true, spin: 0, tilt: 0, overrides: { ...BUSY } };
    const withN = await render(flow, { ...opts, mesh: 'sphere' });
    const without = await render(flow, { ...opts, mesh: 'sphere_nonormals' });
    let lit = 0, n = 0;
    for (let i = 0; i < without.length; i += 4) if (without[i + 3] > 0) { lit += without[i] + without[i + 1] + without[i + 2]; n++; }
    const tv = await vertices({ preset: 'prism_chrome', time: 2, mesh: 'sphere', detail: 48, spin: 0, tilt: 0, overrides: { ...BUSY } });
    const tn = await vertices({ preset: 'prism_chrome', time: 2, mesh: 'sphere_nonormals', detail: 48, spin: 0, tilt: 0, overrides: { ...BUSY } });
    let same = 0; for (let i = 0; i < tv.vWorldPos.length; i++) same = Math.max(same, Math.abs(tv.vWorldPos[i] - tn.vWorldPos[i]));
    check('no_normals_falls_back', moved > 0.01 && normal === 0 && same < 1e-5 && xor(coverage(withN), coverage(without)) === 0 && lit / n > 30,
      { max_vertex_motion: moved, max_world_normal_length: normal, max_position_difference_vs_with_normals: same,
        coverage_changed_px: xor(coverage(withN), coverage(without)), mean_rgb_sum_inside: +(lit / n).toFixed(1) },
      'A sphere with zero normals still moves, exactly like one with normals in crack-free mode, hands a zero normal to the pixel stage (which builds faceted normals), keeps the same outline and renders a lit, non-black object.');
  }

  // 12. Instance variation.
  if (want('instance_variation')) {
    const run = (vary, id) => vertices({ preset: 'prism_chrome', time: 2, mesh: 'sphere', detail: 32,
      instances: [{ t: [0, 0, 0], s: 1, id }], overrides: { ...BUSY, Instancevary: vary } });
    const diff = (a, b) => a.vWorldPos.reduce((m, x, i) => Math.max(m, Math.abs(x - b.vWorldPos[i])), 0);
    const same = diff(await run(0, 0), await run(0, 7));
    const differ = diff(await run(1, 0), await run(1, 7));
    check('instance_variation', same === 0 && differ > 0.01, { variation0_max_difference: same, variation1_max_difference: differ },
      'With Instance variation 0, instance 7 moves exactly like instance 0; with variation 1 it moves differently.');
  }

  // 13. Gravity points down in the world, through the object's and the instance's rotation and scale.
  if (want('gravity_stays_world_down')) {
    const v = await vertices({ preset: 'prism_chrome', time: 2, mesh: 'sphere', detail: 48, spin: 35, tilt: 20, scale: [1.3, 0.8, 1.1],
      instances: [{ t: [0.3, 0, 0], r: [30, 50, 70], s: 0.8, id: 0 }],
      overrides: { Amplitude: 0.2, Swell: 0, Ripples: 0, Waves: 0, Sag: 1.0, Drip: 0 } });
    const M = mul4(v.world, v.instance);
    const angles = [];
    let moved = 0;
    for (let k = 0; k < v.count; k++) {
      const d = sub(v3(v.vWorldPos, k), point(M, v3(v.rest, k)));
      moved = Math.max(moved, Math.hypot(...d));
      if (Math.hypot(...d) > 1e-3) angles.push(angle(d, [0, -1, 0]));
    }
    check('gravity_stays_world_down', moved > 0.05 && angles.length > 100 && Math.max(...angles) < 0.5,
      { sagging_vertices: angles.length, max_sag: moved, angle_to_world_down_deg: stats(angles) },
      'With Sag only, on a spinning, tilted, unevenly scaled object drawn as a rotated and scaled instance, every vertex sinks straight down in world space (within 0.5 degrees).');
  }

  // 14. Flow time follows Flow speed: it stops at speed 0, and changing the speed never jumps the surface.
  if (want('flow_time_follows_speed')) {
    const base = { preset: 'prism_chrome', mesh: 'sphere', detail: 48, spin: 0, tilt: 0 };
    const maxTravel = (a, b) => a.vWorldPos.reduce((m, x, i) => Math.max(m, Math.abs(x - b.vWorldPos[i])), 0);
    const stopped = maxTravel(await vertices({ ...base, time: 100, overrides: { Flowspeed: 0 } }),
                              await vertices({ ...base, time: 200, overrides: { Flowspeed: 0 } }));
    const moving = maxTravel(await vertices({ ...base, time: 100 }), await vertices({ ...base, time: 101 }));
    // One 60 fps frame in the middle of a 2 s Morph from Prism Chrome (speed 0.45) to Amber Honey
    // (0.18), with the clock integrating as in presets.py, against a frame of the half-way look held still.
    const meanTravel = (a, b) => { let s = 0; for (let k = 0; k < a.count; k++) s += Math.hypot(...sub(v3(a.vWorldPos, k), v3(b.vWorldPos, k))); return s / a.count; };
    async function transition(start) {
      const frame = (f, morph) => ({ ...base, integrate: true, time: start + f / 60, overrides: { Pause: false, Morphtarget: 'amber_honey', Morph: morph } });
      await flow.evaluate(() => window.preview.resetClocks());
      for (let f = 0; f < 60; f++) await flow.evaluate((o) => window.preview.advance(o), frame(f, f / 120));
      const morphing = meanTravel(await vertices(frame(60, 0.5)), await vertices(frame(61, 61 / 120)));
      await flow.evaluate(() => window.preview.resetClocks());
      const still = meanTravel(await vertices(frame(60, 0.5)), await vertices(frame(61, 0.5)));
      return { morphing_frame_mean_travel: +morphing.toPrecision(3), still_frame_mean_travel: +still.toPrecision(3), ratio: +(morphing / still).toFixed(2) };
    }
    const early = await transition(2), late = await transition(3600), day = await transition(86400);
    const steady = (r) => r.morphing_frame_mean_travel < 2 * early.morphing_frame_mean_travel
                          && r.morphing_frame_mean_travel > 0.5 * early.morphing_frame_mean_travel && r.ratio < 10;
    const ok = stopped === 0 && moving > 0.005 && steady(early) && steady(late) && steady(day);
    check('flow_time_follows_speed', ok,
      { flow_speed_0_max_motion_over_100_s: stopped, flow_speed_default_max_motion_over_1_s: +moving.toPrecision(3),
        morph_after_2_s: early, morph_after_1_hour: late, morph_after_24_hours: day },
      'Flow time is Flow speed added up frame by frame: with Flow speed 0 the surface stands still, and during an animated Morph between presets with different speeds the surface moves about as fast after an hour or a day of uptime as after 2 seconds (per-frame travel within 2x of it, and under 10x a frame of the half-way look held still).');
  }

  // 15. Presets and morph reach the motion too.
  if (want('morph_endpoints')) {
    let d = compare(await render(flow, { preset: 'prism_chrome', time: 2, overrides: { Morphtarget: 'amber_honey', Morph: 1 } }),
                    await render(flow, { preset: 'amber_honey', time: 2 }));
    check('morph1_equals_target', d.max <= 2, d, 'Morph 1 toward a preset renders that preset, motion included.');
    d = compare(await render(flow, { preset: 'violet_gel', time: 2, overrides: { Morphtarget: 'aqua_jelly', Morph: 0 } }),
                await render(flow, { preset: 'violet_gel', time: 2 }));
    check('morph0_is_neutral', d.max <= 2, d, 'Morph 0 leaves the current look and motion unchanged.');
  }

  // ======================================================================== family sync
  // In-page comparisons (no pixel arrays cross into Node). All on the flow page.
  const diff = (a, b) => flow.evaluate(([a, b]) => {
    window.preview.draw(a); const pa = window.preview.pixels().slice();
    window.preview.draw(b); const pb = window.preview.pixels();
    let max = 0, over = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      max = Math.max(max, d); if (d > 2) over++;
    }
    return { max, pixelsOver2: over };
  }, [a, b]);
  const stats8 = (a, b, threshold = 8) => flow.evaluate(([a, b, threshold]) => {
    window.preview.draw(a); const pa = window.preview.pixels().slice();
    window.preview.draw(b); const pb = window.preview.pixels();
    const ds = []; let max = 0, over = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      if (d > 0) ds.push(d); max = Math.max(max, d); if (d > threshold) over++;
    }
    ds.sort((x, y) => x - y);
    const total = pa.length / 4;
    const p99 = ds.length > total * 0.01 ? ds[ds.length - Math.ceil(total * 0.01)] : 0;
    return { max, [`pixelsOver${threshold}`]: over, p99OfAllPixels: p99 };
  }, [a, b, threshold]);
  const diffRGBA = (a, b) => flow.evaluate(([a, b]) => {
    window.preview.draw(a); const pa = window.preview.pixels().slice();
    window.preview.draw(b); const pb = window.preview.pixels();
    let max = 0, over = 0, alphaMax = 0;
    for (let i = 0; i < pa.length; i += 4) {
      let d = 0;
      for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(pa[i + k] - pb[i + k]));
      alphaMax = Math.max(alphaMax, Math.abs(pa[i + 3] - pb[i + 3]));
      max = Math.max(max, d); if (d > 2) over++;
    }
    return { max, alphaMax, pixelsOver2: over };
  }, [a, b]);
  const pixelsAt = (opts, points) => flow.evaluate(([opts, points]) => {
    window.preview.draw(opts); const p = window.preview.pixels(); const [W] = window.preview.size;
    return points.map(([x, y]) => Array.from(p.slice((y * W + x) * 4, (y * W + x) * 4 + 4)));
  }, [opts, points]);

  // R1: consecutive frames (drift: 'continue') while Morph moves, an hour into a session.
  if (want('morph_frame_is_smooth_after_an_hour') || want('speed_change_is_smooth_after_an_hour')) {
    const frames = (a, b) => stats8({ spin: 0, ...a }, { spin: 0, ...b, drift: 'continue' });
    const morphFrame = (stage, T) => frames(
      { preset: 'prism_chrome', time: T, overrides: { Stage: stage, Morphtarget: 'violet_gel', Morph: 0.5 } },
      { preset: 'prism_chrome', time: T + 1 / 60, overrides: { Stage: stage, Morphtarget: 'violet_gel', Morph: 0.51 } });
    const morph = {};
    for (const stage of ['final', 'film']) for (const T of [2, 3600]) morph[`${stage}_t${T}`] = await morphFrame(stage, T);
    check('morph_frame_is_smooth_after_an_hour',
      ['final', 'film'].every((st) => morph[`${st}_t3600`].max <= morph[`${st}_t2`].max + 12
        && morph[`${st}_t3600`].p99OfAllPixels <= morph[`${st}_t2`].p99OfAllPixels + 3), morph,
      'Family sync R1. One frame of a 100-frame A/B morph (Morph 0.50 to 0.51 in 1/60 s, Prism Chrome to Violet Gel: Flow speed and Wobble speed both change) changes the image no more after an hour than after 2 s: flow time and the ripple and film drift are integrated, so changing a speed never throws the pattern.');
    const jelly = (T, speed) => ({ preset: 'aqua_jelly', time: T, overrides: { Stage: 'normal', Wobblespeed: speed, Flowspeed: speed } });
    const steady = await frames(jelly(3600, 0.6), jelly(3600 + 1 / 60, 0.6));
    const nudged = await frames(jelly(3600, 0.6), jelly(3600 + 1 / 60, 0.61));
    check('speed_change_is_smooth_after_an_hour', nudged.max <= Math.max(steady.max, 2) + 2, { steady, nudged },
      'Family sync R1. After an hour, nudging Wobble speed and Flow speed from 0.60 to 0.61 changes one frame no more than one frame of motion at a fixed speed does (Aqua Jelly, normal stage).');
  }

  // R1: the ripple and film drift is wrapped in double precision, so after about a week it repeats exactly.
  if (want('ripples_and_film_exact_after_a_week')) {
    const rows = {};
    for (const [preset, stage] of [['aqua_jelly', 'normal'], ['oil_slick', 'film']]) {
      const speed = presets.presets[preset].values.Wobblespeed;
      const period = 5120 / speed;  // every drift rate (0.6, 0.4, -0.3, 0.15) x speed x period is a whole number of 256-unit repeats
      const week = 2 + Math.round(604800 / period) * period;
      const o = (time) => ({ preset, time, spin: 0, overrides: { Stage: stage, Amplitude: 0 } });
      rows[`${preset}_${stage}`] = { seconds: +week.toFixed(3), ...(await stats8(o(week), o(2))) };
    }
    check('ripples_and_film_exact_after_a_week', Object.values(rows).every((r) => r.max <= 2), rows,
      'Family sync R1. About a week into a session (a whole number of drift periods later), the ripples (Aqua Jelly, normal stage) and the oil film (Oil Slick, film stage) render exactly as at 2 s: the drift reaches the shader wrapped to 0..256, so float32 never rounds it. (Amplitude 0 isolates the pixel stage; the liquid motion has its own week-long test, normals_match_finite_differences.)');
  }

  // R5: wobble after the silhouette fix, wobble and faceted normals independent of scale.
  if (want('ior1_is_invisible_with_wobble')) {
    const d = await diff({ preset: 'clear_crystal', time: 2, mesh: 'sphere', overrides: { ...INVISIBLE, ...BUSY, Wobble: 0.6, Wobblescale: 1.6, Wobblespeed: 0.6 } },
                         { backdropOnly: true });
    check('ior1_is_invisible_with_wobble', d.max <= 2, d,
      'Family sync R5. Ripples do not undo the silhouette fix: at IOR 1 the moving, rippled glass is still invisible (normals are turned toward the camera again after the wobble).');
  }
  if (want('wobble_independent_of_object_scale')) {
    // Since the family close (G1) the ripples count the COMP's scale, so Object size is set to the
    // scale times the default, as Fit to Glass geometry sets it (the core and Lit made the same change).
    const ripples = { preset: 'aqua_jelly', time: 2, overrides: { Stage: 'normal', Wobble: 0.6 } };
    const fitted = (k) => ({ ...ripples.overrides, Objectsize: k * defaults.Objectsize });
    const small = await stats8({ ...ripples, scale: 0.1, cameraZ: 0.4, near: 0.01, overrides: fitted(0.1) }, ripples);
    const large = await stats8({ ...ripples, scale: 10, cameraZ: 40, far: 200, overrides: fitted(10) }, ripples);
    check('wobble_independent_of_object_scale', small.max <= 12 && large.max <= 12 && small.pixelsOver8 <= 50 && large.pixelsOver8 <= 50,
      { scale01: small, scale10: large },
      'Family sync R5. With the Geometry COMP scaled 0.1 or 10, the camera moved with it and Object size set to the scale times the default (what Fit to Glass geometry sets since the family close), the moving, rippled sphere looks the same as at scale 1 (normal stage): Wobble tilts the normals by the same amount at any object scale.');
  }
  if (want('faceted_fallback_is_scale_free')) {
    const faceted = { preset: 'prism_chrome', time: 2, mesh: 'sphere_nonormals', overrides: { Stage: 'normal' } };
    const r = await stats8({ ...faceted, scale: 0.1, cameraZ: 0.4, near: 0.01,
                             overrides: { Stage: 'normal', Objectsize: 0.1 * defaults.Objectsize } }, faceted);  // as Fit sets it
    check('faceted_fallback_is_scale_free', r.max <= 12 && r.pixelsOver8 <= 50, r,
      'Family sync R5. A moving sphere without normals gets the same faceted normals at Geometry COMP scale 0.1 as at 1 (derivatives taken at the top of main(), relative degeneracy threshold).');
  }

  // R6: frost samples on the R2 disc average near its centre, so frost blurs without shifting the view.
  // UV-ramp backdrop, IOR 1, no dispersion: the mean sampled position over the glass minus the pixel's own.
  if (want('frost_does_not_shift_the_view')) {
    const frostShift = (samples) => flow.evaluate(([samples, INVISIBLE, AT_REFERENCE_SIZE]) => {
      const [W, H] = window.preview.size;
      const frosted = (frost) => { window.preview.draw({ preset: 'clear_crystal', time: 2, mesh: 'sphere', uvBackdrop: true, probe: true,
        overrides: { ...INVISIBLE, ...AT_REFERENCE_SIZE, Stage: 'refraction', Frost: frost, Samples: samples } }); return window.preview.lastProbe().slice(); };
      const a = frosted(0), b = frosted(1);
      let n = 0, du = 0, dv = 0;
      for (let y = H / 2 - 50; y < H / 2 + 50; y++) for (let x = W / 2 - 50; x < W / 2 + 50; x++) {
        const i = 4 * (y * W + x); if (a[i + 3] < 1 || b[i + 3] < 1) continue;
        n++; du += (b[i] - a[i]) * W; dv += (b[i + 1] - a[i + 1]) * H;
      }
      return { samples, pixels: n, meanShiftPixels: +Math.hypot(du / n, dv / n).toFixed(3) };
    }, [samples, INVISIBLE, AT_REFERENCE_SIZE]);
    const shift = [await frostShift(12), await frostShift(24)];
    check('frost_does_not_shift_the_view', shift.every((r) => r.pixels > 5000 && r.meanShiftPixels < 1.5), shift,
      'Family sync R6. Frost 1 blurs the view through the moving sphere without moving it: over a UV-ramp scene at IOR 1, the mean sampled position stays within 1.5 pixels of the unfrosted one at 12 and 24 samples (R2 disc). The 6a58487 golden-angle disc put its samples on one spiral arm, whose average sits off centre.');
  }
  // R6: frost is a continuous blur at the default sample count.
  if (want('frost_converges_with_samples')) {
    const frosted = (n) => ({ preset: 'clear_crystal', time: 2, mesh: 'sphere', overrides: { ...AT_REFERENCE_SIZE, Stage: 'refraction', Dispersion: 0, Frost: 0.6, Samples: n } });
    const frost = await stats8(frosted(12), frosted(32), 16);
    check('frost_converges_with_samples', frost.max <= 24 && frost.p99OfAllPixels <= 12, frost,
      'Family sync R6. Frost 0.6 is a continuous blur on the moving sphere: 12 and 32 samples agree within 24/255 at every pixel (99% of pixels within 12/255). Without the mipmap level as wide as the gap between samples, separate copies show (see review.md for the mutant). The core\'s bound of 16/255, measured on its torus, does not hold on this sphere: 19 now, 16 with the 6a58487 disc.');
  }

  // C3 (rejected; this test guards the decision): 12 samples already match 64 closely.
  if (want('dispersion_converges_with_samples')) {
    const dispersed = {};
    for (const preset of ['clear_crystal', 'prism_chrome']) for (const thick of [null, 2.5]) {
      dispersed[`${preset}_thickness_${thick ?? 'preset'}`] = await flow.evaluate(([preset, thick, AT_REFERENCE_SIZE]) => {
        const o = (n) => ({ preset, time: 2, mesh: 'sphere', spin: 0, sampleCap: n > 32 ? n : undefined,
          overrides: { ...AT_REFERENCE_SIZE, Stage: 'refraction', Dispersion: 1, Samples: n, ...(thick ? { Thickness: thick } : {}) } });
        const grab = (opts) => { window.preview.draw(opts); return window.preview.pixels().slice(); };
        const bg = grab({ backdropOnly: true }), a = grab(o(12)), b = grab(o(64));
        const d = (x, y, i) => Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
        let glass = 0, sum = 0, over32 = 0, max = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (d(b, bg, i) === 0 && d(a, bg, i) === 0) continue;
          glass++; const e = d(a, b, i); sum += e; max = Math.max(max, e); if (e > 32) over32++;
        }
        return { glass_pixels: glass, mean: +(sum / glass).toFixed(2), max, pixelsOver32: over32 };
      }, [preset, thick, AT_REFERENCE_SIZE]);
    }
    check('dispersion_converges_with_samples',
      Object.entries(dispersed).every(([k, r]) => r.pixelsOver32 === 0 && r.mean <= (k.endsWith('2.5') ? 2.5 : 1.0)), dispersed,
      'Family sync C3 (rejected). Dispersion 1 at the default 12 samples agrees with a 64-sample render on the moving sphere: no glass pixel differs by more than 32/255, and the mean difference stays within 1/255 (2.5/255 with Thickness 2.5), on Clear Crystal and Prism Chrome (refraction stage). The fan-gap mip level measured worse (checks/results/c3-fan-gap.json).');
  }

  // R7: back-face pass in 32-bit float, read with the masked texelFetch filter, distances along the ray.
  if (want('backface_thickness_matches_chord') || want('backface_pass_adds_no_dark_fringe')) {
    const aspect = W / H, y = Math.floor(H / 2);
    const chordTest = async (view, offsets, thickness) => {
      const cols = offsets.map((dx) => Math.floor(W / 2) + dx);
      const measured = await pixelsAt({ preset: 'clear_crystal', time: 2, mesh: 'sphere', spin: 0, tilt: 0, ...view,
        overrides: { ...AT_REFERENCE_SIZE, Backface: true, Stage: 'thickness', Thickness: thickness, Wobble: 0, Amplitude: 0 } }, cols.map((x) => [x, y]));
      return cols.map((x, i) => {
        const nx = ((x + 0.5) / W) * 2 - 1, ny = ((y + 0.5) / H) * 2 - 1;
        let dist;  // distance from the sphere centre to the pixel's ray
        if (view.ortho) dist = Math.hypot(nx * view.ortho * aspect, ny * view.ortho);
        else {
          const t = Math.tan((view.fov ?? 45) * Math.PI / 360);
          const dir = [nx * t * aspect, ny * t, -1]; const l = Math.hypot(...dir);
          dist = (view.cameraZ ?? 4) * Math.hypot(dir[0], dir[1]) / l;
        }
        const chord = dist < 1 ? 2 * Math.sqrt(1 - dist * dist) : 0;
        const expected = Math.min(chord / (2 * thickness), 1) * 255;
        return { x, expected: +expected.toFixed(1), measured: measured[i][0], chord: +chord.toFixed(4) };
      });
    };
    const near = await chordTest({}, [0, 20, 40, 55, 64], 2.0);
    const farFov = 2 * Math.atan(Math.tan(22.5 * Math.PI / 180) * 4 / 50) * 180 / Math.PI;
    const far = await chordTest({ fov: farFov, cameraZ: 50, far: 200 }, [0, 8, 16, 24, 32, 40, 48, 56, 64], 1.0);
    const ortho = await chordTest({ ortho: 1.5, cameraZ: 1.5, near: 0.01 }, [0, 15, 30, 45, 60, 75, 82], 1.0);
    const within = (rows, k) => rows.every((r) => Math.abs(r.expected - r.measured) <= k);
    check('backface_thickness_matches_chord', within(near, 3) && within(far, 2) && within(ortho, 3), { camera_4_units: near, camera_50_units: far, orthographic: ortho },
      'Family sync R7. With the back-face pass (Amplitude 0, unit sphere), measured thickness equals the exact chord along each pixel\'s ray: 4 units away within 3/255, 50 units away with a narrow lens within 2/255 (distances stored as 32-bit floats), and along the parallel rays of an orthographic camera within 3/255.');
    const GREY = [0.5, 0.5, 0.5];
    const d = await diff({ preset: 'clear_crystal', time: 2, mesh: 'knot', flatBackdrop: GREY,
                           overrides: { ...QUIET, Backface: true, Ior: 1.5, Density: 0 } }, { backdropOnly: true, flatBackdrop: GREY });
    check('backface_pass_adds_no_dark_fringe', d.max <= 2, d,
      'Family sync R7. Over a uniform grey scene, clear moving glass with the back-face pass stays exactly grey: the back-face lookup (texelFetch, bilinear over covered texels only) never blends in the empty background (knot, IOR 1.5).');
  }

  // R8: Energy conserving and Colour parameters.
  if (want('energy_conserving_mirror_is_pure_reflection')) {
    const mirror = { ...QUIET, Reflection: 1, Mirror: 1, Conserve: true };
    const d = await diff({ preset: 'clear_crystal', time: 2, mesh: 'sphere', overrides: { ...mirror, Stage: 'final' } },
                         { preset: 'clear_crystal', time: 2, mesh: 'sphere', overrides: { ...mirror, Stage: 'reflection' } });
    check('energy_conserving_mirror_is_pure_reflection', d.max <= 2, d,
      'Family sync R8. With Energy conserving on and Mirror 1, nothing shows through the moving glass: the final image equals the reflection stage.');
  }
  if (want('srgb_colour_mode_decodes_colours')) {
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const v = presets.presets.violet_gel.values;
    const d = await diff({ preset: 'violet_gel', time: 2, overrides: { Stage: 'body', Colourspace: 'srgb' } },
                         { preset: 'violet_gel', time: 2, overrides: { Stage: 'body', Colourspace: 'raw',
                           Glasscolorr: lin(v.Glasscolorr), Glasscolorg: lin(v.Glasscolorg), Glasscolorb: lin(v.Glasscolorb),
                           Lightcolorr: lin(v.Lightcolorr), Lightcolorg: lin(v.Lightcolorg), Lightcolorb: lin(v.Lightcolorb) } });
    check('srgb_colour_mode_decodes_colours', d.max <= 2, d,
      'Family sync R8. Colour parameters set to sRGB render like the same colours converted to linear by hand (Violet Gel, body stage).');
  }

  // C1: the Refraction TOP's alpha.
  if (want('transparent_scene_stays_transparent') || want('empty_scene_matches_no_refraction_top')) {
    const EMPTY = [0, 0, 0, 0];
    const empty = await diffRGBA({ preset: 'clear_crystal', time: 2, mesh: 'sphere', flatBackdrop: EMPTY, overrides: { ...INVISIBLE, ...BUSY } },
                                 { backdropOnly: true, flatBackdrop: EMPTY });
    const emptyBack = await diffRGBA({ preset: 'clear_crystal', time: 2, mesh: 'sphere', flatBackdrop: EMPTY, overrides: { ...INVISIBLE, ...BUSY, Backface: true } },
                                     { backdropOnly: true, flatBackdrop: EMPTY });
    check('transparent_scene_stays_transparent', empty.max <= 2 && emptyBack.max <= 2, { alpha_0_scene: empty, alpha_0_scene_backface_pass: emptyBack },
      'Family sync C1. Over a Refraction TOP with a transparent background (alpha 0), invisible moving glass (IOR 1, no tint or light terms, busy field) leaves the image exactly as the scene, colour and alpha, with the back-face pass off and on. The 6a58487 material wrote alpha 1 and turned the empty background opaque black.');
    const tinted = { preset: 'violet_gel', time: 2, flatBackdrop: EMPTY };
    const d = await diffRGBA(tinted, { ...tinted, refraction: false });
    check('empty_scene_matches_no_refraction_top', d.max <= 2, d,
      'Family sync C1. Where the Refraction TOP is empty (alpha 0), the moving glass blends exactly as with no Refraction TOP connected (Violet Gel, colour and alpha): one formula covers both.');
  }
  if (want('opaque_scene_matches_pre_sync')) {
    // Pixels in the two centre columns and rows are counted apart: there the measured screen
    // orientation (C6) compares a pixel's projected point with a raster position less than a
    // pixel from 0, and an antialiased silhouette pixel, shaded at its centre outside its
    // triangle, can land on the other side (review.md, Family sync, C6).
    const versus = (a, b) => flow.evaluate(([a, b]) => {
      window.preview.draw(a); const pa = window.preview.pixels().slice();
      window.preview.draw(b); const pb = window.preview.pixels();
      const [W, H] = window.preview.size;
      let max = 0, alphaMax = 0, centreLinePixelsOver1 = 0, centreLineMax = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const x = (i / 4) % W, y = Math.floor(i / 4 / W);
        let d = 0; for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(pa[i + k] - pb[i + k]));
        alphaMax = Math.max(alphaMax, Math.abs(pa[i + 3] - pb[i + 3]));
        if (x === W / 2 || x === W / 2 - 1 || y === H / 2 || y === H / 2 - 1) {
          centreLineMax = Math.max(centreLineMax, d); if (d > 1) centreLinePixelsOver1++;
        } else max = Math.max(max, d);
      }
      return { max, alphaMax, centreLinePixelsOver1, centreLineMax };
    }, [a, b]);
    const seen = {};
    for (const name of PRESETS) {
      const o = { preset: name, time: 2, overrides: { ...AT_REFERENCE_SIZE } };
      seen[name] = await versus(o, { ...o, pixelStage: 'core6a58487' });
    }
    for (const name of ['prism_chrome', 'violet_gel', 'sapphire_drop', 'aqua_jelly']) {
      const o = { preset: name, time: 2, overrides: { ...AT_REFERENCE_SIZE, Backface: true } };
      seen[`${name}_backface_pass`] = await versus(o, { ...o, pixelStage: 'core6a58487' });
    }
    check('opaque_scene_matches_pre_sync', Object.values(seen).every((r) => r.max <= 1 && r.alphaMax <= 1 && r.centreLinePixelsOver1 <= 2), seen,
      'Family sync C1, C5, C6, C7, C8. Over the opaque demo scene, with Object size 1 and fog off, each of the twelve moving presets renders as the core\'s 6a58487 pixel stage does on the same moving surface (sphere; four presets also with the back-face pass): within 1/255 everywhere off the screen\'s two centre columns and rows, and at most 2 pixels over 1/255 on them (one Liquid Mercury silhouette pixel, 8/255, where the measured screen orientation flips the horizontal bend). The scene alpha, output cap, fog and Object size change nothing.');
  }

  // C2: extra colour buffers get zeros.
  if (want('extra_colour_buffers_get_zeros')) {
    const CLEAR = [0.5, 0.5, 0.5, 0.5];
    const mrt = await flow.evaluate(([CLEAR]) => {
      const o = { preset: 'prism_chrome', time: 2, clearBuffers: CLEAR };
      window.preview.draw({ ...o, probe: true }); const single = window.preview.lastProbe().slice();
      window.preview.draw({ ...o, buffers: 3 }); const b = window.preview.lastBuffers();
      let glass = 0, buffer0Max = 0; const extraNonZero = [0, 0, 0];
      for (let i = 0; i < single.length; i += 4) {
        if (single[i + 3] === CLEAR[3] && single[i] === CLEAR[0]) continue;
        glass++;
        for (let k = 0; k < 4; k++) buffer0Max = Math.max(buffer0Max, Math.abs(b[0][i + k] - single[i + k]));
        for (const j of [1, 2]) if (b[j][i] || b[j][i + 1] || b[j][i + 2] || b[j][i + 3]) extraNonZero[j]++;
      }
      return { glass_pixels: glass, buffer0_max_float_diff: buffer0Max, buffer1_pixels_not_zero: extraNonZero[1], buffer2_pixels_not_zero: extraNonZero[2] };
    }, [CLEAR]);
    check('extra_colour_buffers_get_zeros', mrt.glass_pixels > 1000 && mrt.buffer0_max_float_diff === 0
      && mrt.buffer1_pixels_not_zero === 0 && mrt.buffer2_pixels_not_zero === 0, mrt,
      'Family sync C2. In a render with three colour buffers (TD_NUM_COLOR_BUFFERS 3, cleared to 0.5, blending off), buffer 0 holds exactly the single-buffer glass and buffers 1 and 2 hold zeros wherever the moving glass is drawn.');
  }

  // C5: output cap.
  if (want('output_fits_half_float')) {
    const floats = (o) => flow.evaluate((o) => {
      window.preview.draw(o); const f = window.preview.lastProbe();
      let nonFinite = 0, maxRGB = 0, maxA = 0;
      for (let i = 0; i < f.length; i += 4) {
        for (let k = 0; k < 4; k++) if (!Number.isFinite(f[i + k])) nonFinite++;
        maxRGB = Math.max(maxRGB, f[i], f[i + 1], f[i + 2]); maxA = Math.max(maxA, f[i + 3]);
      }
      return { nonFinite, maxRGB: +maxRGB.toFixed(1), maxAlpha: +maxA.toFixed(1) };
    }, o);
    const hot = await floats({ preset: 'clear_crystal', time: 2, probe: true,
      overrides: { Lightcolorr: 2e5, Lightcolorg: 2e5, Lightcolorb: 2e5, Specular: 5 } });
    const far = await floats({ preset: 'clear_crystal', time: 2, mesh: 'sphere', spin: 0, tilt: 0, readBack: true,
      cameraZ: 1500, fov: 2 * Math.atan(Math.tan(22.5 * Math.PI / 180) * 4 / 1500) * 180 / Math.PI, far: 3000,
      overrides: { Backface: true } });
    check('output_fits_half_float', hot.nonFinite === 0 && hot.maxRGB <= 1024 && far.maxAlpha > 1400, { hot_highlight: hot, back_pass_far_away: far },
      'Family sync C5. A light colour of 200,000 still gives finite colour no higher than 1024 in an rgba16float render (half floats end at 65504). The cap is on colour only: the back-face pass of a sphere 1500 units away still stores distances above 1400 in alpha.');
  }

  // C6: measured screen orientation.
  if (want('bends_follow_screen_orientation') || want('flip_v_corrects_upside_down_inputs')) {
    const versus = (o, variant, mirror) => flow.evaluate(([o, variant, mirror]) => {
      window.preview.draw(o); const a = window.preview.pixels().slice();
      window.preview.draw({ ...o, ...variant, overrides: { ...(o.overrides || {}), ...(variant.overrides || {}) } });
      const b = window.preview.pixels(); const [W, H] = window.preview.size;
      let max = 0, over8 = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, j = ((mirror ? H - 1 - y : y) * W + x) * 4;
        const d = Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2]));
        max = Math.max(max, d); if (d > 8) over8++;
      }
      return { max, pixelsOver8: over8 };
    }, [o, variant, mirror]);
    const looks = [{ preset: 'prism_chrome', time: 2 },
                   { preset: 'chrome_type', time: 2, overrides: { Reflectmode: 'screen', Backface: true } }];
    const rows = {};
    for (const o of looks) {
      rows[o.preset + (o.overrides ? '_flat_image_backface' : '')] = {
        flipped_raster: await versus(o, { flipRaster: true }, true),
        upside_down_inputs_flip_v: await versus(o, { mirrorInputs: true, overrides: { Flipv: true } }, false),
        flipped_raster_upright_inputs_flip_v: await versus(o, { flipRaster: true, mirrorInputs: true, overrides: { Flipv: true } }, true),
      };
    }
    const ok = (r) => r.pixelsOver8 <= 400;  // antialiased silhouettes differ in any mirror (the multisample pattern is not mirrored)
    check('bends_follow_screen_orientation', Object.values(rows).every((r) => ok(r.flipped_raster)), rows,
      'Family sync C6. A build whose screen y runs opposite to the projection (emulated: the rasteriser flips y, and the scene render and back-face pass come from the same build) renders the exact mirror image of the moving glass: bends, frost, the flat-image reflection and the back-face pass all follow (at most 400 pixels over 8/255 at 480 x 270, all on antialiased rims).');
    check('flip_v_corrects_upside_down_inputs', Object.values(rows).every((r) => ok(r.upside_down_inputs_flip_v) && ok(r.flipped_raster_upright_inputs_flip_v)), rows,
      'Family sync C6. If the Refraction TOP and the back-face pass arrive upside down relative to the render (normal raster, or a flipped raster with upright inputs), Flip V restores the normal image: it flips the base screen UV and every vertical offset together.');
  }

  // C7: fog.
  if (want('fog_adds_only_the_glass_share')) {
    const RED = [1, 0, 0, 1];
    const fogged = await flow.evaluate(([INVISIBLE, RED]) => {
      window.preview.draw({ backdropOnly: true }); const bg = window.preview.pixels().slice();
      const run = (opacity) => {
        window.preview.draw({ preset: 'clear_crystal', time: 2, fog: RED, overrides: { ...INVISIBLE, Opacity: opacity } });
        const px = window.preview.pixels(); let glass = 0, off2 = 0;
        for (let i = 0; i < px.length; i += 4) {
          const scene = [bg[i], bg[i + 1], bg[i + 2]];
          const mixed = [0.5 * scene[0] + 127.5, 0.5 * scene[1], 0.5 * scene[2]];
          const off = (t) => Math.max(...[0, 1, 2].map((k) => Math.abs(px[i + k] - t[k])));
          if (off(scene) > 2) glass++;
          if (Math.min(off(scene), off(mixed)) > 2) off2++;
        }
        return { glass_pixels: glass, pixels_neither_over_2: off2 };
      };
      return { opacity_half: run(0.5), opacity_0: run(0) };
    }, [INVISIBLE, RED]);
    check('fog_adds_only_the_glass_share', fogged.opacity_half.glass_pixels > 1000 && fogged.opacity_half.pixels_neither_over_2 <= 800
      && fogged.opacity_0.glass_pixels === 0, fogged,
      'Family sync C7. With full fog (preview stand-in, not TouchDesigner\'s fog curve) on invisible moving glass at Opacity 0.5, every glass pixel is half the scene plus half the fog colour within 2/255 (only antialiased silhouette pixels are neither), and at Opacity 0 the fogged glass leaves no trace. With fog off, TDFog changes nothing (opaque_scene_matches_pre_sync).');
  }

  // C8: Object size carries the presets, motion included, between object sizes.
  // Both names are set: Flowsize is the 6a58487 name, so a --reference run scales that material's
  // motion too and measures only what C8 added (the glass lengths). The delivered material ignores it.
  if (want('object_size_carries_presets_over')) {
    // Since the family close both sizes scale with the SOP: Flow size (the motion) and Object size
    // (the glass), each k times its default, as Fit to Glass geometry sets them.
    const sized = {};
    const fitted = (k) => ({ Objectsize: k * defaults.Objectsize, Flowsize: k * defaults.Flowsize });
    for (const preset of ['prism_chrome', 'frosted_ice', 'amber_honey', 'sapphire_drop']) {
      const base = { preset, time: 2, mesh: 'sphere' };
      sized[preset] = {
        size_0_1: await stats8({ ...base, rest: { scale: 0.1 }, cameraZ: 0.4, near: 0.01, overrides: fitted(0.1) }, base),
        size_10: await stats8({ ...base, rest: { scale: 10 }, cameraZ: 40, far: 200, overrides: fitted(10) }, base),
      };
    }
    check('object_size_carries_presets_over', Object.values(sized).every((r) => Object.values(r).every((x) => x.pixelsOver8 <= 50)), sized,
      'Family sync C8. A preset looks and moves the same on a sphere built with radius 0.1 or 10 (the SOP itself), with Flow size and Object size set to match (what Fit to Glass geometry measures) and the camera moved with it: motion, bend, frost, tint, ripples and film all follow (final image, at most 50 pixels over 8/255).');
  }

  // C9: demo backdrops.
  if (want('backdrop_menu_switches_the_demo_scene')) {
    const checker = await diffRGBA({ backdropOnly: true }, { backdropOnly: true, reference: true });
    const type = await flow.evaluate(() => {
      window.preview.draw({ backdropOnly: true, overrides: { Backdrop: 'type' } }); const p = window.preview.pixels();
      let dark = 0, ink = 0; const n = p.length / 4;
      for (let i = 0; i < p.length; i += 4) { const l = (p[i] + p[i + 1] + p[i + 2]) / 3; if (l < 40) dark++; if (l > 200) ink++; }
      return { dark_share: +(dark / n).toFixed(3), white_ink_share: +(ink / n).toFixed(3) };
    });
    check('backdrop_menu_switches_the_demo_scene', checker.max === 0 && type.dark_share > 0.6 && type.white_ink_share > 0.05,
      { checker_vs_6a58487: checker, type },
      'Family sync C9. Study > Backdrop: Checker (the default) is the 6a58487 backdrop exactly; Type is a black page with heavy white type (most pixels dark, at least 5% white ink), the Liquid Glass Prism backdrop, so the family\'s contact sheets compare.');
  }

  // Verifier gap round G1: what uFilm.w = 0 does (README, hand-wiring table). The open demo grid
  // faces an orthographic camera with Amplitude 0 and Wobble 0, so every pixel sees the surface
  // at the same angle: the film stage is one colour exactly when the film thickness is.
  if (want('film_swirl_frequency_0_is_one_drifting_thickness')) {
    const res = await flow.evaluate(() => {
      const [W, H] = window.preview.size;
      const o = (time, swirl, extra = {}) => ({ preset: 'prism_chrome', time, mesh: 'grid', spin: 0, tilt: 0, ortho: 1.5,
        overrides: { Objectsize: 1, Stage: 'film', Amplitude: 0, Wobble: 0, Culling: 'none', ...extra },  // Object size 1: the default swirl 2.5
        uniforms: swirl === null ? undefined : { uFilm: [null, null, null, swirl] } });
      window.preview.draw({ ...o(2, null), probe: true }); const probe = window.preview.lastProbe().slice();
      const inner = (x, y) => { for (let d = -2; d <= 2; d++) if (probe[((y + d) * W + x) * 4 + 3] <= 0 || probe[(y * W + x + d) * 4 + 3] <= 0) return false; return true; };
      const grab = (opts) => { window.preview.draw(opts); return window.preview.pixels().slice(); };
      const spread = (px) => { const lo = [255, 255, 255], hi = [0, 0, 0]; let n = 0;
        for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) { if (!inner(x, y)) continue; n++; const i = (y * W + x) * 4;
          for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], px[i + k]); hi[k] = Math.max(hi[k], px[i + k]); } }
        return { sheet_pixels: n, colour_range: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), colour: lo }; };
      const change = (a, b) => { let max = 0, over = 0, n = 0;
        for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) { if (!inner(x, y)) continue; n++; const i = (y * W + x) * 4;
          const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); max = Math.max(max, d); if (d > 2) over++; }
        return { sheet_pixels: n, max, pixels_over_2: over }; };
      const w0t2 = grab(o(2, 0)), w0t30 = grab(o(30, 0)), w25 = grab(o(2, null));
      const still2 = grab(o(2, 0, { Wobblespeed: 0 })), still30 = grab(o(30, 0, { Wobblespeed: 0 }));
      return { swirl_0_at_2s: spread(w0t2), swirl_0_at_30s: spread(w0t30), swirl_2_5_at_2s: spread(w25),
               swirl_0_from_2s_to_30s: change(w0t2, w0t30), swirl_0_wobble_speed_0_from_2s_to_30s: change(still2, still30) };
    });
    const flat = (r) => r.sheet_pixels > 20000 && r.colour_range <= 2;
    const moved = res.swirl_0_from_2s_to_30s;
    check('film_swirl_frequency_0_is_one_drifting_thickness',
      flat(res.swirl_0_at_2s) && flat(res.swirl_0_at_30s) && res.swirl_2_5_at_2s.colour_range > 40
        && moved.pixels_over_2 === moved.sheet_pixels && moved.max > 40 && res.swirl_0_wobble_speed_0_from_2s_to_30s.max <= 2, res,
      'Verifier gap round G1. uFilm.w = 0 (film swirl frequency, set by hand) gives one film thickness over the whole object, no swirl: on a flat sheet seen at one angle the film stage is a single colour (within 2/255), where the default 2.5 swirls it. That one thickness still drifts with uPhase.w: from 2 s to 30 s every sheet pixel changes colour (Prism Chrome, Wobble speed 0.3). Wobble speed 0 stops the drift (no pixel changes). So 0 does not freeze the film; Wobble speed 0 does.');
  }

  // Verifier gap round G2 (family sync R2): objects in front of the glass stay in front.
  // Ported from Liquid Glass Prism's test of the same name, with its Over TOP control. The README's
  // route draws the glass with a Render Pass TOP into the scene render, keeping its depth (Clear
  // Depth Buffer and Clear to Camera Color off). The preview emulates it by drawing the glass into
  // a buffer that already holds the scene's colour and the ball's depth.
  if (want('render_pass_keeps_foreground_in_front')) {
    const res = await flow.evaluate(() => {
      const o = { preset: 'prism_chrome', time: 2 };
      window.preview.draw({ ...o, probe: true }); const glass = window.preview.lastProbe().slice();
      window.preview.draw({ ...o, occluder: {}, backdropOnly: true }); const scene = window.preview.pixels().slice();
      window.preview.draw({ ...o, backdropOnly: true }); const empty = window.preview.pixels().slice();
      window.preview.draw({ ...o, occluder: { renderPass: true } }); const pass = window.preview.pixels().slice();
      window.preview.draw({ ...o, occluder: {} }); const over = window.preview.pixels().slice();
      const [W, H] = window.preview.size;
      // Ball pixels over the moving glass: the ball is in the scene render, the glass covers them; 2 px away from any edge.
      const ball = (x, y) => { const i = (y * W + x) * 4; return Math.abs(scene[i] - empty[i]) + Math.abs(scene[i + 1] - empty[i + 1]) + Math.abs(scene[i + 2] - empty[i + 2]) > 30; };
      let n = 0, passMax = 0, overMax = 0, overChanged = 0;
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        let inner = true; for (let d = -2; d <= 2 && inner; d++) if (!ball(x + d, y) || !ball(x, y + d)) inner = false;
        if (!inner || glass[(y * W + x) * 4 + 3] === 0) continue;
        const i = (y * W + x) * 4; n++;
        const dp = Math.max(Math.abs(pass[i] - scene[i]), Math.abs(pass[i + 1] - scene[i + 1]), Math.abs(pass[i + 2] - scene[i + 2]));
        const dov = Math.max(Math.abs(over[i] - scene[i]), Math.abs(over[i + 1] - scene[i + 1]), Math.abs(over[i + 2] - scene[i + 2]));
        passMax = Math.max(passMax, dp); overMax = Math.max(overMax, dov); if (dov > 8) overChanged++;
      }
      return { occluder_pixels_over_glass: n, render_pass_max_diff: passMax, over_top_max_diff: overMax, over_top_pixels_over_8: overChanged };
    });
    check('render_pass_keeps_foreground_in_front', res.occluder_pixels_over_glass > 500 && res.render_pass_max_diff <= 2 && res.over_top_max_diff > 40, res,
      'Verifier gap round G2 (family sync R2). An opaque ball between the camera and the moving glass: with the README\'s Render Pass TOP route (the glass drawn into the scene render, whose depth is kept), the image shows the ball exactly as the scene render does wherever it covers the glass. Control: laid over the scene with an Over TOP (the fallback, and the 6a58487 route), the glass is drawn over the ball. Same emulation and thresholds as Liquid Glass Prism\'s test.');
  }

  // ======================================================================== family close
  // G1 (ported from Liquid Glass Lit through the core): the same object scaled by its Geometry COMP,
  // TouchDesigner's usual way to size an object, at what Fit to Glass geometry sets there: Object size
  // k times the default (the world size, family rule) and Flow size unchanged (the SOP is unchanged; the
  // COMP scales the moved surface). The ripple and film lookups count the COMP's scale (worldScale() in
  // the shared pixel stage), so the moving glass must look as on the unscaled demo.
  if (want('fit_size_carries_presets_over_comp_scale')) {
    const comp = {};
    for (const [preset, stage] of [['aqua_jelly', 'normal'], ['oil_slick', 'film'], ['aqua_jelly', 'final'],
                                   ['oil_slick', 'final'], ['prism_chrome', 'final'], ['frosted_ice', 'final']]) {
      const base = { preset, time: 2, mesh: 'sphere', overrides: { Stage: stage } };
      const fitted = (k) => ({ Stage: stage, Objectsize: k * defaults.Objectsize });
      comp[`${preset}_${stage}`] = {
        comp_scale_0_1: await stats8({ ...base, scale: 0.1, cameraZ: 0.4, near: 0.01, overrides: fitted(0.1) }, base),
        comp_scale_10: await stats8({ ...base, scale: 10, cameraZ: 40, far: 200, overrides: fitted(10) }, base),
      };
    }
    // Fit threshold (family critic, low): every case measures 1/255, so the test holds 2/255 at every
    // pixel. The family's shared clause (at most 50 pixels over 8/255) stays; Prism and Blobs keep only
    // their own recorded bounds. A worldScale() exponent of 0.3333 instead of 1/3 gives 4 to 5/255 with
    // no pixel over 8: the shared clause alone passes it, the 2/255 clause does not.
    check('fit_size_carries_presets_over_comp_scale', Object.values(comp).every((r) => Object.values(r).every((x) => x.max <= 2 && x.pixelsOver8 <= 50)), comp,
      'Family close G1. A moving preset looks the same on the demo sphere scaled 0.1 or 10 by its Geometry COMP, with the camera moved with it and the sizes Fit to Glass geometry sets there: Object size 0.1 or 10 times its default (the family rule: world radius / 1.45) and Flow size unchanged (SOP units). The ripples (normal stage), the film bands (film stage) and the final image stay within 2/255 at every pixel (measured: 1/255), and so within 8/255 but for at most 50 pixels (the family\'s shared clause). Same cases and thresholds as Liquid Glass Lit and the core, with the motion on.');
  }

  // G2 (ported from Liquid Glass Lit through the core): the measured screen orientation at every glass
  // pixel of the moving glass. Instrumented copies of the pixel shader write the orientation each pixel
  // measured instead of its colour: red = 1 where x runs the usual way, green = 1 where y does. The
  // 6a58487 material had no measured orientation (it assumed the usual one), so its copy writes 1, 1.
  // Two readouts: the glass alone in a float target (one sample per pixel), and the canvas, which is
  // multisampled like an antialiased Render TOP (blue = how many samples the glass covers). Sizes
  // 480 x 270 and the odd 481 x 271, whose centre row and column sit exactly on the centre lines.
  if (want('screen_orientation_has_no_wrong_pixels')) {
    const instrument = (file) => {
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      const out = '    fragColor[0] = TDOutputSwizzle(vec4(colour, alpha));\n';
      if (source.split(out).length !== 2) throw new Error('instrument patch did not apply: ' + file);
      return source.replace(out, file.includes('reference') ? '    fragColor[0] = vec4(1.0, 1.0, 1.0, 1.0);\n'
                                                            : '    fragColor[0] = vec4(step(vec2(0.0), orient), 1.0, 1.0);\n');
    };
    const signFrag = instrument('liquid_flow.frag'), signRefFrag = instrument('checks/reference/liquid_flow.frag');
    const route = (pg) => pg.route(/\/liquid_flow\.frag$/, (r) => r.fulfill({ status: 200, contentType: 'text/plain',
      body: r.request().url().includes('/checks/reference/') ? signRefFrag : signFrag }));
    const rows = {};
    for (const size of [[480, 270], [481, 271]]) {
      const pg = await open('flow', size, route);
      for (const mesh of ['sphere', 'torus', 'knot']) for (const flip of [false, true]) {
        rows[`${mesh}${flip ? '_flipped_raster' : ''}_${size[0]}x${size[1]}`] = await pg.evaluate(([mesh, flip, names]) => {
          const [W, H] = window.preview.size;
          const onCentreLine = (p) => Math.abs(p % W + 0.5 - W / 2) <= 1 || Math.abs(Math.floor(p / W) + 0.5 - H / 2) <= 1;
          const single = { glass_pixels: 0, wrong_sign_pixels: 0, of_them_within_a_pixel_of_a_centre_line: 0 };
          const multi = { glass_pixels: 0, wrong_sign_pixels: 0, of_them_within_a_pixel_of_a_centre_line: 0 };
          const count = (r, p, wrong) => { r.glass_pixels++; if (wrong) { r.wrong_sign_pixels++; if (onCentreLine(p)) r.of_them_within_a_pixel_of_a_centre_line++; } };
          names.forEach((preset, k) => {
            // each preset at its own pose and with its own motion, so the twelve renders see different silhouettes
            const o = { preset, mesh, time: 2, spin: 6.85 * k, tilt: 20 + 2.5 * k, flipRaster: flip, flatBackdrop: [0, 0, 0, 1] };
            window.preview.draw({ ...o, probe: true });
            const f = window.preview.lastProbe();
            for (let i = 0; i < f.length; i += 4) if (f[i + 3] > 0) count(single, i / 4, f[i] !== 1 || f[i + 1] !== (flip ? 0 : 1));
            window.preview.draw(o);
            const px = window.preview.pixels();  // one wrong sample of four is 64/255
            for (let i = 0; i < px.length; i += 4) if (px[i + 2] > 0) {
              count(multi, i / 4, px[i + 2] - px[i] > 32 || (flip ? px[i + 1] > 32 : px[i + 2] - px[i + 1] > 32));
            }
          });
          return { size: [W, H], renders: names.length, single_sample: single, multisampled: multi };
        }, [mesh, flip, PRESETS]);
      }
      await pg.close();
    }
    check('screen_orientation_has_no_wrong_pixels', Object.values(rows).every((r) => r.single_sample.glass_pixels > 100000
      && r.single_sample.wrong_sign_pixels <= 2 && r.multisampled.wrong_sign_pixels <= 10), rows,
      'Family close G2. The measured screen orientation is right at every glass pixel but a known few, on the centre lines too: the twelve moving presets (each at its own pose) on the sphere, the torus and the knot, in a normal and a flipped raster, at 480 x 270 and at the odd size 481 x 271. One sample per pixel (the glass alone): at most 2 wrong pixels per row of twelve renders. Four samples (the canvas, like an antialiased Render TOP): at most 10 per row (20 until the family critic\'s centre-line round; measured: at most 5). The few left are a centre-line pixel on a nearly edge-on surface (the tie keeps +1) and silhouette pixels where the glass covers one to three samples of four: the pixel is shaded at its centre, outside its triangle, so its point can project to the other side of a centre line (this study\'s C6 finding). Whether they are visible in TouchDesigner is a family open question with a pending native check (co-design.json; validation.json, centre_line_residual). Same test and thresholds as Liquid Glass Lit and the core. The c94e849 pixel stage kept +1 on ties and was wrong on the whole centre row of the odd size in a flipped raster; the 6a58487 material assumed the usual orientation and is wrong at every pixel of a flipped raster.');
  }

  await browser.close();
  const report = { ok: results.length > 0 && results.every((r) => r.ok) && !errors.length, errors, results,
    material: referenceRun ? 'checks/reference (this study at commit 6a58487)' : 'delivered',
    scope: 'Shader maths and study.json bindings in WebGL2 (SwiftShader). Not a TouchDesigner render.' };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
})();
