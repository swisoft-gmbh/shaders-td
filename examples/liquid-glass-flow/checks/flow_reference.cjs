// Float64 reference of liquid_flow.vert's motion, for the property tests.
//
// It writes the liquid field the way the tutorial describes it, in 64-bit
// JavaScript numbers and at the true (unwrapped) flow time: noise of
// q * scale + seed * scale + rate * t, a sine wave, a gravity sag. It does not
// copy the shader's precision tricks (folding the drift, the clock's wrap), so
// agreement with the shader tests those tricks too. The noise lattice repeats
// every 256 cells, as in the shader; that is part of the field's definition.
//
// Normals: the exact normal of the moved surface, (J t1) x (J t2), where J t
// is a central difference of the moved position along a tangent t with a
// step of 1e-6 SOP units (NORMAL_STEP). Two tangents t1, t2 with t1 x t2 = n.
// The length of that cross product is the area of the moved patch; on the
// unmoved surface it is (2 NORMAL_STEP)^2, so the ratio says how much the
// field squeezes (below 1) or stretches (above 1) the surface there.

function latticeHash(x, y, z) {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0; h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

const wrap = (c) => ((c + 128) & 255) - 128;  // the lattice repeats every 256 cells
function slope(x, y, z) {
  x = wrap(x); y = wrap(y); z = wrap(z);
  return [latticeHash(x, y, z) * 2 - 1, latticeHash(x + 101, y + 211, z + 307) * 2 - 1,
          latticeHash(x + 401, y + 503, z + 601) * 2 - 1];
}

function noise(p) {
  const i = p.map(Math.floor), f = p.map((v, k) => v - i[k]);
  const u = f.map((v) => v * v * v * (v * (v * 6 - 15) + 10));
  const c = (a, b, d) => { const s = slope(i[0] + a, i[1] + b, i[2] + d);
    return s[0] * (f[0] - a) + s[1] * (f[1] - b) + s[2] * (f[2] - d); };
  const mix = (a, b, t) => a + (b - a) * t;
  return 1.4 * mix(mix(mix(c(0, 0, 0), c(1, 0, 0), u[0]), mix(c(0, 1, 0), c(1, 1, 0), u[0]), u[1]),
                   mix(mix(c(0, 0, 1), c(1, 0, 1), u[0]), mix(c(0, 1, 1), c(1, 1, 1), u[0]), u[1]), u[2]);
}

const add = (a, b) => a.map((v, k) => v + b[k]);
const sub = (a, b) => a.map((v, k) => v - b[k]);
const mul = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => mul(a, 1 / Math.hypot(...a));
const NORMAL_STEP = 1e-6;
const smoothstep = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };

// The seed of instance `id`, rounded like the shader's float32 maths.
function instanceSeed(variation, id) {
  const f = Math.fround;
  const k = [0.7548777, 0.5698403, 0.4142136].map((c) => { const x = f(f(id) * f(c)); return f(x - Math.floor(x)); });
  return k.map((x) => f(f(f(variation) * 100) * x));
}

// U: { amp, t, swell, swellscale, ripples, ripplescale, waves, wavelength, dir,
//      sag, drip, along ('centre' | 'normal'), centre, size, down (object space,
//      unit or zero), seed }
function makeFlow(U) {
  function height(q, seed, t) {
    let h = 0;
    if (U.swell) {
      const s = U.swellscale;
      h += U.swell * (noise(add(mul(add(q, seed), s), [0, 0.35 * t, 0]))
           + 0.3 * noise(add(mul(add(q, seed), 1.9 * s), [0.27 * t, 0, -0.21 * t])));
    }
    if (U.ripples) h += U.ripples * noise(add(mul(add(q, seed), U.ripplescale), [0.8 * t, -0.6 * t, 0.5 * t]));
    if (U.waves) {
      const d = unit(U.dir);
      h += U.waves * Math.sin(2 * Math.PI * (dot(add(q, seed), d) / Math.max(U.wavelength, 1e-3) - 0.5 * t));
    }
    return h;
  }
  function direction(q, n) {
    if (U.along === 'normal' && dot(n, n) > 0.5) return n;
    const len = Math.hypot(...q);
    return mul(q, smoothstep(0, 0.05, len) / Math.max(len, 1e-300));
  }
  function sag(q, seed, t) {
    if (!U.sag) return [0, 0, 0];
    const down = U.down, along = dot(q, down);
    const below = Math.max(along, 0), across = sub(q, mul(down, along));
    const lumps = 0.5 + 0.5 * noise(add(add(mul(across, 1.3), seed), [0, 0, 0.08 * t]));
    return mul(down, U.sag * below * below * (1 + U.drip * (2 * lumps * lumps - 0.5)));
  }
  // Offset in object sizes and the Displacement stage value (vFlow).
  function offset(q, n) {
    const dir = direction(q, n);
    const o = mul(add(mul(dir, height(q, U.seed, U.t)), sag(q, U.seed, U.t)), U.amp);
    return { o, flow: dot(o, dir) / U.amp };
  }
  // Moved position in SOP units; normalAt(p) gives the rest normal near the surface.
  function moved(p, normalAt) {
    const q = mul(sub(p, U.centre), 1 / U.size);
    return add(p, mul(offset(q, normalAt(p)).o, U.size));
  }
  function flow(p, normalAt) { return offset(mul(sub(p, U.centre), 1 / U.size), normalAt(p)).flow; }
  function normal(p, normalAt) {
    const n = normalAt(p);
    const t1 = unit(Math.abs(n[0]) > Math.abs(n[2]) ? [-n[1], n[0], 0] : [0, -n[2], n[1]]);
    const t2 = cross(n, t1), e = NORMAL_STEP;
    const d = (t) => sub(moved(add(p, mul(t, e)), normalAt), moved(add(p, mul(t, -e)), normalAt));
    const m = cross(d(t1), d(t2));
    return dot(m, n) < 0 ? mul(m, -1) : m;
  }
  return { moved, flow, normal };
}

// Rest normals of the demo shapes, extended off the surface (needed by Normal mode).
const NORMALS = {
  sphere: (centre) => (p) => unit(sub(p, centre)),
  torus: (R) => (p) => {  // Torus SOP, orient Z: ring of radius R in the XY plane
    const ring = mul(unit([p[0], p[1], 0]), R);
    return unit(sub(p, ring));
  },
};

module.exports = { makeFlow, instanceSeed, NORMALS, NORMAL_STEP, noise, latticeHash };
