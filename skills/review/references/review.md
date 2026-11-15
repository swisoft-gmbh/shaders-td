# Native review criteria

Treat these as scoped questions, not a promise that all possible configurations
are supported.

**Reference truth:** unchanged corpus hashes; correct article/code pairing;
native adaptations labeled; original research credited; licensed content and
third-party assets distinguished. Resolve known source discrepancies explicitly.

**Host:** exact build, OS, GPU, project and component; valid parameter names and
menus; proper code DAT bindings; Info DAT compile output; actual output cook.
Each render that draws a GLSL MAT compiles its own version, cached per light and
camera setup; read errors() and warnings() on those renders too (inferred from
the docs, not yet run in TouchDesigner)
([native API notes](../../research/references/native-api.md#more-glsl-mat-and-python-facts)).

**Image route:** all fragment paths assigned, output convention, texture count,
UV/pixel mapping, input/output size differences, pixel aspect, filtering,
boundaries, data precision, color conversion and alpha.

**Temporal route:** explicit history edge, initialization, reset/hold semantics,
source seek/replacement, resize, dt policy, bounded persistence, no display
transform on state, no read/write aliasing.

**Material route:** geometry selection, valid attributes, native deformation and
projection, object/world/view conventions, transformed normals, antialiasing,
depth and camera position. Render an actual scene, not an isolated MAT preview.
Scene contract: [material integration](../../build/references/material-integration.md).

**Numerics:** ordered smoothing edges, nonzero divisors, finite outputs,
bounded loops, stable degenerate cases, energy/transmission ranges when claimed.
Concrete guards: [GLSL pitfalls](../../build/references/td-glsl-pitfalls.md#guard-degenerate-maths).

**Teaching:** section-local code/experiment, meaningful diagrams, honest
predictions/observations, matching presets and captures, reproducible reset,
explicit limitations and decisions, separate article acceptance.

**Portability:** source helpers work after moving the directory; exported
component reopens in another parent without source-folder access; dependencies
are documented. Inspect external file paths and unintended references.

**Performance:** identified hardware/build, resolution/format, fixed scenario,
warm-up and sampling method. A few sample renders are not a performance study.

**Evidence:** method and date on every result; see
[checks without TouchDesigner](host-free-checks.md) and
[tests that can fail](test-quality.md).

Prioritize reproducible defects. Correctness fixes should not silently change
accepted artistic choices. When one is necessary, explain the visible change.
