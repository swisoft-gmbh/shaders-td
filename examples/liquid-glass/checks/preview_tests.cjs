// Property tests of the delivered GLSL, run through the WebGL2 preview.
//
//   node checks/preview_tests.cjs <port>               (serve the study folder on <port> first)
//   node checks/preview_tests.cjs <port> --reference   (run every test against the 6a58487 material
//                                                       in checks/reference/, to see which tests guard
//                                                       the family sync: those must fail there)
//
// Each test states a relationship that must hold whatever the look, e.g.
// "glass that does not bend light is invisible". They test the shader maths
// and the study.json bindings in a browser GPU (SwiftShader), not TouchDesigner.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const QUIET = { Reflection: 0, Rim: 0, Specular: 0, Diffuse: 0, Iridescence: 0, Wobble: 0 };
const INVISIBLE = { ...QUIET, Ior: 1.0, Dispersion: 0, Frost: 0, Density: 0, Saturation: 1, Stage: 'final' };
const PRESETS = ['clear_crystal', 'prism_chrome', 'violet_gel', 'sapphire_drop', 'chrome_type', 'frosted_ice',
  'amber_honey', 'emerald_bottle', 'rose_quartz', 'liquid_mercury', 'oil_slick', 'aqua_jelly'];

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

  // Pixel-difference statistics of two renders: max, count over a threshold, 99th percentile.
  const stats = (a, b, threshold) => page.evaluate(([a, b, threshold]) => {
    window.preview.draw(a); const pa = window.preview.pixels();
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
    window.preview.draw(a); const pa = window.preview.pixels();
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

  const pixelsAt = (opts, points) => page.evaluate(([opts, points]) => {
    window.preview.draw(opts); const p = window.preview.pixels(); const [W] = window.preview.size;
    return points.map(([x, y]) => Array.from(p.slice((y * W + x) * 4, (y * W + x) * 4 + 4)));
  }, [opts, points]);

  const results = [];
  const check = (name, ok, evidence, claim) => results.push({ name, ok, claim, evidence });
  // A test whose draw throws (a shader that does not compile in WebGL2, an option the harness
  // lacks) fails with the error as evidence.
  const guard = async (name, claim, body) => {
    try { await body(); } catch (e) { check(name, false, { error: String(e).slice(0, 600) }, claim); }
  };

  let d = await diff({ preset: 'clear_crystal', time: 2, overrides: INVISIBLE }, { backdropOnly: true });
  check('ior1_is_invisible', d.max <= 2, d,
    'With IOR 1, saturation 1 and no dispersion, frost, tint or light terms, the glass shows exactly the refraction TOP.');

  d = await diff({ preset: 'clear_crystal', time: 2, overrides: { ...INVISIBLE, Wobble: 0.6, Wobblescale: 1.6, Wobblespeed: 0.6 } },
                 { backdropOnly: true });
  check('ior1_is_invisible_with_wobble', d.max <= 2, d,
    'Ripples do not undo the silhouette fix: at IOR 1 the rippled glass is still invisible (normals are turned toward the camera after the wobble).');

  d = await diff({ preset: 'prism_chrome', time: 2, overrides: { Opacity: 0 } }, { backdropOnly: true });
  check('opacity0_is_invisible', d.max <= 2, d, 'Opacity 0 removes the glass entirely, reflections included.');

  d = await diff({ preset: 'clear_crystal', time: 2, refraction: false, overrides: INVISIBLE }, { backdropOnly: true });
  check('no_refraction_top_blends_clear', d.max <= 2, d,
    'With no refraction TOP, clear untinted glass with no light terms blends to the real background (alpha 0).');

  d = await diff({ preset: 'clear_crystal', time: 2, overrides: { Stage: 'refraction', Dispersion: 0, Frost: 0, Samples: 1 } },
                 { preset: 'clear_crystal', time: 2, overrides: { Stage: 'refraction', Dispersion: 0, Frost: 0, Samples: 16 } });
  check('samples_invariant_without_dispersion', d.max <= 2, d,
    'Without dispersion or frost, every sample is identical, so the sample count cannot change the image.');

  d = await diff({ preset: 'prism_chrome', time: 2, overrides: { Morphtarget: 'violet_gel', Morph: 1 } },
                 { preset: 'violet_gel', time: 2 });
  check('morph1_equals_target', d.max <= 2, d, 'Morph 1 toward a preset renders that preset.');

  d = await diff({ preset: 'violet_gel', time: 2, overrides: { Morphtarget: 'amber_honey', Morph: 0 } },
                 { preset: 'violet_gel', time: 2 });
  check('morph0_is_neutral', d.max <= 2, d, 'Morph 0 leaves the current look unchanged.');

  // Consecutive frames: the second draw continues the drift like a running component
  // (presets.py advance(), mirrored in preview.js). The object does not spin (spin: 0).
  const frames = (a, b) => stats({ spin: 0, ...a }, { spin: 0, ...b, drift: 'continue' }, 8);
  const morphFrame = (stage, T) => frames(
    { preset: 'prism_chrome', time: T, overrides: { Stage: stage, Morphtarget: 'violet_gel', Morph: 0.5 } },
    { preset: 'prism_chrome', time: T + 1 / 60, overrides: { Stage: stage, Morphtarget: 'violet_gel', Morph: 0.51 } });
  const morph = {};
  for (const stage of ['final', 'film']) for (const T of [2, 3600]) morph[`${stage}_t${T}`] = await morphFrame(stage, T);
  check('morph_frame_is_smooth_after_an_hour',
    ['final', 'film'].every((s) => morph[`${s}_t3600`].max <= morph[`${s}_t2`].max + 12
      && morph[`${s}_t3600`].p99OfAllPixels <= morph[`${s}_t2`].p99OfAllPixels + 3), morph,
    'One frame of a 100-frame A/B morph (Morph 0.50 to 0.51 in 1/60 s) changes the image no more after an hour than after 2 s: the ripple and film drift is integrated, so changing its speed never throws the pattern. (rate x speed x absolute time jumped up to 226/255 in the final image and 255/255 in the film.)');

  const jelly = (T, speed) => ({ preset: 'aqua_jelly', time: T, overrides: { Stage: 'normal', Wobblespeed: speed } });
  const steady = await frames(jelly(3600, 0.6), jelly(3600 + 1 / 60, 0.6));
  const nudged = await frames(jelly(3600, 0.6), jelly(3600 + 1 / 60, 0.61));
  check('speed_change_is_smooth_after_an_hour', nudged.max <= Math.max(steady.max, 2) + 2, { steady, nudged },
    'After an hour, nudging Wobble speed from 0.60 to 0.61 changes one frame no more than one frame of motion at a fixed speed does (Aqua Jelly, normal stage). (Previously up to 79/255.)');

  // Back-face pass on a unit sphere: measured thickness must equal the exact chord along each pixel's ray.
  const [W, H] = await page.evaluate(() => window.preview.size);
  const aspect = W / H, y = Math.floor(H / 2);
  // Thickness stage shows thickness / (2 * Thickness), so Thickness = chord scale / 2.
  const chordTest = async (view, offsets, thickness) => {
    const cols = offsets.map((dx) => Math.floor(W / 2) + dx);
    const measured = await pixelsAt({ preset: 'clear_crystal', time: 2, mesh: 'sphere', spin: 0, tilt: 0, ...view,
      overrides: { Backface: true, Stage: 'thickness', Thickness: thickness, Wobble: 0 } }, cols.map((x) => [x, y]));
    return cols.map((x, i) => {
      const nx = ((x + 0.5) / W) * 2 - 1, ny = ((y + 0.5) / H) * 2 - 1;
      let dist;  // distance from the sphere centre to the pixel's ray
      if (view.ortho) dist = Math.hypot(nx * view.ortho * aspect, ny * view.ortho);  // parallel rays
      else {
        const t = Math.tan((view.fov ?? 45) * Math.PI / 360);
        const dir = [nx * t * aspect, ny * t, -1]; const l = Math.hypot(...dir);
        dist = (view.cameraZ ?? 5) * Math.hypot(dir[0], dir[1]) / l;
      }
      const chord = dist < 1 ? 2 * Math.sqrt(1 - dist * dist) : 0;
      const expected = Math.min(chord / (2 * thickness), 1) * 255;
      return { x, expected: +expected.toFixed(1), measured: measured[i][0], chord: +chord.toFixed(4) };
    });
  };
  let rows = await chordTest({}, [0, 40, 80, 110, 128], 2.0);
  check('backface_thickness_matches_chord', rows.every((r) => Math.abs(r.expected - r.measured) <= 3), rows,
    'With the back-face pass, thickness equals the exact chord length through a unit sphere (within 3/255).');

  // Same framing from 10x further with a 10x narrower lens: distances near 50 units. Half-float
  // storage (0.03 units per step at 50) would miss by up to about 4/255; 32-bit float stays exact.
  const farFov = 2 * Math.atan(Math.tan(22.5 * Math.PI / 180) * 5 / 50) * 180 / Math.PI;
  rows = await chordTest({ fov: farFov, cameraZ: 50, far: 200 }, [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120], 1.0);
  check('backface_thickness_matches_chord_far', rows.every((r) => Math.abs(r.expected - r.measured) <= 2), rows,
    'At 50 units from the camera the measured thickness still equals the exact chord (within 2/255): distances are stored as 32-bit floats.');

  rows = await chordTest({ ortho: 1.5, cameraZ: 1.5, near: 0.01 }, [0, 30, 60, 90, 120, 150, 165], 1.0);
  check('backface_thickness_matches_chord_orthographic', rows.every((r) => Math.abs(r.expected - r.measured) <= 3), rows,
    'With an orthographic camera, measured thickness equals the chord along the parallel rays, off axis too (within 3/255).');

  const GREY = [0.5, 0.5, 0.5];
  const QUIET_BACK = { ...QUIET, Backface: true, Ior: 1.5, Density: 0 };
  d = await diff({ preset: 'clear_crystal', time: 2, mesh: 'knot', flatBackdrop: GREY, overrides: QUIET_BACK },
                 { backdropOnly: true, flatBackdrop: GREY });
  check('backface_pass_adds_no_dark_fringe', d.max <= 2, d,
    'Over a uniform grey scene, clear glass with the back-face pass stays exactly grey: the back-face lookup never blends in the empty background (knot, IOR 1.5).');

  // Same object at Geometry COMP scale 0.1, 1 and 10, camera distance scaled with it, and Object size
  // set to the scale, as Fit to Glass geometry sets it (family close G1: the ripple count follows the
  // world size; the tilt itself never depended on Object size): identical image.
  const ripples = { preset: 'aqua_jelly', time: 2, overrides: { Stage: 'normal', Wobble: 0.6 } };
  const small = await stats({ ...ripples, scale: 0.1, cameraZ: 0.5, near: 0.01, overrides: { ...ripples.overrides, Objectsize: 0.1 } }, ripples, 8);
  const large = await stats({ ...ripples, scale: 10, cameraZ: 50, far: 200, overrides: { ...ripples.overrides, Objectsize: 10 } }, ripples, 8);
  check('wobble_independent_of_object_scale', small.max <= 12 && large.max <= 12 && small.pixelsOver8 <= 50 && large.pixelsOver8 <= 50,
    { scale01: small, scale10: large },
    'Wobble tilts the normals by the same amount whether the object is scaled 0.1, 1 or 10 by its Geometry COMP, the camera moved with it and Object size set to the scale, as Fit to Glass geometry sets it (normal stage).');

  const faceted = { preset: 'clear_crystal', time: 2, mesh: 'sphere', noNormals: true, overrides: { Stage: 'normal' } };
  const facetScale = await stats({ ...faceted, scale: 0.1, cameraZ: 0.5, near: 0.01 }, faceted, 8);
  const facetSmooth = await stats(faceted, { ...faceted, noNormals: false }, 8);
  check('faceted_fallback_without_normals', facetScale.max <= 12 && facetScale.pixelsOver8 <= 50 && facetSmooth.p99OfAllPixels <= 16,
    { scale01_vs_scale1: facetScale, faceted_vs_smooth: facetSmooth },
    'Geometry without normals gets faceted normals from screen derivatives, close to the smooth normals and the same at any scale (sphere, 0.1 vs 1).');

  const frosted = (n) => ({ preset: 'clear_crystal', time: 2, overrides: { Stage: 'refraction', Dispersion: 0, Frost: 0.6, Samples: n } });
  const frost = await stats(frosted(12), frosted(32), 16);
  check('frost_converges_with_samples', frost.max <= 16, frost,
    'Frost 0.6 is a continuous blur: 12 and 32 samples agree within 16/255 at every pixel. (Without the mipmap widening, ghost copies make them differ by up to 31/255.)');

  // Family sync C3 (rejected; this test guards the decision): at the default 12 samples, high
  // dispersion already matches a 64-sample render closely. The fan-gap mip level from the blobs
  // study made it worse (decisions.json), so a change that blurs the rainbow fails here.
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
    'Dispersion 1 at the default 12 samples agrees with a 64-sample render: no glass pixel differs by more than 32/255, and the mean difference stays within 1/255 (2.5/255 with Thickness 2.5), on Clear Crystal and Prism Chrome (refraction stage, torus). A blurring mip level on the rainbow fan (tried in the family sync, from the blobs study) failed this: up to 377 pixels over 32/255 and twice the mean error.');

  const mirror = { ...QUIET, Reflection: 1, Mirror: 1, Conserve: true };  // QUIET turns reflections off; back on here
  d = await diff({ preset: 'clear_crystal', time: 2, overrides: { ...mirror, Stage: 'final' } },
                 { preset: 'clear_crystal', time: 2, overrides: { ...mirror, Stage: 'reflection' } });
  check('energy_conserving_mirror_is_pure_reflection', d.max <= 2, d,
    'With Energy conserving on and Mirror 1, nothing shows through: the final image equals the reflection stage.');

  const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const violet = [0.72, 0.6, 1.0];
  d = await diff({ preset: 'violet_gel', time: 2, overrides: { Stage: 'body', Colourspace: 'srgb' } },
                 { preset: 'violet_gel', time: 2, overrides: { Stage: 'body', Colourspace: 'raw',
                   Glasscolorr: srgbToLinear(violet[0]), Glasscolorg: srgbToLinear(violet[1]), Glasscolorb: srgbToLinear(violet[2]) } });
  check('srgb_colour_mode_decodes_colours', d.max <= 2, d,
    'Colour parameters set to sRGB render like the same colours converted to linear by hand (Violet Gel, body stage).');

  // ---------------------------------------------------------------- family sync C1: the Refraction TOP's alpha
  {
    const EMPTY = [0, 0, 0, 0], HALF = [0.25, 0.25, 0.25, 0.5];  // premultiplied, as a Render TOP stores them
    const empty = await diffRGBA({ preset: 'clear_crystal', time: 2, flatBackdrop: EMPTY, overrides: INVISIBLE },
                                 { backdropOnly: true, flatBackdrop: EMPTY });
    // Fix V1: the same with Inputs > Back-face pass on (the back-face branch used to count as covered = 1).
    const emptyBack = await diffRGBA({ preset: 'clear_crystal', time: 2, flatBackdrop: EMPTY, overrides: { ...INVISIBLE, Backface: true } },
                                     { backdropOnly: true, flatBackdrop: EMPTY });
    const half = await diffRGBA({ preset: 'clear_crystal', time: 2, flatBackdrop: HALF, overrides: INVISIBLE },
                                { backdropOnly: true, flatBackdrop: HALF });
    check('transparent_scene_stays_transparent', empty.max <= 2 && emptyBack.max <= 2,
      { alpha_0_scene: empty, alpha_0_scene_backface_pass: emptyBack, known_limit_alpha_half_scene_not_asserted: half },
      'Over a Refraction TOP with a transparent background (alpha 0), invisible glass (IOR 1, no tint or light terms) leaves the image exactly as the scene: colour and alpha, with the back-face pass off and on. (The 6a58487 material wrote alpha 1, so clear glass turned the empty background opaque black. Until fix V1 the back-face pass did the same: max 255/255 on 93,845 pixels.) Measured, not asserted: where the scene is only partly covered (alpha 0.5, as on antialiased edges), the glass draws the bent scene and blending adds the scene behind it again by the glass\'s see-through share, so the pixel comes out brighter and more opaque (a documented limit).');
    const tinted = { preset: 'violet_gel', time: 2, flatBackdrop: EMPTY };
    d = await diffRGBA(tinted, { ...tinted, refraction: false });
    const tintedBack = { ...tinted, overrides: { Backface: true } };
    const backNote = await diffRGBA(tintedBack, { ...tintedBack, refraction: false });
    check('empty_scene_matches_no_refraction_top', d.max <= 2, { back_face_pass_off: d, back_face_pass_on_not_asserted: backNote },
      'Where the Refraction TOP is empty (alpha 0), the glass blends exactly as it does with no Refraction TOP connected (Violet Gel, colour and alpha): one formula covers both. Measured, not asserted: with the back-face pass on, alpha still matches, but the inner surface\'s own reflections show over the empty scene; with no Refraction TOP the material reads nothing behind it, inner surface included.');
    const presetsSeen = {};
    for (const name of PRESETS) {
      presetsSeen[name] = await diffRGBA({ preset: name, time: 2, mesh: 'knot' }, { preset: name, time: 2, mesh: 'knot', reference: true });
    }
    // Fix V1: the back-face branch now reads the scene's alpha too; over an opaque scene that is 1, as before.
    for (const name of PRESETS) {
      const o = { preset: name, time: 2, mesh: 'knot', overrides: { Backface: true } };
      presetsSeen[`${name}_backface_pass`] = await diffRGBA(o, { ...o, reference: true });
    }
    check('opaque_scene_matches_pre_sync', Object.values(presetsSeen).every((r) => r.max <= 1), presetsSeen,
      'Over an opaque Refraction TOP (alpha 1, the demo backdrop), each of the twelve presets renders as the 6a58487 material did, within 1/255 (knot), with the back-face pass off and on.');
  }

  // ---------------------------------------------------------------- family sync C2: extra colour buffers
  {
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
      'In a render with three colour buffers (TD_NUM_COLOR_BUFFERS 3, cleared to 0.5, blending off), buffer 0 holds exactly the single-buffer glass and buffers 1 and 2 hold zeros wherever the glass is drawn (with the material\'s premultiplied blending, zeros leave those buffers unchanged). The 6a58487 material wrote buffer 0 only.');
  }

  // ---------------------------------------------------------------- family sync C5: output cap
  {
    const floats = (o) => page.evaluate((o) => {
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
      cameraZ: 1500, fov: 2 * Math.atan(Math.tan(22.5 * Math.PI / 180) * 5 / 1500) * 180 / Math.PI, far: 3000,
      overrides: { Backface: true } });
    check('output_fits_half_float', hot.nonFinite === 0 && hot.maxRGB <= 1024 && far.maxAlpha > 1400, { hot_highlight: hot, back_pass_far_away: far },
      'A light colour of 200,000 (a typed value, or an HDR multiplier) still gives finite colour no higher than 1024 in an rgba16float render (half floats end at 65504; the 6a58487 material wrote infinity there). The cap is on colour only: the back-face pass of a sphere 1500 units away still stores distances above 1400 in alpha.');
  }

  // ---------------------------------------------------------------- family sync C6: screen orientation
  {
    // a: a normal render; b: drawn as `variant`, then compared with a read upside down (mirror) or not.
    const versus = (o, variant, mirror) => page.evaluate(([o, variant, mirror]) => {
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
      const key = o.preset + (o.overrides ? '_flat_image_backface' : '');
      rows[key] = {
        flipped_raster: await versus(o, { flipRaster: true }, true),
        upside_down_inputs_flip_v: await versus(o, { mirrorInputs: true, overrides: { Flipv: true } }, false),
        flipped_raster_upright_inputs_flip_v: await versus(o, { flipRaster: true, mirrorInputs: true, overrides: { Flipv: true } }, true),
      };
    }
    const ok = (r) => r.pixelsOver8 <= 1000;  // antialiased silhouettes: about 650 differ in a correct mirror
    check('bends_follow_screen_orientation', Object.values(rows).every((r) => ok(r.flipped_raster)), rows,
      'A build whose screen y runs opposite to the projection (emulated: the rasteriser flips y, and the scene render and back-face pass come from the same build) renders the exact mirror image: bends, frost, the flat-image reflection and the back-face pass all follow (at most 1000 pixels over 8/255; the multisample pattern is not mirrored, so bright antialiased rims differ on about 650 pixels even where the image is right). The 6a58487 material bent light the wrong way up there (about 73,000 pixels).');
    check('flip_v_corrects_upside_down_inputs', Object.values(rows).every((r) => ok(r.upside_down_inputs_flip_v) && ok(r.flipped_raster_upright_inputs_flip_v)), rows,
      'If the Refraction TOP and the back-face pass arrive upside down relative to the render (normal raster, or a flipped raster with upright inputs), Flip V restores the normal image: it flips the base screen UV and every vertical offset together. (The 6a58487 Flip V flipped the UV only, which is right only for the second case.)');
  }

  // ---------------------------------------------------------------- family close G2: the orientation at every glass pixel
  // Ported from Liquid Glass Lit (which took it from Liquid Glass Prism). Instrumented copies of the
  // shader write the orientation each pixel measured instead of its colour: red = 1 where x runs the
  // usual way, green = 1 where y does. The 6a58487 material had no measured orientation (it assumed
  // the usual one), so its copy writes 1, 1. Two readouts: the glass alone in a float target (one
  // sample per pixel), and the canvas, which is 4x multisampled like an antialiased Render TOP
  // (blue = how many samples the glass covers). Sizes 480 x 270 and the odd 481 x 271, whose
  // centre row and column sit exactly on the centre lines.
  await guard('screen_orientation_has_no_wrong_pixels', 'see below', async () => {
    // The output line: one colour buffer in 6a58487, an array of them since the family sync (C2).
    const instrument = (file, out, to) => {
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      if (source.split(out).length !== 2) throw new Error('instrument patch did not apply: ' + file);
      return source.replace(out, to);
    };
    const signFrag = instrument('liquid_glass.frag', '    fragColor[0] = TDOutputSwizzle(vec4(colour, alpha));\n',
                                '    fragColor[0] = vec4(step(vec2(0.0), orient), 1.0, 1.0);\n');
    const signRefFrag = instrument('checks/reference/liquid_glass.frag', '    fragColor = TDOutputSwizzle(vec4(colour, alpha));\n',
                                   '    fragColor = vec4(1.0, 1.0, 1.0, 1.0);\n');
    const rows = {};
    for (const size of [[480, 270], [481, 271]]) {
      const pg = await browser.newPage();
      pg.on('pageerror', (e) => errors.push(String(e)));
      await pg.route(/\/liquid_glass\.frag$/, (route) => route.fulfill({ status: 200, contentType: 'text/plain',
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
            const o = { preset, mesh, time: 2, spin: 13.7 * k, tilt: 20 + 2.5 * k, flipRaster: flip, flatBackdrop: [0, 0, 0, 1] };
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
      'The measured screen orientation is right at every glass pixel but a known few, on the centre lines too: the twelve presets (each at its own pose) on the torus, the knot and the sphere, in a normal and a flipped raster, at 480 x 270 and at the odd size 481 x 271. One sample per pixel (the glass alone): at most 2 wrong pixels per row of twelve renders. Four samples (the canvas, like an antialiased Render TOP): at most 10 per row (20 until the family critic\'s centre-line round; measured: at most 8). The few left are a centre-line pixel on a nearly edge-on surface (the tie keeps +1) and silhouette pixels where the glass covers one to three samples of four: the pixel is shaded at its centre, outside its triangle, so its point can project to the other side of a centre line (the Liquid Glass Flow finding). Whether they are visible in TouchDesigner is a family open question with a pending native check (co-design.json; validation.json, centre_line_residual). The family sync\'s comparison with +1 on ties was wrong on the whole centre row of the odd size in a flipped raster (about 1,500 pixels per row). Same test and thresholds as Liquid Glass Lit. The 6a58487 material assumed the usual orientation and is wrong at every pixel of a flipped raster.');
  });

  // ---------------------------------------------------------------- family sync C7: fog
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
      'With full fog (preview stand-in) on invisible glass at Opacity 0.5, every glass pixel is half the scene plus half the fog colour within 2/255 (only antialiased silhouette pixels, which mix glass and scene, are neither), and at Opacity 0 the fogged glass leaves no trace. With fog off, TDFog changes nothing (opaque_scene_matches_pre_sync). The 6a58487 material ignored fog. TouchDesigner\'s own fog is a native check.');
  }

  // ---------------------------------------------------------------- family sync C8: Object size
  {
    // The same torus built at 0.1 and 10 units (the SOP itself, not the Geometry COMP's scale), the
    // camera moved with it, and Object size set to match: each preset looks as it does at size 1.
    const sized = {};
    for (const preset of ['prism_chrome', 'frosted_ice', 'amber_honey', 'oil_slick']) {
      const base = { preset, time: 2 };
      sized[preset] = {
        size_0_1: await stats({ ...base, sopScale: 0.1, cameraZ: 0.5, near: 0.01, overrides: { Objectsize: 0.1 } }, base, 8),
        size_10: await stats({ ...base, sopScale: 10, cameraZ: 50, far: 200, overrides: { Objectsize: 10 } }, base, 8),
      };
    }
    check('object_size_carries_presets_over', Object.values(sized).every((r) => Object.values(r).every((x) => x.pixelsOver8 <= 50)), sized,
      'A preset looks the same on an object built 0.1 or 10 units across, with Object size set to match (what Fit to Glass geometry measures): bend, frost, tint, ripples and film all follow (final image, at most 50 pixels over 8/255). The 6a58487 material had no Object size: its bend and tint stayed in scene units.');

    // Family close G1 (the family rule, from Liquid Glass Lit): the same object scaled by its Geometry
    // COMP instead, TouchDesigner's usual way to size an object. Fit to Glass geometry then sets
    // Object size to that scale (half the bounds x the COMP's world scale, over 1.45). Object size is
    // the object's size in the world, so the ripple and film patterns must follow it as the lengths
    // do. Before the fix they stayed in object space and came out 10 times finer at COMP scale 0.1.
    // The light is a direction (uLight), so nothing else in the scene needs scaling.
    const comp = {};
    for (const [preset, stage] of [['aqua_jelly', 'normal'], ['oil_slick', 'film'], ['aqua_jelly', 'final'],
                                   ['oil_slick', 'final'], ['prism_chrome', 'final'], ['frosted_ice', 'final']]) {
      const base = { preset, time: 2, overrides: { Stage: stage } };
      comp[`${preset}_${stage}`] = {
        comp_scale_0_1: await stats({ ...base, scale: 0.1, cameraZ: 0.5, near: 0.01, overrides: { Stage: stage, Objectsize: 0.1 } }, base, 8),
        comp_scale_10: await stats({ ...base, scale: 10, cameraZ: 50, far: 200, overrides: { Stage: stage, Objectsize: 10 } }, base, 8),
      };
    }
    // Fit threshold (family critic, low): every case measures 1/255, so the test holds 2/255 at every
    // pixel. The family's shared clause (at most 50 pixels over 8/255) stays; Prism and Blobs keep only
    // their own recorded bounds. A worldScale() exponent of 0.3333 instead of 1/3 gives 4 to 5/255 with
    // no pixel over 8: the shared clause alone passes it, the 2/255 clause does not.
    check('fit_size_carries_presets_over_comp_scale', Object.values(comp).every((r) => Object.values(r).every((x) => x.max <= 2 && x.pixelsOver8 <= 50)), comp,
      'A preset looks the same on an object scaled 0.1 or 10 by its Geometry COMP, with Object size set to that scale (what Fit to Glass geometry sets) and the camera moved with it: the ripples (normal stage), the film bands (film stage) and the final image, within 2/255 at every pixel (measured: 1/255), and so at most 50 pixels over 8/255 (the family\'s shared clause). The pattern frequencies are multiplied by the world scale, so Object size means the same world size for the patterns as for Thickness, Frost and Tint density (the family rule, Liquid Glass Lit decisions.json family_rule). Ported from Liquid Glass Lit.');

    // Family close verifier V1: the README's troubleshooting note says which way the deliberate G1 change
    // goes. A COMP scale k left at Object size 1 multiplies the pattern lookups by k, so the object shows
    // k times as many ripples and film bands: finer for k > 1, coarser for k < 1. Pattern detail = sign
    // changes of the pattern's effect along pixel rows (ripples: normal stage with Wobble 0.6 minus Wobble 0;
    // film: film stage minus Film variation 0, red channel, float probe), per 1000 adjacent glass pixels.
    // The proxy is not linear in k (bands near pixel size and noise cells larger than the object count
    // less), so the bounds test the direction and a clear margin; Object size = k must give the unscaled count.
    const detail = {};
    for (const [pattern, preset, stage, on, off] of [['ripples', 'aqua_jelly', 'normal', { Wobble: 0.6 }, { Wobble: 0 }],
                                                     ['film', 'oil_slick', 'film', {}, { Filmvariation: 0 }]]) {
      const row = {};
      for (const [name, cam, size] of [['unscaled', {}, 1], ['comp_10_object_size_1', { scale: 10, cameraZ: 50, far: 200 }, 1],
                                       ['comp_0_1_object_size_1', { scale: 0.1, cameraZ: 0.5, near: 0.01 }, 1],
                                       ['comp_10_object_size_10', { scale: 10, cameraZ: 50, far: 200 }, 10]]) {
        row[name] = await page.evaluate(([base, on, off]) => {
          const grab = (extra) => { window.preview.draw({ ...base, probe: true, overrides: { ...base.overrides, ...extra } });
                                    return window.preview.lastProbe().slice(); };
          const a = grab(on), b = grab(off);
          const [W, H] = window.preview.size;
          let changes = 0, pairs = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x + 1 < W; x++) {
            const i = (y * W + x) * 4, j = i + 4;
            if (a[i + 3] <= 0 || a[j + 3] <= 0) continue;
            pairs++;
            if ((a[i] - b[i] > 0) !== (a[j] - b[j] > 0)) changes++;
          }
          return { glass_pairs: pairs, per_1000: +(1000 * changes / pairs).toFixed(2) };
        }, [{ preset, time: 2, ...cam, overrides: { Stage: stage, Objectsize: size } }, on, off]);
      }
      const ratio = (k) => +(row[k].per_1000 / row.unscaled.per_1000).toFixed(3);
      row.ratio_comp_10_object_size_1 = ratio('comp_10_object_size_1');
      row.ratio_comp_0_1_object_size_1 = ratio('comp_0_1_object_size_1');
      row.ratio_comp_10_object_size_10 = ratio('comp_10_object_size_10');
      detail[pattern] = row;
    }
    check('comp_scale_at_object_size_1_gives_k_times_the_patterns',
      Object.values(detail).every((r) => r.unscaled.glass_pairs > 50000 && r.ratio_comp_10_object_size_1 >= 4
        && r.ratio_comp_0_1_object_size_1 <= 0.4 && Math.abs(r.ratio_comp_10_object_size_10 - 1) <= 0.02), detail,
      'An object scaled k times by its Geometry COMP but left at Object size 1 shows k times as many ripples and film bands as on the unscaled demo: finer for k = 10 (pattern detail at least 4 times the unscaled count), coarser for k = 0.1 (at most 0.4 times). With Object size 10, what Fit sets, COMP scale 10 gives the unscaled count within 2%. Aqua Jelly normal stage and Oil Slick film stage, camera moved with the scale. This pins the direction the README troubleshooting note and the G1 record state; the c94e849 shaders give ratio 1 at Object size 1.');
  }

  // ---------------------------------------------------------------- family sync C9: demo backdrops
  {
    const checker = await diffRGBA({ backdropOnly: true }, { backdropOnly: true, reference: true });
    const type = await page.evaluate(() => {
      window.preview.draw({ backdropOnly: true, overrides: { Backdrop: 'type' } }); const p = window.preview.pixels();
      let dark = 0, ink = 0, n = p.length / 4;
      for (let i = 0; i < p.length; i += 4) {
        const l = (p[i] + p[i + 1] + p[i + 2]) / 3;
        if (l < 40) dark++; if (l > 200) ink++;
      }
      return { dark_share: +(dark / n).toFixed(3), white_ink_share: +(ink / n).toFixed(3) };
    });
    check('backdrop_menu_switches_the_demo_scene', checker.max === 0 && type.dark_share > 0.6 && type.white_ink_share > 0.05,
      { checker_vs_6a58487: checker, type },
      'Study > Backdrop: Checker (the default) is the 6a58487 backdrop exactly; Type is a black page with heavy white type (most pixels dark, at least 5% white ink), the backdrop of the Liquid Glass Prism study, so the family\'s contact sheets compare. The 6a58487 backdrop had no menu.');
  }

  // ---------------------------------------------------------------- family close G4 (family sync R2): objects in front of the glass
  // Ported from Liquid Glass Prism's test of the same name, with its Over TOP control and its ball.
  // The README's route draws the glass with a Render Pass TOP into the scene render, keeping its
  // depth (Clear Depth Buffer and Clear to Camera Color off). The preview emulates it by drawing the
  // glass into a buffer that already holds the scene's colour and the ball's depth.
  await guard('render_pass_keeps_foreground_in_front', 'see below', async () => {
    const res = await page.evaluate(() => {
      const o = { preset: 'prism_chrome', time: 2 };
      window.preview.draw({ ...o, probe: true }); const glass = window.preview.lastProbe().slice();
      window.preview.draw({ ...o, occluder: {}, backdropOnly: true }); const scene = window.preview.pixels().slice();
      window.preview.draw({ ...o, backdropOnly: true }); const empty = window.preview.pixels().slice();
      window.preview.draw({ ...o, occluder: { renderPass: true } }); const pass = window.preview.pixels().slice();
      window.preview.draw({ ...o, occluder: {} }); const over = window.preview.pixels().slice();
      const [W, H] = window.preview.size;
      // Ball pixels over the glass: the ball is in the scene render, the glass covers them; 2 px away from any edge.
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
      'An opaque ball between the camera and the glass (demo torus, Prism Chrome): with the README\'s Render Pass TOP route (the glass drawn into the scene render, whose depth is kept), the image shows the ball exactly as the scene render does wherever it covers the glass (within 2/255). Control: laid over the scene with an Over TOP (the fallback, and the demo\'s own route), the glass is drawn over the ball (more than 40/255). Same emulation, ball and thresholds as Liquid Glass Prism and Flow. TouchDesigner\'s own Render Pass TOP is a native check.');
  });

  // ---------------------------------------------------------------- family close G3: film swirl frequency 0
  // Ported from Liquid Glass Flow. uFilm.w is 2.5 / Object size; no control reaches 0 (Object size has
  // a minimum), so a test hook sets it by hand, as someone wiring the material by hand might. A flat
  // sheet faces an orthographic camera with Wobble 0, so every pixel sees the film at the same angle:
  // one film thickness means one colour.
  await guard('film_swirl_frequency_0_is_one_drifting_thickness', 'see below', async () => {
    const res = await page.evaluate(() => {
      const sheet = (time, w, speed) => {
        const overrides = { Stage: 'film', Wobble: 0, ...(speed === undefined ? {} : { Wobblespeed: speed }) };
        window.preview.draw({ preset: 'prism_chrome', time, mesh: 'sheet', spin: 0, tilt: 0, ortho: 1.5, cameraZ: 3,
                              overrides, uniforms: w === undefined ? undefined : { uFilm: { w } }, probe: true });
        return window.preview.lastProbe().slice();
      };
      const range = (f) => {
        let n = 0; const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
        for (let i = 0; i < f.length; i += 4) if (f[i + 3] > 0) {
          n++; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], f[i + k]); hi[k] = Math.max(hi[k], f[i + k]); }
        }
        return { sheet_pixels: n, colour_range_255: Math.round(255 * Math.max(...hi.map((h, k) => h - lo[k]))),
                 colour_255: lo.map((x) => Math.round(255 * x)) };
      };
      const change = (a, b) => {
        let max = 0, changed = 0;
        for (let i = 0; i < a.length; i += 4) if (a[i + 3] > 0) {
          const d = Math.round(255 * Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])));
          max = Math.max(max, d); if (d > 2) changed++;
        }
        return { max, pixels_over_2: changed };
      };
      const zero2 = sheet(2, 0), zero30 = sheet(30, 0);
      return { swirl_2_5_at_2s: range(sheet(2)), swirl_0_at_2s: range(zero2), swirl_0_at_30s: range(zero30),
               swirl_0_from_2s_to_30s: change(zero2, zero30), swirl_0_speed_0_from_2s_to_30s: change(sheet(2, 0, 0), sheet(30, 0, 0)) };
    });
    check('film_swirl_frequency_0_is_one_drifting_thickness', res.swirl_0_at_2s.sheet_pixels > 10000
      && res.swirl_0_at_2s.colour_range_255 <= 2 && res.swirl_0_at_30s.colour_range_255 <= 2 && res.swirl_2_5_at_2s.colour_range_255 > 32
      && res.swirl_0_from_2s_to_30s.pixels_over_2 === res.swirl_0_at_2s.sheet_pixels && res.swirl_0_speed_0_from_2s_to_30s.max === 0, res,
      'uFilm.w = 0 (film swirl frequency, set by hand) gives one film thickness over the whole object, no swirl: on a flat sheet seen at one angle the film stage is one colour (within 2/255), where the default 2.5 swirls it. That one thickness still drifts with uPhase.w: from 2 s to 30 s every sheet pixel changes colour (Prism Chrome, Wobble speed 0.3). Wobble speed 0 stops the drift. So 0 does not freeze the film; Wobble speed 0 does. Ported from Liquid Glass Flow.');
  });

  const uvPoint = [Math.floor(W / 2) + 37, Math.floor(H / 2) - 21];
  const [uvPixel] = await pixelsAt({ preset: 'clear_crystal', time: 2, mesh: 'sphere', overrides: { Stage: 'screenuv' } }, [uvPoint]);
  const uvExpected = [(uvPoint[0] + 0.5) / W * 255, (uvPoint[1] + 0.5) / H * 255];
  check('screen_uv_matches_pixel', Math.abs(uvPixel[0] - uvExpected[0]) <= 1.5 && Math.abs(uvPixel[1] - uvExpected[1]) <= 1.5,
    { pixel: uvPoint, measured: uvPixel.slice(0, 2), expected: uvExpected.map((v) => +v.toFixed(1)) },
    'screenUV() gives the pixel position over the render size (preview viewport stand-in).');

  await browser.close();
  const report = { ok: results.every((r) => r.ok) && !errors.length, errors, results,
    material: referenceRun ? 'checks/reference (commit 6a58487)' : 'delivered',
    scope: 'Shader maths and study.json bindings in WebGL2 (SwiftShader). Not a TouchDesigner render.' };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
})();
