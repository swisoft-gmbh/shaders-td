---
name: build
description: "Builds an original TouchDesigner shader (GLSL TOP, GLSL MAT for glass, refraction or reflection on any 3D object, feedback loop or procedural study) with a network builder, presets and a tutorial. Use when the user wants to make, port or change a TD shader or .tox, even if they only describe a look. Not for TD Python scripting unrelated to shaders. To review or debug, use the review skill; for a tutorial only, the explain skill."
license: "CC-BY-NC-4.0 (toolkit material; see the plugin's NOTICE.md)"
---

# Build a TouchDesigner shader

Works in chat hosts and coding agents. [Hosts](../research/references/chat-web.md)
says what to deliver with the tools you have, and what outranks this skill: the
user's instructions, then the host's or organisation's standing rules. One rule
never yields: do not claim a check that did not run.

The normal product is an original shader and the tutorial for it, unless the
user narrows the scope.

## Read this much, then build

Required reading is this file and one route file. The rest is for the moment
the task calls for it.

| The brief is about | Route file |
| --- | --- |
| An image effect or generator on a GLSL TOP: post-processing, patterns, halftone, dithering | [GLSL contract and pitfalls](references/td-glsl-pitfalls.md), first section |
| Trails, decay, simulation, anything that reads its own last frame | The same, then [feedback loops](references/feedback.md) |
| A material on 3D geometry (GLSL MAT) | [Material route](references/material-route.md) |
| Glass, refraction, dispersion or reflection | [Glass notes](references/glass-refraction.md) |

Read further only when it applies:

- Which technique, and where it comes from: the [research](../research/SKILL.md) skill.
- Open creative choices: [co-design](references/co-design.md).
- Writing `build.py`, `builder.py`, `native.py` or presets: [builders and helpers](references/builder-and-helpers.md).
- Records and pending checks: [dossier](references/dossier.md). Running and exporting in TouchDesigner: [native delivery](references/native-delivery.md).
- A GLSL MAT in the user's own scene: [material integration](references/material-integration.md). Displacement, raymarched proxies, data passes: [material recipes](references/material-recipes.md).
- Several variants of one study: [study families](references/study-families.md).
- No TouchDesigner at hand: [checks without TouchDesigner](../review/references/host-free-checks.md).
- Compute shaders or POPs: read the installed build and Derivative's current documentation first; this plugin has no tested recipe for them.

## Common mistakes

