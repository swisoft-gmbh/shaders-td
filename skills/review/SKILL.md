---
name: review
description: "Checks a TouchDesigner shader, network or .tox and its tutorial: native correctness, visual intent, feedback lifecycle, source accuracy, portability and honest test evidence, with or without TouchDesigner running. Use when the user asks to check, audit, debug or verify TD shader work or claims about it."
license: "CC-BY-NC-4.0 (toolkit material; see the plugin's NOTICE.md)"
---

# Review the shader and its tutorial

Works in chat hosts and coding agents. [Hosts](../research/references/chat-web.md)
says what to deliver with the tools you have, and what outranks this skill: the
user's instructions, then the host's or organisation's standing rules. One rule
never yields: do not claim a check that did not run.

## Common mistakes

- Calling a stand-in compile or a WebGL2 preview a TouchDesigner result. A glslang pass proves the shader agrees with your stand-ins, and a preview shows browser behaviour; label both ([checks without TouchDesigner](references/host-free-checks.md#what-each-check-proves)).
- Reading only the MAT's Info DAT. Each render that draws a GLSL MAT compiles its own version, cached per light and camera setup ([native API notes](../research/references/native-api.md#more-glsl-mat-and-python-facts)).
- Counting a new test that never failed. It counts only if it fails on the old code for the right reason ([red runs](references/test-quality.md#red-runs)).
- Loose pass bounds. Set them from measurements and prove each with a deliberate slip ([bounds](references/test-quality.md#bounds-from-measurements-proven-by-mutants)).
- Docs that claim more than the tests check. Match every behaviour sentence and every stated test count to the suite ([claims](references/test-quality.md#claims-that-match-their-tests)).

## Review steps

Read [review criteria](references/review.md). Establish the requested scope and
inspect the actual project first. Preserve accepted artistic choices during
technical fixes.

The [five mechanism test report](../../validation/five-mechanisms/README.md)
shows property checks beyond compilation: analytic ray intersections,
homogeneous-volume transmission, image-filter invariants, normal transforms,
and state transport/lifecycle. Reuse relevant tests, not their prior pass status;
changes to code, build, inputs or parameters need their own evidence.

The [liquid-glass examples](../../examples/LIQUID-GLASS.md) (preview-only, no
`.tox`) show a harness that runs without TouchDesigner: compile matrix, WebGL2
preview, unit tests, red runs and mutation runs. To reuse it, start from the
core ([examples map](../build/references/glass-refraction.md#start-from-the-liquid-glass-examples)).
Without TouchDesigner, read
[checks without TouchDesigner](references/host-free-checks.md) before running or
citing any check. Read [tests that can fail](references/test-quality.md) before
adding tests or judging claims about them. [Review rounds](references/review-rounds.md)
describes reviews split across several agents; use it only when the user asks
for one.

Steps 2 and 6 run scripts that read the plugin's own study format (a folder
with `study.json`, `experiments.json` and `article.source.md`). On any other
project `check_study.py` and `article.py` exit with code 2 and say so. That is not a defect:
review a plain project by reading its shaders, builder and tutorial against
[the GLSL contract](../build/references/td-glsl-pitfalls.md#the-basic-contract),
and label what you found `Source` or `Arithmetic`.

1. **Source truth:** verify `../research/scripts/corpus.py verify`.
   Read relevant article/code sections. Distinguish archived web methods,
   official native API facts, toolkit synthesis and new experiments.
2. **Static project contract:** run `scripts/check_study.py STUDY`.
   Check manifest, files, uniform declarations, graph references, feedback
   targets, diagnostics and experiment references. A pass is not native compile.
3. **Native execution:** with TouchDesigner connected (its MCP server, TDMCP),
   inspect build/OS/GPU, Info DAT compile reports, errors and output. Check controls, input loss, aspect ratio, precision, color/alpha,
   time, pause/reset and resource lifecycle. Use the study's in-host helper to
   save evidence; read both errors and captures.
4. **Temporal behavior:** prove current/previous separation, initialized first
   frame, reset, source/size changes, matched sampling and no unbounded gain.
   Compare decay at two fixed steps. Motion confidence and direction estimates
   require their own tests; a clean trail does not prove optical flow.
5. **Geometry:** inspect SOP → geometry → MAT → camera → Render TOP, attribute
   conventions, normal transforms and displaced normals. Verify orientation
   under rotation and nonuniform scaling.
6. **Teaching:** run `../explain/scripts/article.py check STUDY`; inspect
   the article visually and exercise each native preset. Code excerpts must
   match source and belong to the section that teaches them. A figure must
   explain its mechanism, not merely decorate a page.
7. **Delivery:** save actual native exports, reopen a separate copy and check
   relative/internal references. Verify the installed plugin can locate its own
   library after relocation. Review attribution and external dependencies.
8. Report defects by impact: first anything that destroys or overwrites the
   user's work, then what does not compile or render, then wrong results, then
   claims the evidence does not support, then polish. Fix authorized issues
   and rerun affected checks. Every change you make is a finding, even a
   one-line one: a fix that is not listed leaves the user unaware that the
   original was wrong.
   Give specific evidence and remaining limitations; do not inflate test counts
   into claims of visual quality, performance, universal compatibility or user
   acceptance. Do not claim independent review unless another reviewer did it.
