// Property tests of the delivered GLSL, run through the WebGL2 preview.
//
//   node checks/preview_tests.cjs <port>               (serve the study folder on <port> first)
//   node checks/preview_tests.cjs <port> --reference   (run every test against the 6a58487 material
//                                                       in checks/reference/, to see which tests guard
//                                                       the family sync: those must fail there)
//
// Each test states a relationship that must hold whatever the look, e.g.
// "with no lights in the scene the material renders exactly its built-in
// fallback". They test the shader maths and the study.json bindings in a
// browser GPU (SwiftShader) with stand-in light functions, not TouchDesigner.
// Pixels stay in the page; only measurements come back to Node.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const STUDY_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'study.json'), 'utf8'));
const PRESETS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'presets.json'), 'utf8')).order;

const QUIET = { Reflection: 0, Rim: 0, Specular: 0, Diffuse: 0, Iridescence: 0, Wobble: 0 };
const INVISIBLE = { ...QUIET, Ior: 1.0, Dispersion: 0, Frost: 0, Density: 0, Edgetint: 0, Saturation: 1,
                    Translucency: 1, Stage: 'final' };
// A distant light coming from direction L (it travels along -L).
const L = (() => { const v = [0.8, 0.5, 0.35]; const n = Math.hypot(...v); return v.map((x) => x / n); })();
const DISTANT = { type: 'distant', dir: L.map((x) => -x), color: [1.0, 0.9, 0.8] };
const FILL = { type: 'point', pos: [0, -4, 3], color: [0.3, 0.5, 0.4] };
const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };

// Measurement helpers, evaluated inside the page.
function pageHelpers() {
  const P = window.preview;
  const [W, H] = P.size;
  const bufs = {}, masks = {};
  window.T = {
    size: [W, H],
    render(key, opts) { P.draw(opts); bufs[key] = P.pixels(); return true; },
    diff(a, b) {
      const pa = bufs[a], pb = bufs[b];
      let max = 0, over = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
        max = Math.max(max, d); if (d > 2) over++;
      }
      return { max, pixelsOver2: over };
    },
    // Pixels whose 3x3 neighbourhood is all glass, from a normal-stage render over black.
    mask(key, normalKey) {
      const n = bufs[normalKey];
      const inside = new Uint8Array(W * H);
      for (let k = 0; k < W * H; k++) inside[k] = Math.max(n[4 * k], n[4 * k + 1], n[4 * k + 2]) > 20 ? 1 : 0;
      const m = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        let all = 1;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) all &= inside[(y + dy) * W + x + dx];
        m[y * W + x] = all;
      }
      masks[key] = m;
      return true;
    },
    lightOnlyWhereFacing(withKey, withoutKey, normalKey, maskKey, L) {
      const a = bufs[withoutKey], b = bufs[withKey], n = bufs[normalKey], m = masks[maskKey];
      let away = 0, awayChanged = 0, awayMax = 0, lost = 0, lit = 0, litChanged = 0;
      for (let k = 0; k < W * H; k++) {
        if (!m[k]) continue;
        const v = [0, 1, 2].map((c) => n[4 * k + c] / 255 * 2 - 1);
        const ndl = (v[0] * L[0] + v[1] * L[1] + v[2] * L[2]) / (Math.hypot(...v) || 1);
        let d = 0, minDelta = 0;
        for (let c = 0; c < 3; c++) {
          const delta = b[4 * k + c] - a[4 * k + c];
          d = Math.max(d, Math.abs(delta)); minDelta = Math.min(minDelta, delta);
        }
        if (minDelta < -2) lost++;
        if (ndl < -0.03) { away++; awayMax = Math.max(awayMax, d); if (d > 2) awayChanged++; }
        if (ndl > 0.2) { lit++; if (d > 2) litChanged++; }
      }
      return { pixelsFacingAway: away, changedFacingAway: awayChanged, maxChangeFacingAway: awayMax,
               pixelsLosingEnergy: lost, pixelsFacingLight: lit, changedFacingLight: litChanged };
    },
    meanGradient(key, maskKey) {
      const p = bufs[key], m = masks[maskKey];
      let sum = 0, count = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const k = y * W + x;
        if (!m[k] || !m[k + 1] || !m[k + W]) continue;
        for (let c = 0; c < 3; c++) sum += Math.abs(p[4 * (k + 1) + c] - p[4 * k + c]) + Math.abs(p[4 * (k + W) + c] - p[4 * k + c]);
        count++;
      }
      return +(sum / count).toFixed(3);
    },
    // Mean RGB value (0-255) inside a mask: separates blur from dimming.
    meanIntensity(key, maskKey) {
      const p = bufs[key], m = masks[maskKey];
      let sum = 0, count = 0;
      for (let k = 0; k < W * H; k++) if (m[k]) { sum += p[4 * k] + p[4 * k + 1] + p[4 * k + 2]; count += 3; }
      return +(sum / count).toFixed(3);
    },
    diffInMask(a, b, maskKey) {
      const pa = bufs[a], pb = bufs[b], m = masks[maskKey];
      let max = 0, changed = 0, pixels = 0;
      for (let k = 0; k < W * H; k++) {
        if (!m[k]) continue;
        pixels++;
        const d = Math.max(Math.abs(pa[4 * k] - pb[4 * k]), Math.abs(pa[4 * k + 1] - pb[4 * k + 1]), Math.abs(pa[4 * k + 2] - pb[4 * k + 2]));
        max = Math.max(max, d); if (d > 2) changed++;
      }
      return { maskPixels: pixels, max, changed };
    },
    // Render into a 32-bit float target and summarise RGB: largest value, non-finite count.
    floatStats(opts) {
      P.draw({ ...opts, float: true });
      const f = P.pixelsFloat();
      let max = 0, nonFinite = 0;
      for (let i = 0; i < f.length; i++) {
        if (i % 4 === 3) continue;
        if (!Number.isFinite(f[i])) nonFinite++; else if (f[i] > max) max = f[i];
      }
      return { max: +max.toFixed(2), nonFinite };
    },
    pixel(key, x, y) { const k = y * W + x; return Array.from(bufs[key].slice(4 * k, 4 * k + 3)); },
  };
}