- Binding a uniform the shader does not declare, or declaring one nobody binds. It reads zero without an error ([contract](references/td-glsl-pitfalls.md#the-basic-contract)).
- Using `res.zw` as a texel size. `.xy` is one texel; `.zw` is the size in pixels.
- Pointing the Feedback TOP at a display branch. It must name the end of the loop, or the trail never accumulates.
- A builder that deletes or rewires what is already in the user's project. Create one new component and touch nothing else.
- Driving motion with `speed * absTime.seconds`. It jumps when the speed changes and loses precision after hours; integrate the phase each frame ([pitfalls](references/td-glsl-pitfalls.md#integrate-animation-time-on-the-cpu)).
- Experiment presets that leak state. Each resets the look controls, keeps the setup controls and gives the same result in any order ([builders and helpers](references/builder-and-helpers.md#make-experiments-reset-the-look-and-keep-the-setup)).
- Treating a custom GLSL MAT like a built-in one. Fog, transparency sorting, picking and extra colour buffers are the shader's job ([material integration](references/material-integration.md#call-the-pipeline-hooks-yourself)).
- Changing a look the user has already seen without asking ([co-design](references/co-design.md#hold-back-look-changes-until-the-user-decides)).

## Find out what you are building on

With TouchDesigner connected through its MCP server (TDMCP), read the build,
OS, GPU, project path, target network, resolution and input formats before
changing anything, then build and check natively. Without it, state the target
build as an assumption, write the source, and record every native check as
pending with the steps to run it. This plugin is a set of skills and
references; it does not control TouchDesigner.

A file with a `.tox` suffix is a native export only if TouchDesigner saved it.

## Start from a seed or from the two scripts

```sh
python3 scripts/scaffold.py /new/study --example contour-loom
```

Seeds: `contour-loom` (GLSL TOP pattern), `phosphor-memory` (feedback),
`contour-material` (GLSL MAT), `orbital-relic` (signed distance fields),
`lantern-fog` (volume), `pigment-census` (image statistics), `resonant-foil`
(vertex displacement), `tidal-ink` (state transport). A seed is a working
example to rebuild for the brief, not a generator: replace its mechanism and
composition. The script leaves the example's `.tox`, captures and results
behind, resets the records, installs the current builder and helpers, and adds
the licence notice.

Without the plugin's `examples/` folder, start from `scripts/native_builder.py`
(save it as `builder.py`) and `scripts/native_tools.py` (as `native.py`), and
write `study.json` as the [dossier](references/dossier.md) describes.

The five [liquid-glass studies](../../examples/LIQUID-GLASS.md) are not seeds.
They are larger GLSL MAT studies; the glass notes say when to read which.

`build.py` runs inside TouchDesigner. It creates one new component, embeds the
GLSL in Text DATs, exposes the controls and returns the component.

## Steps

1. **Foundation.** Get input, shader and output working with a trivial render.
   Write down UV orientation, pixel units, colour space, alpha, filtering and
   pixel format, and every sampler and uniform binding.
2. **Mechanism.** Make each stage visible on its own: coordinates, field, mask,
   state, normal or density. Give the reader one control per cause, a reset and
   a fixed time.
3. **Composition.** Combine subject, signal, operator and interaction into the
   look the brief asks for. Say what is new compared with the source demo.
4. **Challenge.** Find one real limitation under fixed conditions and keep the
   baseline to compare against. Frame differencing detects change, not
   velocity; procedural shading is not physical simulation.
5. **Measure.** Before anything runs, give an estimate the user can check:
   the passes per frame, the resolution of each, the texture reads per pixel,
   and which of them dominates on the target GPU. Call it an estimate. When
   TouchDesigner ran: record build, GPU, resolution, format, frame rate, cook
   policy and timing method. GPU time, CPU cook time and display frame rate
   are three different numbers.
6. **Teach.** Keep the intermediate views and named experiment presets, and
   write [the tutorial](../explain/SKILL.md) alongside the code.
7. **Review.** Run the [review](../review/SKILL.md) skill's checks. Export
   `.tox` or `.toe` only through TouchDesigner, and reopen the saved copy.
8. **Deliver** with the licence and credit below, and a list of what is still
   pending.

Collect the user's preferences before building, deliver the complete study, and
treat their reaction as the next round. Show a prototype part-way only when the
user asked to steer along the way.

## Licence and credit at delivery

Settle one thing before building: is the work commercial (a paid show, a
commission, client work)? If it is, or probably is, do not start from a seed
and do not copy the bundled scripts or example code. Write the shader, the
builder and the helpers from scratch for the brief, so the study belongs to
the user, and credit the article the technique came from.

Say this to the user when you deliver, in plain words:

- A study started from a seed, copied from the bundled scripts or adapted
  from one of the plugin's examples is licensed CC BY-NC 4.0 like the toolkit:
  non-commercial use only. Paid shows, commissions and client work are not
  covered.
- It carries this credit: "Built with Shaders for TouchDesigner by Swisoft GmbH
  (CC BY-NC 4.0). Techniques after Maxime Heckel's shader articles,
  blog.maximeheckel.com. Not affiliated with or endorsed by Maxime Heckel or
  Derivative."
- Name the article the technique came from. If code was adapted from his
  source or from another author he quotes, their notice travels with it
  ([what applies to a study](../../ATTRIBUTION.md#what-applies-to-a-study-you-build)).
- Files written from scratch for the user's brief are the user's.

Keep creative acceptance, compile evidence, rendered controls, export and
reopen, performance and installation as separate statuses. Do not reopen
creative choices the user has accepted.
