# What changed for 1.0.0, and what tested it

Dates: 14 and 15 November 2026. Machine: Linux, Python 3.13.5, no TouchDesigner,
no GLSL compiler. Nothing below is a TouchDesigner result. The native evidence
in this folder dates from the earlier builder and helper scripts and is
unchanged.

## Scripts

| Script | Change | Evidence |
| --- | --- | --- |
| `skills/review/scripts/check_study.py` | A study without `references` no longer crashes. Uniform declarations are parsed properly (several names in one declaration, arrays, qualifiers, initialisers, comments). Samplers and Colors-page uniforms are matched by `kind`. A swizzle that appears only in a comment no longer passes. A folder without `study.json` exits with code 2 and says the checker does not apply. | Unit test: 19 tests in `tests/test_check_study.py`; the first 9 written failed on the previous script. All 13 examples still pass. A Python DAT source that does not parse is reported too. |
| `skills/build/scripts/native_builder.py` | Lenient nodes, `sequences`, uniforms of kind `color` and `sampler`, Info DATs for `glslmultiTOP`, stored build warnings, and the control types the liquid-glass studies use (`rgb`, `xyz`, `int`, `string`, `pulse`, `top`, `comp`, `object`, custom pages). | Unit test on the fake `td` module in `tests/fake_td.py` (11 tests). Not run in TouchDesigner: the Colors and Samplers parameter names follow Derivative's `td-glsl-shaders` skill. |
| `skills/build/scripts/native_tools.py` | `apply()` resets look controls and keeps setup controls; controls in expression mode are left alone and reported. `inspect()` survives deleted nodes and reports Python errors. `capture()` and `export()` refuse on either. | Unit test on the fake `td` module (7 tests). Not run in TouchDesigner. |
| `skills/build/scripts/scaffold.py` | Leaves the example's `.tox`, captures and results behind, resets the records, installs the current builder and helpers, adds the licence notice, renders the tutorial again. Says what to do when `examples/` is missing. | Unit test: 10 tests over all eight seeds; each new study passes `check_study.py` and `article.py check`. |
| `skills/explain/scripts/article.py` | A picture is captioned as native only when the experiment's evidence is native. | Unit test: 7 tests. The eight native tutorials render byte-identically. Python regions (`# @begin`) and an experiment's own `note` are supported. |
| `examples/liquid-glass*/native.py` | `capture()` checked for errors after creating the target folder; the order is now the other way round. | The examples' own suites: 427 tests pass, 1 skipped (needs numpy). |

Run the script tests with `python3 -m unittest discover -s tests` and, per
liquid-glass study, `python3 checks/test_study.py`.

## After the evaluation runs

Before release, an agent was given the plugin and a user's request, could not
ask questions, and wrote down every instruction it could not follow and
everything it found unclear. These changes close what those runs found.

| Change | Evidence |
| --- | --- |
| `explain/scripts/article.py` exits with code 2 and a plain message on a folder without `article.source.md`, for both `render` and `check`, and writes nothing. Before, it stopped with a raw file-not-found error. | Unit test (failed first). |
| An experiment's `evidence` may be `port`: a picture computed by a script that re-implements the shader's maths. It gets its own caption instead of "Preview image". | Unit test (failed first). The native tutorials still render byte-identically. |
| The GLSL contract says that 8-bit state stalls a multiplicative decay above zero, and when to use a fixed step and when the measured one in a feedback loop. | Source: the two references that disagreed were read side by side. |
| `host-free-checks.md` has a recipe for stepping a feedback loop in a script, and passes on two things agents reported about the npm glslang build. | The recipe is what two evaluation runs did unprompted. The two reports were not tested here. |
| `source-formats.md` lists four differences in the caustics source. | Source: each line checked against the bundled article and widget. |
| The build skill asks for a cost estimate before anything runs; the review skill says every fix is a finding; co-design says what to do when the user cannot be reached; the builder reference names the commercial exception; the dossier table lists the three script names the checker expects; the run snippet has a Windows path note. | Wording only. |

## Library and package

- Script tests: 56 pass.
- `corpus.py verify`: 381 files checked, 14 not distributed, no errors.
- Relative links and anchors across the plugin: 1,828 checked, none broken.
- `claude plugin validate`: passed. It does not include the directory's safety
  scan or policy review.
- The three diagrams from his CDN were removed, and the study ZIPs moved from
  the repository to the release (`.github/package.sh`).

## Still pending

- Every native check of the five liquid-glass studies.
- A TouchDesigner run of the new builder and helpers.
- The examples' glslang compile matrix was not re-run here: no compiler was
  available on this machine.