(async () => {
  const port = process.argv[2];
  const referenceRun = process.argv.includes('--reference');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/checks/preview/index.html?harness=1`);
  await page.evaluate(() => window.previewReady);
  if (referenceRun) await page.evaluate(() => {  // every draw uses the 6a58487 shaders and bindings
    const draw = window.preview.draw;
    window.preview.draw = (o = {}) => draw({ ...o, reference: true });
  });
  await page.evaluate(pageHelpers);
  const [W, H] = await page.evaluate(() => window.T.size);

  const render = (key, opts) => page.evaluate(([k, o]) => window.T.render(k, o), [key, opts]);
  const diff = async (a, b) => { await render('a', a); await render('b', b); return page.evaluate(() => window.T.diff('a', 'b')); };
  const call = (name, ...args) => page.evaluate(([n, a]) => window.T[n](...a), [name, args]);

  const results = [];
  const check = (name, ok, evidence, claim) => results.push({ name, ok, claim, evidence });

  // 1. The compile matrix also links in WebGL2.
  const matrix = await page.evaluate(() => window.preview.compileMatrix());
  check('webgl_compile_matrix', matrix.every((m) => m.ok), matrix,
    'The same shader files compile and link in WebGL2 for TD_NUM_LIGHTS 0, 1, 3 and TD_NUM_ENV_LIGHTS 0, 1.');

  // 2. No lights in the scene equals the built-in fallback.
  const fallback = [];
  for (const preset of ['violet_gel', 'rose_quartz', 'prism_chrome']) {
    const auto = { preset, time: 2, overrides: { Demolights: 'none', Demoenv: false, Lightsource: 'auto', Envsource: 'auto' } };
    for (const [lights, env] of [[[DISTANT], false], [[DISTANT, FILL, FILL], true]]) {
      const forced = { preset, time: 2, lights, env, overrides: { Lightsource: 'builtin', Envsource: 'builtin' } };
      fallback.push({ preset, sceneLights: lights.length, sceneEnvLights: env ? 1 : 0, ...(await diff(auto, forced)) });
    }
  }
  check('no_lights_equals_builtin_fallback', fallback.every((r) => r.max <= 2), fallback,
    'With zero Light COMPs and zero Environment Lights, Auto renders exactly what "built-in only" renders in a scene that has 1 or 3 lights and an env light.');

  // 3. Adding a light only adds energy, and only where N.L > 0.
  {
    const base = { preset: 'rose_quartz', time: 2, env: false,
                   overrides: { Lightsource: 'scene', Envsource: 'builtin', Wobble: 0, Diffuse: 0.3, Specular: 1.0, Translucency: 0.5 } };
    await render('without', { ...base, lights: [] });
    await render('with', { ...base, lights: [DISTANT] });
    await render('normals', { ...base, lights: [], background: 'black', overrides: { ...base.overrides, Stage: 'normal' } });
    await call('mask', 'm', 'normals');
    const ev = await call('lightOnlyWhereFacing', 'with', 'without', 'normals', 'm', L);
    check('light_adds_energy_only_where_NdotL_positive',
      ev.pixelsFacingAway > 1000 && ev.changedFacingAway === 0 && ev.pixelsLosingEnergy === 0 &&
      ev.changedFacingLight > 0.5 * ev.pixelsFacingLight, ev,
      'Scene Light COMPs: a distant light changes no pixel whose normal faces away from it (N.L < -0.03), never darkens a pixel, and brightens most pixels facing it. The N.L gate here comes from the preview\'s stand-in TDLightingPBR, so this checks that the material adds nothing of its own on the far side; TouchDesigner\'s TDLightingPBR is a pending native check.');
  }

  // 3b. The same for the material's own light maths: the built-in key light, used by
  // Auto when the scene has no Light COMPs. Keyintensity 0 vs 1 isolates everything it adds.
  {
    const keyDir = unit([-0.5, 0.8, 0.6]);  // Keydir default, the direction toward the light
    const base = { preset: 'rose_quartz', time: 2, env: false, lights: [],
                   overrides: { Lightsource: 'auto', Envsource: 'builtin', Wobble: 0, Diffuse: 0.3, Specular: 1.0, Translucency: 0.5 } };
    await render('keyOff', { ...base, overrides: { ...base.overrides, Keyintensity: 0 } });
    await render('keyOn', { ...base, overrides: { ...base.overrides, Keyintensity: 1 } });
    await render('normals', { ...base, background: 'black', overrides: { ...base.overrides, Stage: 'normal' } });
    await call('mask', 'mk', 'normals');
    const ev = await call('lightOnlyWhereFacing', 'keyOn', 'keyOff', 'normals', 'mk', keyDir);
    check('builtin_key_adds_energy_only_where_NdotL_positive',
      ev.pixelsFacingAway > 1000 && ev.changedFacingAway === 0 && ev.pixelsLosingEnergy === 0 &&
      ev.changedFacingLight > 0.5 * ev.pixelsFacingLight, ev,
      'The built-in key light (Auto with no Light COMPs; Key light intensity 0 vs 1) changes no pixel facing away from it, darkens none, and brightens most pixels facing it, so the fallback is never empty. This is the material\'s own N.L gate.');
  }

  // 4. Environment roughness blurs monotonically (scene env light, and built-in studio).
  const blur = {};
  for (const source of ['scene', 'builtin']) {
    const base = { preset: 'clear_crystal', time: 2, mesh: 'sphere', spin: 0, tilt: 0, lights: [], env: true,
                   background: 'black', overrides: { Envsource: source, Stage: 'environment', Wobble: 0 } };
    await render('normals', { ...base, overrides: { ...base.overrides, Stage: 'normal' } });
    await call('mask', 'sphere', 'normals');
    const rows = [];
    for (const roughness of [0, 0.15, 0.3, 0.5, 0.7, 0.9]) {
      await render('env', { ...base, overrides: { ...base.overrides, Roughness: roughness } });
      const meanGradient = await call('meanGradient', 'env', 'sphere');
      const meanIntensity = await call('meanIntensity', 'env', 'sphere');
      rows.push({ roughness, meanGradient, meanIntensity, relativeGradient: +(meanGradient / meanIntensity).toFixed(4) });
    }
    blur[source] = rows;
  }
  // Blur, not dimming: the gradient relative to the mean brightness must fall,
  // and the mean brightness must not drop below 60% of the sharp reflection's.
  // (It may rise: the studio's softened strips add light, see review.md.)
  const decreasing = (rows) => rows.every((r, i) => i === 0 || r.relativeGradient < rows[i - 1].relativeGradient);
  const brightnessKept = (rows) => rows.every((r) => r.meanIntensity >= 0.6 * rows[0].meanIntensity);
  check('env_roughness_blurs_monotonically',
    decreasing(blur.scene) && decreasing(blur.builtin) && brightnessKept(blur.scene) && brightnessKept(blur.builtin), blur,
    'Raising Reflection roughness strictly lowers the colour gradient relative to the mean brightness (a blur, not a fade), and the mean brightness never drops below 60% of roughness 0, for an Environment Light COMP and for the built-in studio. The preview\'s mipmaps are box-filtered (generateMipmap); TouchDesigner\'s may differ.');

  // 5. IOR 1 with every light term off is invisible, with or without scene lights.
  const invisible = [];
  for (const [lights, env] of [['none', false], ['both', true]]) {
    invisible.push({ demoLights: lights, envLight: env,
      ...(await diff({ preset: 'clear_crystal', time: 2, overrides: { ...INVISIBLE, Demolights: lights, Demoenv: env } },
                     { backdropOnly: true })) });
  }
  check('ior1_invisible_with_light_terms_off', invisible.every((r) => r.max <= 2), invisible,
    'At IOR 1 with specular, diffuse, reflection, rim and film off, the glass shows exactly the Refraction TOP, whether the scene has lights or not: light never leaks into the transmitted image.');

  // 6. Auto picks the scene's sources when present (Light sources stage).
  const centre = [Math.floor(W / 2) + 150, Math.floor(H / 2)];
  const at = async (opts) => { await render('s', opts); return call('pixel', 's', centre[0], centre[1]); };
  const sources = {
    sceneLightsAndEnv: await at({ preset: 'clear_crystal', time: 2, overrides: { Stage: 'sources', Demolights: 'both', Demoenv: true } }),
    sceneLightsOnly: await at({ preset: 'clear_crystal', time: 2, overrides: { Stage: 'sources', Demolights: 'key', Demoenv: false } }),
    nothing: await at({ preset: 'clear_crystal', time: 2, overrides: { Stage: 'sources', Demolights: 'none', Demoenv: false } }),
  };
  const is = (rgb, want) => rgb.every((v, i) => Math.abs(v - want[i] * 255) <= 1);
  check('auto_uses_scene_sources_when_present',
    is(sources.sceneLightsAndEnv, [1, 1, 0]) && is(sources.sceneLightsOnly, [1, 0, 1]) && is(sources.nothing, [0, 0, 1]),
    { pixel: centre, ...sources }, 'Light sources stage: R = scene lights, G = scene env light, B = built-in fallback; Auto switches per kind.');

  // 7. Other invariants carried over from the core study.
  let d = await diff({ preset: 'prism_chrome', time: 2, overrides: { Opacity: 0 } }, { backdropOnly: true });
  check('opacity0_is_invisible', d.max <= 2, d, 'Opacity 0 removes the glass entirely, reflections and highlights included.');

  d = await diff({ preset: 'clear_crystal', time: 2, refraction: false, overrides: { ...INVISIBLE, Demolights: 'both' } },
                 { backdropOnly: true });
  check('no_refraction_top_blends_clear', d.max <= 2, d,
    'With no Refraction TOP, clear untinted glass with no light terms blends to the real background (alpha 0).');

  d = await diff({ preset: 'clear_crystal', time: 2, overrides: { Stage: 'refraction', Dispersion: 0, Frost: 0, Samples: 1 } },
                 { preset: 'clear_crystal', time: 2, overrides: { Stage: 'refraction', Dispersion: 0, Frost: 0, Samples: 16 } });
  check('samples_invariant_without_dispersion', d.max <= 2, d,
    'Without dispersion or frost every sample is identical, so the sample count cannot change the image.');

  d = await diff({ preset: 'prism_chrome', time: 2, overrides: { Morphtarget: 'violet_gel', Morph: 1 } }, { preset: 'violet_gel', time: 2 });
  check('morph1_equals_target', d.max <= 2, d, 'Morph 1 toward a preset renders that preset.');

  d = await diff({ preset: 'violet_gel', time: 2, overrides: { Morphtarget: 'amber_honey', Morph: 0 } }, { preset: 'violet_gel', time: 2 });
  check('morph0_is_neutral', d.max <= 2, d, 'Morph 0 leaves the current look unchanged.');

  const envA = { preset: 'chrome_type', time: 2, overrides: { Stage: 'environment', Envsource: 'scene' } };
  const r360 = await diff(envA, { ...envA, envRotate: 360 });
  const r90 = await diff(envA, { ...envA, envRotate: 90 });
  check('env_rotation_reaches_reflection', r360.max <= 2 && r90.max > 40, { rotate360: r360, rotate90: r90 },
    'uTDEnvLights[0].rotate turns the reflected environment: 360 degrees changes nothing, 90 degrees changes it.');

  const uvPoint = [Math.floor(W / 2) + 37, Math.floor(H / 2) - 21];
  await render('uv', { preset: 'clear_crystal', time: 2, mesh: 'sphere', overrides: { Stage: 'screenuv' } });
  const uvMeasured = (await call('pixel', 'uv', uvPoint[0], uvPoint[1])).slice(0, 2);
  const uvExpected = [(uvPoint[0] + 0.5) / W * 255, (uvPoint[1] + 0.5) / H * 255];
  check('screen_uv_matches_pixel', Math.abs(uvMeasured[0] - uvExpected[0]) <= 1.5 && Math.abs(uvMeasured[1] - uvExpected[1]) <= 1.5,
    { pixel: uvPoint, measured: uvMeasured, expected: uvExpected.map((v) => +v.toFixed(1)) },
    'screenUV() gives the pixel position over the render size (preview viewport stand-in).');

  // 8. Every output stays finite and capped in a float render, teaching stages included,
  // at the smallest highlights and with degenerate key directions.
  {
    const cases = [];
    for (const Stage of ['final', 'lights']) {
      for (const Highlightsize of [0.02, 0.04, 0.07]) {
        for (const Lightsource of ['builtin', 'scene']) {
          cases.push({ Stage, Highlightsize, Lightsource });
        }
      }
      for (const key of [[0, 0, 0], [0, 0, -1], [0, 0, 1]]) {
        cases.push({ Stage, Highlightsize: 0.02, Lightsource: 'builtin', Keydirx: key[0], Keydiry: key[1], Keydirz: key[2] });
      }
    }
    const rows = [];
    for (const c of cases) {
      const stats = await page.evaluate((o) => window.T.floatStats(o),
        { preset: 'clear_crystal', time: 2, overrides: { Specular: 4, Demolights: 'both', ...c } });
      rows.push({ ...c, ...stats });
    }
    check('outputs_finite_and_capped', rows.every((r) => r.nonFinite === 0 && r.max <= 1024), rows,
      'Rendered into a 32-bit float target, the final image and the Lights stage stay finite and at most 1024 (the cap that keeps a 16-bit float render finite), at Highlight size 0.02 to 0.07 and with Key light direction 0,0,0 or along the view axis.');
  }

  // 9. An opaque object in front of the glass stays in front (Render Pass TOP route).
  {
    const scene = { preset: 'prism_chrome', time: 2, overrides: { Demooccluder: true } };
    await render('barMaskSource', { ...scene, background: 'black', backdropOnly: true });
    await call('mask', 'bar', 'barMaskSource');
    await render('sceneOnly', { ...scene, backdropOnly: true });
    await render('pass', scene);
    await render('over', { ...scene, composite: 'over' });
    const pass = await call('diffInMask', 'pass', 'sceneOnly', 'bar');
    const over = await call('diffInMask', 'over', 'sceneOnly', 'bar');
    check('occluder_stays_in_front', pass.maskPixels > 2000 && pass.max <= 2 && over.changed > 500,
      { renderPass: pass, overComposite: over },
      'With the glass drawn into the scene render (depth kept, as the Render Pass TOP does), no pixel of the opaque bar in front of it changes. The control models the old recipe, a glass render laid over the scene with an Over TOP: there the glass covers part of the bar.');
  }

  // ================================================================ family sync (review.md)
  // Each block below guards one item; run with --reference, the 6a58487 material fails it.
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
  const diffRGBA = (a, b) => page.evaluate(([a, b]) => {
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
  // A test whose draw throws (a shader that does not compile in WebGL2) fails with the error as evidence.
  const guard = async (name, claim, body) => {
    try { await body(); } catch (e) { check(name, false, { error: String(e).slice(0, 600) }, claim); }
  };

  // ---------------------------------------------------------------- R1: integrated drift clock
  await guard('morph_frame_is_smooth_after_an_hour', 'see below', async () => {
    const frames = (a, b) => stats({ spin: 0, ...a }, { spin: 0, ...b, drift: 'continue' }, 8);
    const morphFrame = (stage, T) => frames(
      { preset: 'prism_chrome', time: T, overrides: { Stage: stage, Morphtarget: 'aqua_jelly', Morph: 0.5 } },
      { preset: 'prism_chrome', time: T + 1 / 60, overrides: { Stage: stage, Morphtarget: 'aqua_jelly', Morph: 0.51 } });
    const morph = {};
    for (const stage of ['final', 'film']) for (const T of [2, 3600]) morph[`${stage}_t${T}`] = await morphFrame(stage, T);
    check('morph_frame_is_smooth_after_an_hour',
      ['final', 'film'].every((s) => morph[`${s}_t3600`].max <= morph[`${s}_t2`].max + 12
        && morph[`${s}_t3600`].p99OfAllPixels <= morph[`${s}_t2`].p99OfAllPixels + 3), morph,
      'One frame of a 100-frame A/B morph (Prism Chrome toward Aqua Jelly, Morph 0.50 to 0.51 in 1/60 s, Wobble speed 0.3 to 0.6) changes the image no more after an hour than after 2 s: the ripple and film drift is integrated (presets.py advance()), so changing its speed never throws the pattern. With uWobble.w = absTime.seconds (6a58487) the same frame jumps.');
  });
  await guard('speed_change_is_smooth_after_an_hour', 'see below', async () => {
    const frames = (a, b) => stats({ spin: 0, ...a }, { spin: 0, ...b, drift: 'continue' }, 8);
    const jelly = (T, speed) => ({ preset: 'aqua_jelly', time: T, overrides: { Stage: 'normal', Wobblespeed: speed } });
    const steady = await frames(jelly(3600, 0.6), jelly(3600 + 1 / 60, 0.6));
    const nudged = await frames(jelly(3600, 0.6), jelly(3600 + 1 / 60, 0.61));
    check('speed_change_is_smooth_after_an_hour', nudged.max <= Math.max(steady.max, 2) + 2, { steady, nudged },
      'After an hour, nudging Wobble speed from 0.60 to 0.61 changes one frame no more than one frame of motion at a fixed speed does (Aqua Jelly, normal stage).');
  });

  // ---------------------------------------------------------------- R5: shader hygiene
  d = await diff({ preset: 'clear_crystal', time: 2, overrides: { ...INVISIBLE, Demolights: 'both', Wobble: 0.6, Wobblescale: 1.6, Wobblespeed: 0.6 } },
                 { backdropOnly: true });
  check('ior1_invisible_with_wobble', d.max <= 2, d,
    'Ripples do not undo the silhouette fix: at IOR 1 with the light terms off, rippled glass is still invisible (normals are turned toward the camera again after the wobble).');

  {
    // Object size follows the COMP scale (what Fit sets), so the ripple count matches too;
    // the tilt itself never depended on Object size.
    const ripples = { preset: 'aqua_jelly', time: 2, overrides: { Stage: 'normal', Wobble: 0.6 } };
    const small = await stats({ ...ripples, scale: 0.1, cameraZ: 0.5, near: 0.01, overrides: { ...ripples.overrides, Objectsize: 0.1 } }, ripples, 8);
    const large = await stats({ ...ripples, scale: 10, cameraZ: 50, far: 200, overrides: { ...ripples.overrides, Objectsize: 10 } }, ripples, 8);
    check('wobble_independent_of_object_scale', small.max <= 12 && large.max <= 12 && small.pixelsOver8 <= 50 && large.pixelsOver8 <= 50,
      { scale01: small, scale10: large },
      'Wobble tilts the normals by the same amount whether the object is scaled 0.1, 1 or 10 by its Geometry COMP, the camera moved with it and Object size set to the scale, as Fit to Glass geometry sets it (normal stage).');
  }
  {
    const faceted = { preset: 'clear_crystal', time: 2, mesh: 'sphere', noNormals: true, overrides: { Stage: 'normal' } };
    const facetScale = await stats({ ...faceted, scale: 0.1, cameraZ: 0.5, near: 0.01 }, faceted, 8);
    const facetSmooth = await stats(faceted, { ...faceted, noNormals: false }, 8);
    check('faceted_fallback_without_normals', facetScale.max <= 12 && facetScale.pixelsOver8 <= 50 && facetSmooth.p99OfAllPixels <= 16,
      { scale01_vs_scale1: facetScale, faceted_vs_smooth: facetSmooth },
      'Geometry without normals gets faceted normals from screen derivatives (taken at the top of main(), relative threshold), close to the smooth normals and the same at any scale (sphere, 0.1 vs 1).');
  }

  // ---------------------------------------------------------------- R6: frost
  {
    const frosted = (n) => ({ preset: 'clear_crystal', time: 2, overrides: { Stage: 'refraction', Dispersion: 0, Frost: 0.6, Samples: n } });
    const frost = await stats(frosted(12), frosted(32), 16);
    check('frost_converges_with_samples', frost.max <= 16, frost,
      'Frost 0.6 is a continuous blur: 12 and 32 samples agree within 16/255 at every pixel (refraction stage).');
  }

  // ---------------------------------------------------------------- R8: Energy conserving, Colour parameters
  await guard('energy_conserving_mirror_is_pure_reflection', 'see below', async () => {
    const mirror = { ...QUIET, Reflection: 1, Mirror: 1, Conserve: true };
    const r = await diff({ preset: 'clear_crystal', time: 2, overrides: { ...mirror, Stage: 'final' } },
                         { preset: 'clear_crystal', time: 2, overrides: { ...mirror, Stage: 'reflection' } });
    check('energy_conserving_mirror_is_pure_reflection', r.max <= 2, r,
      'With Energy conserving on and Mirror 1, nothing shows through: the final image equals the reflection stage (demo lights on, light terms off).');
  });
  {
    const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const violet = [0.72, 0.6, 1.0];
    const r = await diff({ preset: 'violet_gel', time: 2, overrides: { Stage: 'body', Colourspace: 'srgb' } },
                         { preset: 'violet_gel', time: 2, overrides: { Stage: 'body', Colourspace: 'raw',
                           Glasscolorr: srgbToLinear(violet[0]), Glasscolorg: srgbToLinear(violet[1]), Glasscolorb: srgbToLinear(violet[2]) } });
    const plain = await diff({ preset: 'violet_gel', time: 2, overrides: { Stage: 'body', Colourspace: 'srgb' } },
                             { preset: 'violet_gel', time: 2, overrides: { Stage: 'body', Colourspace: 'raw' } });
    check('srgb_colour_mode_decodes_colours', r.max <= 2 && plain.max > 10, { srgb_vs_converted_by_hand: r, srgb_vs_as_typed: plain },
      'Colour parameters set to sRGB render like the same colours converted to linear by hand (Violet Gel, body stage), and differently from the colours as typed.');
  }

  // ---------------------------------------------------------------- C1: the Refraction TOP's alpha
  {
    const EMPTY = [0, 0, 0, 0], HALF = [0.25, 0.25, 0.25, 0.5];  // premultiplied, as a Render TOP stores them
    const empty = await diffRGBA({ preset: 'clear_crystal', time: 2, flatBackdrop: EMPTY, overrides: INVISIBLE },
                                 { backdropOnly: true, flatBackdrop: EMPTY });
    const half = await diffRGBA({ preset: 'clear_crystal', time: 2, flatBackdrop: HALF, overrides: INVISIBLE },
                                { backdropOnly: true, flatBackdrop: HALF });
    check('transparent_scene_stays_transparent', empty.max <= 2,
      { alpha_0_scene: empty, known_limit_alpha_half_scene_not_asserted: half },
      'Over a Refraction TOP with a transparent background (alpha 0), invisible glass (IOR 1, light terms off, both demo lights and the Environment Light on) leaves the image exactly as the scene: colour and alpha. (6a58487 wrote alpha 1, so clear glass turned an empty background opaque black.) Measured, not asserted: where the scene is only partly covered (alpha 0.5, as on antialiased edges), the bent scene is drawn and blending adds the scene behind it again by the glass\'s see-through share (a documented limit).');
    const tinted = { preset: 'violet_gel', time: 2, flatBackdrop: EMPTY };
    const r = await diffRGBA(tinted, { ...tinted, refraction: false });
    check('empty_scene_matches_no_refraction_top', r.max <= 2, r,
      'Where the Refraction TOP is empty (alpha 0), the glass blends exactly as it does with no Refraction TOP connected (Violet Gel, colour and alpha): one formula covers both.');
    const seen = {};
    const still = { Frost: 0, Wobble: 0, Iridescence: 0 };  // R6 and R1 change these on purpose (review.md)
    for (const name of PRESETS) {
      const o = { preset: name, time: 2, mesh: 'knot', spin: 0, tilt: 25, overrides: still };
      seen[name] = await diffRGBA(o, { ...o, reference: true });
    }
    check('opaque_scene_matches_pre_sync', Object.values(seen).every((x) => x.max <= 1), seen,
      'Over an opaque Refraction TOP (the demo backdrop), each of the twelve presets renders as the 6a58487 material did, within 1/255, colour and alpha (knot, demo key and rim lights and Environment Light), with Frost, Wobble and Iridescence at 0: the R2 frost disc and the re-seeded drift noise change those three on purpose (review.md, before/after numbers).');
  }

  // ---------------------------------------------------------------- C2: extra colour buffers
  await guard('extra_colour_buffers_get_zeros', 'In a render with three colour buffers, buffer 0 holds the glass and buffers 1 and 2 hold zeros.', async () => {
    const CLEAR = [0.5, 0.5, 0.5, 0.5];
    const mrt = await page.evaluate(([CLEAR]) => {
      const o = { preset: 'prism_chrome', time: 2, clearBuffers: CLEAR };
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
      'In a render with three colour buffers (TD_NUM_COLOR_BUFFERS 3, cleared to 0.5, blending off), buffer 0 holds exactly the single-buffer glass and buffers 1 and 2 hold zeros wherever the glass is drawn, written at constant indices. (The 6a58487 loop over the buffers does not compile in WebGL2: a fragment output array needs constant indices there.)');
  });

  // ---------------------------------------------------------------- C3: dispersion level (not adopted; guards the decision)
  {
    const dispersed = {};
    for (const preset of ['clear_crystal', 'prism_chrome']) for (const thick of [null, 2.5]) {
      dispersed[`${preset}_thickness_${thick ?? 'preset'}`] = await page.evaluate(([preset, thick]) => {
        const o = (n) => ({ preset, time: 2, sampleCap: n > 32 ? n : undefined,
          overrides: { Stage: 'refraction', Dispersion: 1, Samples: n, ...(thick ? { Thickness: thick } : {}) } });
        const grab = (opts) => { window.preview.draw(opts); return window.preview.pixels().slice(); };
        const bg = grab({ backdropOnly: true }), a = grab(o(12)), b = grab(o(64));
        const d = (x, y, i) => Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
        let glass = 0, sum = 0, over32 = 0, max = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (d(b, bg, i) === 0 && d(a, bg, i) === 0) continue;
          glass++; const e = d(a, b, i); sum += e; max = Math.max(max, e); if (e > 32) over32++;
        }
        return { glass_pixels: glass, mean: +(sum / glass).toFixed(2), max, pixelsOver32: over32 };
      }, [preset, thick]);
    }
    check('dispersion_converges_with_samples',
      Object.entries(dispersed).every(([k, r]) => r.pixelsOver32 === 0 && r.mean <= (k.endsWith('2.5') ? 2.5 : 1.0)), dispersed,
      'Dispersion 1 at the default 12 samples agrees with a 64-sample render: no glass pixel differs by more than 32/255, and the mean difference stays within 1/255 (2.5/255 with Thickness 2.5), on Clear Crystal and Prism Chrome (refraction stage, torus). The core study measured the fan-gap mip level from the blobs study worse than this (decisions.json), so it was not adopted; a change that blurs the rainbow fails here (the whole gap: mean 3.97 with 290 pixels over 32 on Clear Crystal at Thickness 2.5). A quarter of the gap (what the blobs study adopted) passes and changes no pixel at the presets\' own Thickness (decisions.json, C3).');
  }

  // ---------------------------------------------------------------- C6: screen orientation
  await guard('bends_follow_screen_orientation', 'see below', async () => {
    const versus = (o, variant, mirror) => page.evaluate(([o, variant, mirror]) => {
      window.preview.draw(o); const a = window.preview.pixels().slice();
      window.preview.draw({ ...o, ...variant, overrides: { ...(o.overrides || {}), ...(variant.overrides || {}) } });
      const b = window.preview.pixels(); const [W, H] = window.preview.size;
      let max = 0, over8 = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, j = ((mirror ? H - 1 - y : y) * W + x) * 4;
        const dd = Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2]));
        max = Math.max(max, dd); if (dd > 8) over8++;
      }
      return { max, pixelsOver8: over8 };
    }, [o, variant, mirror]);
    const rows = {};
    for (const o of [{ preset: 'prism_chrome', time: 2 }, { preset: 'chrome_type', time: 2, overrides: { Demooccluder: true } }]) {
      rows[o.preset] = {
        flipped_raster: await versus(o, { flipRaster: true }, true),
        upside_down_inputs_flip_v: await versus(o, { mirrorInputs: true, overrides: { Flipv: true } }, false),
        flipped_raster_upright_inputs_flip_v: await versus(o, { flipRaster: true, mirrorInputs: true, overrides: { Flipv: true } }, true),
      };
    }
    const ok = (r) => r.pixelsOver8 <= 1000;  // antialiased silhouettes differ where the multisample pattern is not mirrored
    check('bends_follow_screen_orientation', Object.values(rows).every((r) => ok(r.flipped_raster)), rows,
      'A build whose screen y runs opposite to the projection (emulated: the rasteriser flips y, and the scene render comes from the same build) renders the exact mirror image: every bend and frost offset follows the measured orientation (at most 1000 pixels over 8/255, the antialiased rims; demo torus, Prism Chrome, and Chrome Type with the occluder bar in the scene render). The 6a58487 material bent light the wrong way up there.');
    check('flip_v_corrects_upside_down_inputs', Object.values(rows).every((r) => ok(r.upside_down_inputs_flip_v) && ok(r.flipped_raster_upright_inputs_flip_v)), rows,
      'If the Refraction TOP arrives upside down relative to the render (normal raster, or a flipped raster with an upright input), Flip V restores the normal image: it flips the base screen UV and every vertical offset together, as in the core study.');
  });

  // ---------------------------------------------------------------- C6: the orientation at every glass pixel
  // Ported from the Liquid Glass Prism study. Instrumented copies of the shader write the orientation
  // each pixel measured instead of its colour: red = 1 where x runs the usual way, green = 1 where y does.
  // The 6a58487 material had no measured orientation (it assumed the usual one), so its copy writes 1, 1.
  // Two readouts: the glass alone in a float target (one sample per pixel), and the canvas, which is
  // 4x multisampled like an antialiased Render TOP (blue = how many samples the glass covers).
  await guard('screen_orientation_has_no_wrong_pixels', 'see below', async () => {
    const OUT = '    fragColor[0] = TDOutputSwizzle(vec4(colour, alpha));\n';
    const instrument = (file, to) => {
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      if (source.split(OUT).length !== 2) throw new Error('instrument patch did not apply: ' + file);
      return source.replace(OUT, to);
    };
    const signFrag = instrument('liquid_glass_lit.frag', '    fragColor[0] = vec4(step(vec2(0.0), orient), 1.0, 1.0);\n');
    const signRefFrag = instrument('checks/reference/liquid_glass_lit.frag', '    fragColor[0] = vec4(1.0, 1.0, 1.0, 1.0);\n');
    const rows = {};
    for (const size of [[480, 270], [481, 271]]) {
      const pg = await browser.newPage();
      pg.on('pageerror', (e) => errors.push(String(e)));
      await pg.route(/\/liquid_glass_lit\.frag$/, (route) => route.fulfill({ status: 200, contentType: 'text/plain',
        body: route.request().url().includes('/checks/reference/') ? signRefFrag : signFrag }));
      await pg.goto(`http://127.0.0.1:${port}/checks/preview/index.html?harness=1&size=${size[0]}x${size[1]}`);
      await pg.evaluate(() => window.previewReady);
      if (referenceRun) await pg.evaluate(() => {
        const draw = window.preview.draw;
        window.preview.draw = (o = {}) => draw({ ...o, reference: true });
      });
      for (const mesh of ['torus', 'knot', 'sphere']) for (const flip of [false, true]) {
        rows[`${mesh}${flip ? '_flipped_raster' : ''}_${size[0]}x${size[1]}`] = await pg.evaluate(([mesh, flip, names]) => {
          const [W, H] = window.preview.size;
          const onCentreLine = (p) => Math.abs(p % W + 0.5 - W / 2) <= 1 || Math.abs(Math.floor(p / W) + 0.5 - H / 2) <= 1;
          const single = { glass_pixels: 0, wrong_sign_pixels: 0, of_them_within_a_pixel_of_a_centre_line: 0 };
          const multi = { glass_pixels: 0, wrong_sign_pixels: 0, of_them_within_a_pixel_of_a_centre_line: 0 };
          const count = (r, p, wrong) => { r.glass_pixels++; if (wrong) { r.wrong_sign_pixels++; if (onCentreLine(p)) r.of_them_within_a_pixel_of_a_centre_line++; } };
          names.forEach((preset, k) => {
            // each preset at its own pose, so the twelve renders see different silhouettes
            const o = { preset, mesh, time: 2, spin: 13.7 * k, tilt: 20 + 2.5 * k, flipRaster: flip, background: 'black' };
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
      'The measured screen orientation is right at every glass pixel but a known few: the twelve presets (each at its own pose) on the torus, the knot and the sphere, in a normal and a flipped raster, at 480 x 270 and at the odd size 481 x 271. One sample per pixel (the glass alone): at most 2 wrong pixels per row of twelve renders (measured: 1 in all 12 rows together, on the centre row of the knot in the odd-sized flipped raster, where the surface is nearly edge-on, so the tie gives +1). Four samples (the canvas, like an antialiased Render TOP): at most 10 per row (20 until the family critic\'s centre-line round; measured: at most 8, same row). Those are silhouette pixels where the glass covers one to three samples: the pixel is shaded at its centre, outside its triangle, so its point can project to the other side of a centre line (the Liquid Glass Flow finding; review.md has a wider pose sweep). Whether they are visible in TouchDesigner is a family open question with a pending native check (co-design.json; validation.json, centre_line_residual). The comparison with +1 on ties alone (the family sync\'s form) was wrong on the whole centre row of the odd size in a flipped raster: about 1,500 pixels per row. The 6a58487 material assumed the usual orientation and is wrong at every pixel of a flipped raster.');
  });

  // ---------------------------------------------------------------- C7: fog
  {
    const RED = [1, 0, 0, 1];
    const fogged = await page.evaluate(([INVISIBLE, RED]) => {
      window.preview.draw({ backdropOnly: true }); const bg = window.preview.pixels().slice();
      const run = (opacity) => {
        window.preview.draw({ preset: 'clear_crystal', time: 2, fog: RED, overrides: { ...INVISIBLE, Demolights: 'both', Opacity: opacity } });
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
    check('fog_adds_only_the_glass_share', fogged.opacity_half.glass_pixels > 1000 && fogged.opacity_half.pixels_neither_over_2 <= 1500
      && fogged.opacity_0.glass_pixels === 0, fogged,
      'With full fog (preview stand-in for TDFog) on invisible glass at Opacity 0.5, every glass pixel is half the scene plus half the fog colour within 2/255 (only antialiased silhouette pixels are neither), and at Opacity 0 the fogged glass leaves no trace. With fog off, TDFog changes nothing (opaque_scene_matches_pre_sync). The 6a58487 material ignored fog. TouchDesigner\'s own fog is a native check.');
  }

  // ---------------------------------------------------------------- C8: Object size
  {
    // The torus built at 0.1 and 10 units, the camera and the demo point lights moved with it
    // (a uniformly scaled scene), and Object size set to match: each preset looks as at size 1.
    const lightAt = (id, k) => {
      const q = STUDY_JSON.nodes.find((n) => n.id === id).parameters;
      const dimmer = parseFloat(STUDY_JSON.nodes.find((n) => n.id === id).expressions.dimmer);
      return { type: q.lighttype, pos: [q.tx * k, q.ty * k, q.tz * k], color: [q.cr * dimmer, q.cg * dimmer, q.cb * dimmer] };
    };
    const lightsAt = (k) => [lightAt('demo_key', k), lightAt('demo_rim', k)];
    const sized = {};
    for (const preset of ['prism_chrome', 'frosted_ice', 'amber_honey', 'oil_slick']) {
      const base = { preset, time: 2, lights: lightsAt(1) };
      sized[preset] = {
        size_0_1: await stats({ ...base, lights: lightsAt(0.1), sopScale: 0.1, cameraZ: 0.5, near: 0.01, overrides: { Objectsize: 0.1 } }, base, 8),
        size_10: await stats({ ...base, lights: lightsAt(10), sopScale: 10, cameraZ: 50, far: 200, overrides: { Objectsize: 10 } }, base, 8),
      };
    }
    check('object_size_carries_presets_over', Object.values(sized).every((r) => Object.values(r).every((x) => x.pixelsOver8 <= 50)), sized,
      'A preset looks the same on an object built 0.1 or 10 units across, with Object size set to match (what Fit to Glass geometry measures) and the scene scaled with it: bend, frost, tint, ripples and film all follow (final image, at most 50 pixels over 8/255). The 6a58487 material had no Object size: its bend and tint stayed in scene units.');

    // V1: the same object scaled by its Geometry COMP instead, TouchDesigner's usual way to
    // size an object. Fit to Glass geometry then sets Object size to that scale (half the bounds
    // x the COMP's world scale, over 1.45). Object size is the object's size in the world, so
    // the ripple and film patterns must follow it as the lengths do. Before the V1 fix they
    // stayed in object space and came out 10 times finer at COMP scale 0.1.
    const comp = {};
    for (const [preset, stage] of [['aqua_jelly', 'normal'], ['oil_slick', 'film'], ['aqua_jelly', 'final'],
                                   ['oil_slick', 'final'], ['prism_chrome', 'final'], ['frosted_ice', 'final']]) {
      const base = { preset, time: 2, lights: lightsAt(1), overrides: { Stage: stage } };
      comp[`${preset}_${stage}`] = {
        comp_scale_0_1: await stats({ ...base, lights: lightsAt(0.1), scale: 0.1, cameraZ: 0.5, near: 0.01, overrides: { Stage: stage, Objectsize: 0.1 } }, base, 8),
        comp_scale_10: await stats({ ...base, lights: lightsAt(10), scale: 10, cameraZ: 50, far: 200, overrides: { Stage: stage, Objectsize: 10 } }, base, 8),
      };
    }
    // Fit threshold (family critic, low): every case measures 1/255, so the test holds 2/255 at every
    // pixel. The family's shared clause (at most 50 pixels over 8/255) stays; Prism and Blobs keep only
    // their own recorded bounds. A worldScale() exponent of 0.3333 instead of 1/3 gives up to 23/255 on
    // 4 pixels over 8: the shared clause alone passes it, the 2/255 clause does not.
    check('fit_size_carries_presets_over_comp_scale', Object.values(comp).every((r) => Object.values(r).every((x) => x.max <= 2 && x.pixelsOver8 <= 50)), comp,
      'A preset looks the same on an object scaled 0.1 or 10 by its Geometry COMP, with Object size set to that scale (what Fit to Glass geometry sets) and the scene scaled with it: the ripples (normal stage), the film bands (film stage) and the final image, within 2/255 at every pixel (measured: 1/255), and so at most 50 pixels over 8/255 (the family\'s shared clause). The pattern frequencies are multiplied by the world scale, so Object size means the same world size for the patterns as for Thickness, Frost and Tint density.');
  }

  // ---------------------------------------------------------------- C9: demo backdrops
  {
    const checker = await diffRGBA({ backdropOnly: true }, { backdropOnly: true, reference: true });
    const type = await page.evaluate(() => {
      window.preview.draw({ backdropOnly: true, overrides: { Backdrop: 'type' } }); const px = window.preview.pixels();
      let dark = 0, ink = 0; const n = px.length / 4;
      for (let i = 0; i < px.length; i += 4) {
        const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
        if (l < 40) dark++; if (l > 200) ink++;
      }
      return { dark_share: +(dark / n).toFixed(3), white_ink_share: +(ink / n).toFixed(3) };
    });
    check('backdrop_menu_switches_the_demo_scene', checker.max === 0 && type.dark_share > 0.6 && type.white_ink_share > 0.05,
      { checker_vs_6a58487: checker, type },
      'Study > Backdrop: Checker (the default) is the 6a58487 backdrop exactly; Type is a black page with heavy white type (most pixels dark, at least 5% white ink), the backdrop of the core and Prism studies, so the family\'s contact sheets compare.');
  }

  await browser.close();
  const report = { ok: results.every((r) => r.ok) && !errors.length, passed: results.filter((r) => r.ok).length,
    total: results.length, errors, results,
    material: referenceRun ? 'checks/reference (commit 6a58487)' : 'delivered',
    scope: 'Shader maths and study.json bindings in WebGL2 (SwiftShader) with stand-in TouchDesigner light functions. Not a TouchDesigner render.' };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
})();
