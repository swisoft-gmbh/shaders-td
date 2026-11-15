# Builders and in-host helpers

Read when: writing `build.py`, `builder.py`, `native.py` or experiment
presets.

Evidence: unit tests on a fake `td` module (the plugin's `tests/` folder and
the preview-only liquid-glass examples,
[status](../../review/references/host-free-checks.md#status-of-the-liquid-glass-evidence))
plus one Native fact.

## Contents

- [What the bundled scripts already do](#what-the-bundled-scripts-already-do)
- [Build strict where it matters, lenient elsewhere](#build-strict-where-it-matters-lenient-elsewhere)
- [Make experiments reset the look and keep the setup](#make-experiments-reset-the-look-and-keep-the-setup)
- [Make inspection survive the user's edits](#make-inspection-survive-the-users-edits)
- [Test helpers against a fake td module](#test-helpers-against-a-fake-td-module)

## What the bundled scripts already do

`scripts/native_builder.py` and `scripts/native_tools.py` follow the rules in
this file, and `scaffold.py` installs them in a new study as `builder.py` and
`native.py`. Start from them instead of writing a builder from nothing,
unless the brief is commercial: then nothing of the toolkit's is copied
([licence and credit](../SKILL.md#licence-and-credit-at-delivery)), and this
file is the description of what your own builder must do.

Operator types are written as strings such as `"glslTOP"`; `create()` accepts
them (Native: the eight examples were built this way).

In `study.json`, a node may carry:

| Key | Effect |
| --- | --- |
| `parameters`, `expressions` | Constant values and expressions on the operator. |
| `sequences` | Block counts for parameter sequences, set before the parameters, for example `{"const": 3}` on a Constant CHOP. |
| `uniforms` | A list of `{name, values, kind}`. `kind` is `vector` (the default, Vectors page), `color` (Colors page) or `sampler` (Samplers page; `values[0]` is an expression that evaluates to the TOP). |
| `lenient` | `true` turns a parameter or sequence this build does not have into a stored warning instead of a failed build. |

Controls are `float`, `int`, `toggle`, `menu`, `string` or `pulse`; `rgb` and
`xyz`, written as one entry per channel (`Inkr`, `Inkg`, `Inkb`) that share a
`group` (`Ink`); and `top`, `comp` or `object` for a field that points at
another operator. `page` puts a control on its own custom page.

Any DAT node with a `source` gets that file's text, so per-frame Python is an
ordinary node: an `executeDAT` whose `source` is a `.py` file. Use one to
integrate animation time
([pitfalls](td-glsl-pitfalls.md#integrate-animation-time-on-the-cpu)).

A control with `"setup": true` describes the user's scene, not the look, and
`apply()` never resets it. `inspect()` reports `errors`, `script_errors`,
`warnings`, `build_warnings`, `missing` nodes and the compile reports.
`review/scripts/check_study.py` understands the same keys.

The Colors and Samplers bindings and `glslmultiTOP` support follow Derivative's
parameter names and are unit-tested on the fake `td` module only; run the build
once in TouchDesigner before relying on them. The eight native examples keep
the older builder and helpers their `.tox` files were built with.

## Build strict where it matters, lenient elsewhere

Build core nodes strictly, so a broken material stops the build and names the
parameter. Build demo nodes, and parameters whose names you know only from
the docs, leniently, so a wrong name becomes a stored warning instead of a
failed build.

- Store warnings by category (material, inputs, optional, setup, demo,
  dither) and print them grouped, each with a note on what it affects.
- Add a Demo render toggle, so the demo stops cooking once the material is
  used elsewhere.
- Keep OP-reference fields (parameters that point at another operator) in
  constant mode, with `relativePath()` values and Reset to Default. Dragging,
  typing and clearing then behave as documented. A field left in expression
  mode cannot simply be cleared; the user must switch its mode first.
- Native: a Geometry COMP's Material set with `node.relativePath()` to a
  sibling MAT applies (TD 2025.33230 macOS, `contour-material` in
  [fresh-build.json](../../../validation/fresh-build.json)).
- The builder embeds the sources in DATs, so existing components keep the old
  code. Say in Troubleshooting that a fix needs a rebuild or a pasted DAT.

Example: `attempt()`, `WARNING_NOTES` and `link_demo_inputs()` in
[builder.py](../../../examples/liquid-glass/builder.py).

## Make experiments reset the look and keep the setup

A tutorial experiment must give the same result in any order, because readers
skip around. Two failures showed why:

- `apply()` leaked Morph, Back-face pass and other non-preset controls between
  experiments, so results depended on what ran before.
- The first fix reset too much, including Reflection map and Demo render,
  which describe the user's scene and cost, not the look.

Pattern:

1. `apply()` resets every look control to its `study.json` default.
2. It keeps every control marked `"setup": true`: scene inputs, Reflection
   map, Faces, Object size, Flip screen V, Colour parameters and Demo render.
3. It then loads the preset and the experiment's overrides.

Tests: `test_order_does_not_matter` (every experiment after every other) and
`test_reset_controls_are_the_documented_ones`. The tutorial lists what is
reset and what is kept, says that experiments change the shared material, and
gives `apply(component, 'final')` as the way back. Each experiment changes
one cause.

A control driven by an expression, export or bind ignores a write to `.val`.
The bundled `apply()` leaves such a control alone and lists it under
`not_reset`; the liquid-glass helpers write `.val` regardless, so there those
controls are silently not reset
([native API notes](../../research/references/native-api.md#more-glsl-mat-and-python-facts);
[known gaps](../../../examples/LIQUID-GLASS.md#known-gaps)).
Example: `apply()` and `look_defaults()` in
[native.py](../../../examples/liquid-glass/native.py); `apply()` in
[presets.py](../../../examples/liquid-glass/presets.py) loads a preset.

## Make inspection survive the user's edits

Users delete demo nodes and repoint inputs, so diagnostics must keep working
after that.

- `inspect()` skips nodes the user deleted instead of crashing.
- It reports `scriptErrors(recurse=True)` (Python errors land there, not in
  `errors()`), blocking errors, the errors of the operators the Inputs fields
  point at, and diagnostics for every render that draws the material, because
  each render compiles its own version of the material (cached per light and
  camera setup)
  ([native API notes](../../research/references/native-api.md#more-glsl-mat-and-python-facts)).
- `capture()` and `export()` refuse only on blocking errors.

Example: `inspect()`, `inputs_report()` and `render_diagnostics()` in
[native.py](../../../examples/liquid-glass/native.py).

## Test helpers against a fake td module

Unit-test in-host Python against a fake `td` module that returns every
documented shape, because each missed shape crashed a helper:

- `Par.eval()` on an OP parameter returns one OP, a list or `None`. Lit's
  `lights()` called `.split()` on it, so `inspect()`, `capture()` and
  `export()` always crashed.
- `evalOPs()` always returns a list; prefer it.
- Missing nodes: the core's `inspect()` crashed once a demo node was deleted.
- `scriptErrors()` exists alongside `errors()` and `warnings()`.

More `Par` facts are in
[native API notes](../../research/references/native-api.md#more-glsl-mat-and-python-facts).
Example: `checks/test_study.py` in
[liquid-glass](../../../examples/liquid-glass/README.md) and `lights()` in
[liquid-glass-lit's native.py](../../../examples/liquid-glass-lit/native.py).
