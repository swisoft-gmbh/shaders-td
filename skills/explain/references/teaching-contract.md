# An explorable native tutorial

Plan before polishing prose. The shader and article have separate success
criteria, but share source and experiment state.

Each substantive section must have a concrete reader question, a named native
experiment, a small excerpt from the delivered code and an explanation of what
to inspect. Use figures where spatial structure or pass order is hard to infer
from code. Reuse an earlier experiment intentionally and say why.

The opening shows the destination through a real native capture once available.
Before capture, a labeled schematic or predicted description is acceptable for
a draft; neither is proof of a rendered result. Later sections should expose
the driving field, transform, comparison, limitations and final composition.
Caption every image with where it came from; one TouchDesigner did not render
says so, for example "WebGL preview, not a TouchDesigner capture".

For each experiment, freeze unrelated conditions and vary one causal control.
Give defaults, reset instructions, expected relationship and actual observation.
Native parameter presets and debug stages make the network explorable. A
browser blog may additionally embed recorded comparisons or small interactive
models; label models as models and connect them to the native implementation.
Say what applying an experiment resets and keeps, and how to return to the final
look ([builders and helpers](../../build/references/builder-and-helpers.md#make-experiments-reset-the-look-and-keep-the-setup)).

Explain equations by their inputs, units, output range and role in the visible
image. Place the source excerpt beside the relevant derivation. Use original
prose about the new work. Cite the exact Heckel article and preserve applicable
code notices when adapting code.

Do not fill an article with one giant code listing or several copies of the
final render. Each figure/control should answer a different question. An
annotated network must name actual nodes and distinguish texture data from
display imagery and previous-frame references. Refer to other sections by their
heading in quotes, never "the last section"; a unit test can check those
pointers (`TutorialPointers` in the core liquid-glass study's
[test_study.py](../../../examples/liquid-glass/checks/test_study.py)).

The provided renderer expands `{{code:file:region}}` markers and records hashes
and line ranges. The checker requires excerpts and experiment links in their
planned sections; global occurrence elsewhere does not satisfy that section.
These checks establish source alignment, not readability, visibility, native
correctness or user acceptance. Review those separately.

## Readers new to GLSL

For a tutorial aimed at TouchDesigner users who have not written shaders, add
these to the contract above:

- Open with the destination image.
- Before any code, define a shader in plain words. For an image effect on a
  GLSL TOP: the pixel shader runs once for every pixel of the output and
  decides that pixel's colour. For a material on a GLSL MAT: the vertex shader
  runs once per corner (vertex) of the mesh, and the pixel shader once per
  pixel the object covers.
- Say in the introduction that previews show what the code does, not how
  TouchDesigner renders it.
- Add one Teaching stage menu that shows one ingredient of the material at a
  time, so most experiments can isolate a stage.
- Where a review found that the obvious approach fails, explain why. For
  example, speed x time jumps whenever the speed changes.
- End with a Limits section that gives measured numbers.
- Put the build snippet in an "Open the study" section, and keep the result in
  a variable named `component`, so every later experiment command can use it.

Evidence: the pattern of the core liquid-glass tutorial,
[article.md](../../../examples/liquid-glass/article.md) ("Open the study",
"Make it liquid", "Limits"). Preview-only, no `.tox`: its images are WebGL
previews. Whether it teaches well has not been tested with readers.
Read it before the members'
articles, which follow the same pattern. To reuse it, see
[start from the liquid-glass examples](../../build/references/glass-refraction.md#start-from-the-liquid-glass-examples).
