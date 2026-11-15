# Checks without TouchDesigner

Read when: no TouchDesigner host is connected but a shader needs evidence, or
when you label evidence.

Evidence: methods proven in the preview-only liquid-glass examples (2026-11-02
results; [status](#status-of-the-liquid-glass-evidence)). To reuse an example,
see [start from the liquid-glass examples](../../build/references/glass-refraction.md#start-from-the-liquid-glass-examples).

## Contents

- [What each check proves](#what-each-check-proves)
- [Status of the liquid-glass evidence](#status-of-the-liquid-glass-evidence)
- [Compile every define combination against stand-ins](#compile-every-define-combination-against-stand-ins)
- [Preview the delivered files in WebGL2](#preview-the-delivered-files-in-webgl2)
- [Test time at long uptime](#test-time-at-long-uptime)
- [Step a feedback loop in a script](#step-a-feedback-loop-in-a-script)
- [Prerequisites and fallbacks](#prerequisites-and-fallbacks)
- [Run the harness safely](#run-the-harness-safely)

## What each check proves

Each check below proves less than a TouchDesigner run. Pick the label from the
table and use it word for word.

| Label | Check | A pass proves | A pass does not prove |
| --- | --- | --- | --- |
| Compile | `glslangValidator` (the Khronos reference GLSL compiler) on the delivered files against stand-ins (hand-written declarations of TouchDesigner's built-ins) | The shader agrees with the stand-ins. | That the stand-ins match TouchDesigner. A wrong stand-in signature passes too. |
| Preview | A WebGL2 render of the same files in Chromium's software GPU (SwiftShader) | Image behaviour on a browser GPU. | TouchDesigner rendering, draw order or drivers. |
| Unit test | Python tests on a fake `td` module | Helper logic and recipe consistency. | That real TouchDesigner objects behave like the fake. |
| Source | Reading the delivered files line by line | That the text says what you quote, at the file and line you give. | That it compiles or renders. |
| Arithmetic | Working a formula through by hand or in a few lines of script, with the inputs stated. A picture rendered by a Python port of the shader's maths counts here too. | The number, or the picture, those formulas give for those inputs. | That the GLSL computes it the same way on a GPU. Caption such a picture as a port, not a render. |
| No label: name the script | `scripts/check_study.py`, or a text check you wrote over the source | For `check_study.py`, recipe structure only: manifest, files, uniforms, graph references; it applies to dossier-format studies and exits with code 2 on any other project. For your own script, exactly what it tests, so say what that is. | Any compile or render. |
| Docs | A statement on an official Derivative page, with its URL and the date checked | What the page says for the build it documents. | That TouchDesigner behaves that way on this build or machine. |
| Native | A run in TouchDesigner, with Info DAT text and captures | What that build did on that machine. | Other builds, operating systems or GPUs. |

In this plugin, only the eight native examples carry the Native label
(TouchDesigner 2025.33230, macOS 15.8.1): see
[fresh-build.json](../../../validation/fresh-build.json),
[validation/five-mechanisms/](../../../validation/five-mechanisms/README.md) and
each example's `validation.json`. The liquid-glass examples have none.

Label every result with its method and its date. Until a native run exists, end
the claim with "TouchDesigner run pending (status YYYY-MM-DD)". Write a date,
not a relative time word, because relative words go stale. Never call a
Source, Arithmetic, Compile, Preview, Unit test or Docs result native. A
review without TouchDesigner is mostly Source and Arithmetic; that is real
evidence for what the code says, and worth labelling as such.

## Status of the liquid-glass evidence

The five liquid-glass examples are preview-only. Their results are Compile
(against hand-written stand-ins), Preview (WebGL2 in a browser) and Unit test
(on a fake `td` module). Nothing in them ran in TouchDesigner, and they have no
`.tox`. TouchDesigner run pending (status 2026-11-03).

The references that cite them say "preview-only" and link here instead of
repeating this. `Docs` beside a rule names a Derivative page as the source; it
is not a check. Example paths point into the plugin's `examples/` folder; when
that folder is missing, keep the rule and skip the pointer.

To close the gap, connect TouchDesigner (its MCP server, TDMCP, or a person
running `build.py`) and work through the pending checks each example lists in
its `validation.json`.

Reusable template (preview-only): the core's
[checks folder](../../../examples/liquid-glass/checks/) with `compile_glsl.py`,
`preview/`, `preview_tests.cjs`, `test_study.py` and `run_all.sh`. When you copy
`run_all.sh`, change each `>` redirect to write a temporary file and move it
into place only on success; see [Run the harness safely](#run-the-harness-safely).

## Compile every define combination against stand-ins

For any GLSL TOP or GLSL MAT, compile the delivered shader files, not copies.

- **Two modes.** Run `glslangValidator` once with GLSL 4.60 rules and once as
  Vulkan SPIR-V with relaxed rules (`-V -R`), as the examples'
  `compile_glsl.py` does.
- **Stand-in header.** Prepend a header that declares the TouchDesigner
  built-ins the shader uses, with their documented signatures: `uTDMats`,
  `uTDGeneral`, `TDDeform()`, `TDWorldToProj()`, `TDLightingPBR()` and so on.
  Record the Derivative page behind each stand-in, for example
  [Write a GLSL MAT](https://docs.derivative.ca/Write_a_GLSL_MAT) (Docs,
  checked 3 November 2026).
- **Every define combination.** TouchDesigner compiles a material again for
  each setup it is drawn with, so compile each combination it can use:

  | Define | Values to compile | Set by |
  | --- | --- | --- |
  | `TD_NUM_LIGHTS` | 0, 1, 3 | the Light COMPs the render uses |
  | `TD_NUM_ENV_LIGHTS` | 0, 1 | the Environment Light COMPs |
  | `TD_PICKING_ACTIVE` | defined (vertex stage) | a Render Pick DAT or CHOP |
  | `TD_NUM_COLOR_BUFFERS` | undefined, 1, 3, 8 | the Render TOP's colour buffer count; undefined tests the shader's own fallback |

- **Negative tests.** A compile check that cannot fail proves nothing. Add
  broken copies that must fail and name the line or symbol: a removed uniform
  (Flow), a misspelt built-in on a known line (Blobs), the picking variant
  without its `TDWritePickingValues()` stand-in (core, Flow, Prism and Lit), an
  unguarded environment-light call with 0 environment lights, and the docs'
  mixed `TDEnvLightingPBR` form (both Lit).
- **What a pick render runs.** `glslangValidator -E` prints the preprocessed
  source. Use it to list exactly which statements of `main()` a pick render
  runs, and compare them with the documented form (`main_statements()` in Lit's
  `compile_glsl.py`).

Caveats. The examples' stand-ins follow Derivative's page and a TouchDesigner
pixel-shader preamble kept in glslang's own test suite
([Test/vk.relaxed.stagelink.0.1.frag](https://github.com/KhronosGroup/glslang/blob/main/Test/vk.relaxed.stagelink.0.1.frag)),
which comes from an older, undated TouchDesigner build. So signatures can
differ in 2025.x. A stand-in can also break a correct shader: a
`TDInstanceID()` stand-in that used the Vulkan-only `gl_InstanceIndex` failed
Flow's first GLSL 4.60 compile (Flow `review.md`, row "Compile check").

Example: [liquid-glass-lit/checks/compile_glsl.py](../../../examples/liquid-glass-lit/checks/compile_glsl.py)
(Compile).

## Preview the delivered files in WebGL2

A WebGL2 preview shows what the shader maths and the recipe's bindings do, on a
browser GPU. Build it so it cannot drift from the delivered material:

- **Delivered files.** Load the real `.vert` and `.frag` files and prepend a
  shim (a short header) that stands in for TouchDesigner's preamble. Do not
  keep copies.
- **Uniforms from the recipe.** Build every uniform by evaluating the
  expressions in `study.json`. Make `evaluate()` throw on any form it does not
  know, so a recipe change cannot pass unnoticed.
- **Samplers and helpers.** Apply each sampler's filter and extend from
  `study.json`. Mirror Python helpers the uniforms call, such as `advance()`.
- **Scene variations,** added as reviews need them: orthographic projection; a
  uniform world scale with an inverse-transpose normal matrix; geometry without
  normals; a flipped raster; a 4x MSAA (multisampled) canvas; an occluder drawn
  in front, as a Render Pass TOP would keep it; consecutive frames for drift;
  `--reference`, which runs the previous commit's material; instrumented copies
  that output one internal value.

Tests that caught real defects:

- invariants: IOR 1 makes the glass invisible, Opacity 0 makes it invisible,
  the sample count does not matter without dispersion, and the Morph endpoints
  equal their presets (`ior1_is_invisible`, `opacity0_is_invisible`,
  `samples_invariant_without_dispersion`, `morph0_is_neutral`,
  `morph1_equals_target` in the core's `preview_tests.cjs`);
- float64 references computed outside the GPU;
- a backdrop that encodes its own UV, so a test reads where each pixel looked
  (Prism's `refraction_lookup_follows_snell`);
- [red runs and mutation runs](test-quality.md).

WebGL2 pitfalls:

- WebGL2 rejects dynamic indexing of fragment output arrays, so write extra
  colour buffers with constant indices.
- Transform-feedback readback returns zeros unless the framebuffer is unbound
  and GL errors are checked after each stage (Flow `preview.js`).
- Render tests at 480 x 270. At 960 x 540, 48 renders did not finish in 15
  minutes in SwiftShader.
- RGBA32F textures are not filterable in WebGL2 without an extension, so
  sample them with NEAREST.
- The stand-in light functions differ from TouchDesigner's, so absolute light
  brightness is unknown.

The preview cannot show draw order (it always draws the glass last),
TouchDesigner's own preamble functions, cube-map environments or Metal's
fast-math compiler mode on macOS. Never cite it for those.

Example: [liquid-glass/checks/preview/preview.js](../../../examples/liquid-glass/checks/preview/preview.js)
(Preview).

## Test time at long uptime

Long-run precision bugs show only at a large `absTime` (TouchDesigner's
seconds since it started). Test any animated shader at hours, days and a week of uptime against a float64 reference
(Flow's [flow_reference.cjs](../../../examples/liquid-glass-flow/checks/flow_reference.cjs)).

- Flow's rebuilt normals were off by 0.007 degrees at 2 s, 0.62 at 1 hour and
  10.1 at 24 hours. After the fix they stay within 0.10 degrees at 24 hours and
  0.08 after a week (Preview, `normals_match_finite_differences`).
- Test Morph and speed changes at large uptime too. Before the fix, one Morph
  frame at 1 hour changed the core's image by up to 226/255 (Preview,
  `morph_frame_is_smooth_after_an_hour`).
- Add a recipe test that bans `absTime` in node expressions
  (`test_no_expression_multiplies_absolute_time`) and a unit test that runs the
  clock at a month of uptime
  (`test_phase_is_wrapped_double_precision_and_holds_when_speed_is_zero` in the
  core's `test_study.py`).

The fix: [integrate animation time on the CPU](../../build/references/td-glsl-pitfalls.md#integrate-animation-time-on-the-cpu).

## Step a feedback loop in a script

What a feedback study does over frames can be checked without a GPU. Port the
state update to a few lines of Python and step it: start from the zero seed,
run a few hundred frames, and assert what the tutorial promises.

- The first frame after a reset shows no flash.
- The trail's half-life is the stated number of seconds, at two different
  frame rates.
- The decay reaches zero in the format the state is stored in. Round each
  frame to 8 bits and a multiplicative decay stalls above zero.
- An unchanged input adds no new motion.

Label the result Arithmetic: it shows what the formulas do, not what the GLSL
does. The same checks, run natively on the Tidal Ink study, are in
[temporal_checks.py](../../../validation/five-mechanisms/temporal_checks.py),
which needs TouchDesigner.

## Prerequisites and fallbacks

Every tool here is optional. Each one adds one kind of evidence.

- Python 3.10 or later, the plugin's requirement for shell helpers.
- `glslangValidator` (Ubuntu package `glslang-tools`).
- Node 22 with Playwright and Chromium. Launch Chromium with
  `--use-angle=swiftshader --enable-unsafe-swiftshader`, and set
  `NODE_PATH=$(npm root -g)` for a global install.

Commands, run from the study folder:

| Command | Expect |
| --- | --- |
| `python3 checks/compile_glsl.py` | JSON with `"ok": true` |
| `python3 checks/test_study.py` | unittest's `OK` |
| `python3 -m http.server PORT --bind 127.0.0.1`, then `node checks/preview_tests.cjs PORT` | JSON with `"ok": true` |
| `bash checks/run_all.sh` | all of the above, saved in `checks/results/` |

If a tool is missing, the check did not run: say so, with the reason, and mark
it pending. Do not drop it silently. A compile check is worth the effort to
get: any build of the Khronos glslang compiler will do, the system
`glslangValidator` or a package the host lets you install in the project
folder. Ask before installing anything, and pin an exact version in any install
command you give.

In this plugin's own evaluation runs, agents used the npm package
`@webgpu/glslang`. What they reported, not otherwise tested here: it has no
relaxed mode, so uniforms without a binding and outputs without a location
must be rewritten by the harness before compiling; and its factory returns an
object that is itself thenable, so `await` on it never finishes and a `.then()`
callback is needed. In a chat host that cannot
run code, deliver the harness and mark every check pending. None of these
results is TouchDesigner evidence.

## Run the harness safely

- **Write results atomically.** `cmd > results/x.json` empties the file before
  the command runs, so a failed run leaves an empty file. One study's
  `compile.json` reached a commit empty this way. Write to a temporary file and
  move it into place only on success. The examples' `run_all.sh` uses the
  plain redirect (status 2026-11-03).
- **One agent per study folder.** Give each agent its own free PORT and its own
  scratch copy for experiments.
- **No stray bytecode.** Set `PYTHONDONTWRITEBYTECODE=1` for agents that must
  not write into the study.
- **Check before a commit.** Every results file parses, is not empty, and is
  newer than the last edit to the shaders, the recipe and the preview code.
