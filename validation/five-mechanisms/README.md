# Five studies, four workflows each

The five [sample tutorials](../../examples/FIVE-MECHANISMS.md) exercise research,
build, explain and review using the actual plugin skill instructions and helpers.
Their `workflow.json` records link each phase to concrete outputs. This is not a
fresh-host skill activation/dispatch test or an independent reviewer report.

## Evidence

- `archive-recheck.json`: catalog reconciliation, original/bundled hashes and
  the fresh repository source scan. [Readable findings](../../maintainer/coverage-recheck.md).
- `fresh-build.json`: all five current source recipes compile and produce finite,
  nonblank native outputs on TouchDesigner 2025.33230, macOS.
- `mechanism-tests.json`: 24 checks across the four stateless studies, including
  one independent CPU check of the normal equation. The remaining 23 exercise
  native behavior or diagnostics.
- `tidal-tests.json`: 11 native state/lifecycle checks over 407 controlled frames.
- `export-reopen.json`: all five genuine `.tox` saves reopened under a different
  parent. Embedded source/tutorial/experiment DATs match, native parameter
  references resolve, and matched-condition output differences are zero.
  The temporal comparison resets both components to the same seed.
- `workflow-validation.json`: research mapping, static recipes, five-section
  tutorial contracts, 25 presets/captures and phase completion.
- `user-feedback.json`: the user saw all five animated viewers and reported no
  obvious problems. This is scoped visual evidence, not article acceptance.
- `reproduction.json`: the bundled portable launcher built five additional
  native components and successfully repeated the mechanism checks.

The 35 mechanism checks include **34 native checks and one CPU equation check**.
They are not 35 independent shaders or a universal compatibility certification.

## Reproduce the mechanism checks

Run inside TouchDesigner's Python Textport, with a new report destination:

```python
import runpy
result = runpy.run_path('/path/to/plugin/validation/five-mechanisms/reproduce_native.py')['run'](
    parent_path='/project1', report_dir='/new/report/directory')
print(result)
```

The launcher creates its own uniquely named group, builds fresh copies of the
five studies, runs the static-control checks, then runs an Execute DAT for 407
frames. It does not overwrite existing reports or the user's components. The
returned temporal report appears when the driver finishes and disables itself.
Read both report files. These tests force native cooks and occasionally read
pixels; they are validation work, not a performance benchmark. Export/reopen
and tutorial inspection are separately recorded and are not rerun by this helper.

## Findings and limits

Native inspection corrected landscape layer order and material framing.
Zero-displacement and zero-velocity tests led to exact identity paths rather
than repeated normalization/interpolation. The initial reference checker also
used the wrong path base; it was corrected to the host's `Par.evalOPs()` contract.
The native components themselves already rendered correctly. Development
failures remain in the preparation folder; the package contains final evidence.

The tutorials contain source-extracted code, native captures and diagrams labeled
as schematics. Shader output was inspected by the agent and user. Article source,
section-local code and preset/figure references were checked; user acceptance of
tutorial depth remains open. The tutorials are native Markdown workflows, not
browser recreations of the shaders.

No steady-state GPU benchmark, other OS/build, live camera/audio, POPs/compute,
pressure solve or universal mathematical/physical accuracy claim is made. These
five cover different mechanisms; they do not exhaust the archive's 17 core
shader topics. Existing refraction, caustics, anisotropy, atmosphere, dithering,
particle and other references remain available for further projects and tests.
