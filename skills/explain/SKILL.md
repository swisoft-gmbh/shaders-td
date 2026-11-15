---
name: explain
description: "Writes the tutorial for a TouchDesigner shader (blog post, annotated network walkthrough, teaching experiments) from the real source, presets and captures, also for readers new to GLSL. Use when the user wants a TD shader explained or taught, not only built. To check an existing tutorial, use the review skill."
license: "CC-BY-NC-4.0 (toolkit material; see the plugin's NOTICE.md)"
---

# Write the shader tutorial

Works in chat hosts and coding agents. [Hosts](../research/references/chat-web.md)
says what to deliver with the tools you have, and what outranks this skill: the
user's instructions, then the host's or organisation's standing rules. One rule
never yields: do not claim a check that did not run.

## Common mistakes

- Unlabelled images. Caption every image that TouchDesigner did not render, for example 'WebGL preview, not a TouchDesigner capture' ([teaching contract](references/teaching-contract.md)). In `experiments.json`, mark such a picture `"evidence": "preview"` and `article.py` writes the caption.
- Pointers like 'the last section'. Name other sections by their heading in quotes, because pointers drift when sections move ([teaching contract](references/teaching-contract.md)).
- Experiments that silently change the shared material. Say what applying one resets and keeps, and how to return to the final look ([builders and helpers](../build/references/builder-and-helpers.md#make-experiments-reset-the-look-and-keep-the-setup)).

## Teaching steps

Read [teaching evidence](../research/references/teaching-evidence.md) and
[the native teaching contract](references/teaching-contract.md).
Treat the explanation as a designed deliverable with its own acceptance.
An approved shader stays intact during an article-only revision.

1. Inspect the actual GLSL, native node graph, controls, experiment records and
   captures. Recover missing facts before writing. Do not narrate experiments
   that were never performed or impersonate Heckel's personal experiences.
2. Storyboard each major concept:
   **reader question → smallest model → actual source → experiment → observation**.
   Open with the destination; then isolate the signal, transformation,
   composition, limitation and tradeoff.
3. Deliver detailed Markdown/MDX, annotated network diagram, actual source
   excerpts, reproducible native presets, and real captures where available.
   The tutorial has no house style: use the look the user asks for, never the
   plugin's or Maxime Heckel's ([colours](../research/references/branding.md)).
   If a browser article is requested, follow the host's site workflow and embed
   experiments/captures in reading order. Do not claim that a browser port
   verifies the native project. Do not silently substitute a prose summary for
   an explorable article.
4. Use `scripts/article.py render STUDY` to expand source markers in
   `article.source.md` into code from the delivered files. Keep markers bounded:
   `{{code:shader.frag:field}}` extracts `// @begin field` through `// @end field`;
   in a Python file the markers are `# @begin field` and `# @end field`.
   An experiment's optional `note` replaces the stock sentence under it, for
   example when time keeps running.
   Never edit generated excerpts independently.
5. Tie each experiment to `experiments.json`: fixed time/input, one varied
   control, named debug stage, expected relationship, actual observation and
   capture path when obtained. Label predictions as predictions. An
   experiment's `evidence` is `native` (TouchDesigner rendered the capture),
   `preview` (the GLSL ran somewhere else, such as a browser), `port` (a
   script re-implemented the maths) or `pending` (nobody ran it); the renderer
   words the heading and caption accordingly.
6. Explain each consequential decision as goal → options → evidence → choice →
   consequence. Define units and spaces before equations, then show the matching
   implementation. Credit the article the technique came from by title and
   URL, and the researchers it credits
   ([suggested wording](../../ATTRIBUTION.md#suggested-credit-in-a-new-tutorial)).
   A tutorial for a study that started from a seed also carries the toolkit's
   credit line and licence ([build, at delivery](../build/SKILL.md#licence-and-credit-at-delivery)).
7. Run `scripts/article.py check STUDY`. It checks source integrity and section
   placement, not whether the tutorial renders beautifully or teaches well.
   Inspect the final presentation and native experiments.

The examples in `../../examples/` show the format. The
[five mechanism studies](../../examples/FIVE-MECHANISMS.md) each contain a
five-section tutorial, five native presets and a four-mode workflow record.
They are new toolkit
studies, not recovered Heckel TouchDesigner projects. Separate recipe source,
captured native output and schematic figures explicitly. In an untested recipe,
use “should” for predictions and keep the destination capture pending.

For TouchDesigner users new to GLSL, follow
[Readers new to GLSL](references/teaching-contract.md#readers-new-to-glsl). The
model tutorial is [Liquid Glass's article](../../examples/liquid-glass/article.md)
(preview-only, no `.tox`). Its images are WebGL previews, not TouchDesigner
captures. The members' articles follow the same pattern
([family overview](../../examples/LIQUID-GLASS.md)); read the core's first, and
a member's only for what it adds. To reuse a study, see the
[examples map](../build/references/glass-refraction.md#start-from-the-liquid-glass-examples).
