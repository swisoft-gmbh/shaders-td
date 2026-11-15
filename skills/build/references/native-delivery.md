# A native study you can inspect and move

Each bundled example contains source GLSL, `study.json`, `build.py`,
`native.py`, experiments and an implementation-linked tutorial. The Python
files run inside TouchDesigner; ordinary Python only performs static checks
and packaging.

In TouchDesigner's Python Textport:

```python
import runpy
study = runpy.run_path('/absolute/path/to/study/build.py')
component = study['build']()
```

`build()` defaults to the current `/project1` when it exists, otherwise root,
and creates a new component. It returns the actual component. Repeated calls
produce separate components. Never silently replace an existing component.

The builder embeds source and experiment definitions in DATs. The helper module
is embedded too, so saved components do not require the original source folder.
Controls appear on the component's Study page. `Pause` freezes shader time by
using `Time`; for a feedback study, `Pause` also holds state. To clear history,
use the component's `Reset` toggle for one frame and release it, or pulse the
Feedback TOP's Reset parameter. Source/resolution changes require reset.

Native helpers are available through `component.op('study_tools').module`:

```python
helpers = component.op('study_tools').module
helpers.apply(component, 'field')
helpers.inspect(component)
helpers.capture(component, '/new/output/capture.png')
helpers.export(component, '/new/output/study.tox')
```

`apply` uses actual experiment IDs from the embedded JSON. Capturing/saving
refuses an existing destination. Native compilation and controls must still be
checked. An exported component contains a self-contained tutorial source and
metadata, but external article figures remain in the source package.

Read [builders and helpers](builder-and-helpers.md) before writing a builder,
helper module or experiment presets.

For source-only delivery without a native connection, provide the complete source ZIP, tutorial
and these user-run steps. Mark native compilation, rendering and export/reopen as
pending; do not make a native connection a condition for delivering source.

When a native host is available, before delivering a new native export:

1. Inspect Info DATs and error strings after the output cooks. Capture the
   selected state and control values with build/OS information.
2. Test meaningful controls and representative edge cases. A nonblack render
   alone says little about causal correctness.
3. Save through TouchDesigner. Load the `.tox` into a different parent, inspect
   shader compilation, vary controls and compare the output.
4. Move the source package and reopen again without access to the original
   folder. Internal relative node references should survive.
5. Provide native file, source, tutorial, captures, credits and scoped evidence.

For users who need a complete `.toe`, use `project.save` only with the intended
project and a new requested filename. Saving the whole project may include
unrelated user work; component export is the normal isolated-example delivery.

For temporal playback, open the output TOP viewer (right-click `out` → View) or connect a consuming output. TouchDesigner cooks on demand; a hidden, unused branch does not advance history merely because time advances. The validation driver deliberately cooks once per frame and is not embedded in exported components.
