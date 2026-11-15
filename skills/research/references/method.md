# A documented method, with evidence

Native sibling: preserved examples below are web evidence. TouchDesigner routes
are new adaptations; read [scope](native-scope.md) and [native routes](native-techniques.md).

This is an operational synthesis of Maxime Heckel's published work, not a claim
to recover his private thought process. The archive shows finished explanations
and selected experiments, not a complete chronological lab notebook.

## Evidence behind the workflow

| Practice visible in the archive | Specific evidence | How this toolkit applies it |
|---|---|---|
| Begin with an effect worth investigating; break it into observable parts. | [Vaporwave](corpus/articles/vaporwave-3d-scene-with-threejs.mdx), “Deconstructing the original scene”; [Caustics](corpus/articles/caustics-in-webgl.mdx), “Anatomy of a Caustic Effect in WebGL”. | State a concrete visual target and decompose shape, light, sampling, motion, and interaction before choosing implementation. |
| Explain the smallest useful mechanism before the finished scene. | [Shader study](corpus/articles/the-study-of-shaders-with-react-three-fiber.mdx), vertex/fragment shaders → uniforms/varyings → interactive noise; [Raymarching](corpus/articles/painting-with-math-a-gentle-study-of-raymarching.mdx), marching rays → SDF → sphere → lighting → composition. | Keep a baseline and a debug view of the signal that drives the effect. |
| Pair explanation with controls, diagrams, and editable code. | The MDX component registry and each article's visualizer and Sandpack imports; [Raymarching](corpus/articles/painting-with-math-a-gentle-study-of-raymarching.mdx), “Marching rays”. | Make each important parameter reveal a causal relationship. Prefer a small interactive experiment to an unexplained wall of shader code. |
| Let a limitation motivate the next technique. | [Painterly](corpus/articles/on-crafting-painterly-shaders.mdx), square sectors → circular sectors → weighting → polynomial approximation → anisotropy; [Dispersion](corpus/articles/refraction-dispersion-and-other-shader-light-effects.mdx), sharp separated channels → additional samples → performance cost. | Record observed symptom, hypothesis, controlled change, and result. Do not fabricate a failed attempt for a better story. |
| Derive enough mathematics to make the implementation understandable. | [Painterly](corpus/articles/on-crafting-painterly-shaders.mdx), structure tensor/eigenvalues/eigenvector; [Shaping light](corpus/articles/shaping-light-volumetric-lighting-with-post-processing-and-raymarching.mdx), coordinate transformations and depth stopping. | Define symbols, units, spaces, and assumptions; show the corresponding code. |
| Use physically motivated approximations and identify their boundaries. | [Caustics](corpus/articles/caustics-in-webgl.mdx), explicit choice of an approximation instead of raytracing; [Motion](corpus/articles/shading-motion.mdx), optical flow for creative input rather than production computer vision. | Explain what the model approximates and what it does not account for. Judge the visible result separately from physical accuracy. |
| Optimize the dominant cost without losing sight of the image. | [Cloudscapes](corpus/articles/real-time-cloudscapes-with-volumetric-raymarching.mdx), blue-noise jitter and bicubic reconstruction; [Sky](corpus/articles/on-rendering-the-sky-sunsets-and-planets.mdx), transmittance LUT removes repeated light marches. | Change a measurable cost such as sample count, render resolution, pass count, or repeated computation. Compare at fixed conditions. |
| Stop at an appropriate level of complexity. | [Painterly](corpus/articles/on-crafting-painterly-shaders.mdx), conclusion favors Papari with polynomial weighting for many cases; [Sky](corpus/articles/on-rendering-the-sky-sunsets-and-planets.mdx), explicitly documents omitted multiple scattering and its 2D aerial-perspective approximation. | The most elaborate archived technique is not automatically the right choice. Keep limitations in the final article. |
| Recombine ideas and share what was learned. | [Learning in public](corpus/articles/learning-in-public.mdx), “How I plan to share what I learn”; [Post-processing](corpus/articles/post-processing-as-a-creative-medium.mdx), sampling grids become LEDs, crochet, bricks, glass, and interactions. | Transfer mechanisms into a new subject or interaction; describe the new contribution precisely. |
| Credit the chain of influence. | [Config 2025](corpus/articles/config-2025.mdx), resources; painterly references Papari and Kyprianidis et al.; raymarching/clouds reference Inigo Quilez and others. | Credit Heckel's explanation and implementations, plus original researchers when reusing their algorithms. |

## Proposed working procedure

The named phases, JSON dossier, checks, and originality criteria below are
**toolkit recommendations inferred from those practices**, not a verbatim
procedure published by Heckel.
The [co-design protocol](../../build/references/co-design.md) adds the
plugin creator's requirement for interactive briefing, user choice, and prototype
feedback. Apply it throughout these phases rather than choosing the user's
visual direction internally.

1. **Observe.** Write a short visual brief: what moves, what changes with view,
   what reacts to input, and what must remain legible.
2. **Ground.** Retrieve 2–4 relevant sections and their actual demo modules.
   Record why each reference matters. A citation should support a specific claim.
3. **Choose.** Decide whether the dominant mechanism is geometry/material,
   screen-space transformation, raymarching, or stateful GPU simulation.
   Explain one plausible alternative and its cost.
4. **Isolate.** Build the smallest visual proof, with controllable time and input.
   Establish a shared convention for coordinate spaces and color.
5. **Compose.** Connect that proof to a distinctive subject/interaction.
   Document the dependency graph between passes.
6. **Challenge.** Find an actual failure case; change one causal variable.
   A comparison without matched camera/time/seed may not isolate the cause.
7. **Measure.** Record hardware, TouchDesigner build, OS, resolution, texture format, and timing
   method. Distinguish elapsed frame intervals from GPU workload.
8. **Teach.** Write from the implementation and evidence. Preserve useful
   intermediate views. Make the reader able to predict and then test an effect.
9. **Review.** Check the shader and article together. State unresolved limits.

## New-work decision record

Each consequential choice can be summarized in five sentences:

- We need this visible behavior under these constraints.
- This archived mechanism provides this specific useful property.
- The alternative changes these costs or assumptions.
- We chose this implementation and made these adaptations.
- The observed result is this; these remaining points are untested.

This is a concise, reproducible engineering explanation. It is not a transcript
of hidden reasoning or a speculative account of how another person thinks.

## Deriving a new shader without cloning a demo

Use the archive as a vocabulary. Combine a **subject**, **signal**, **operator**,
**representation**, and **interaction**. For example, a density field need not
be a cloud: it could control engraved bands in a moving topographic membrane.
A halftone neighborhood need not form printed dots: it could reveal localized
deformation driven by a motion mask.

Before building, state which components are borrowed and which are new. Compare
the finished effect to the selected sources on shape, input, dynamics, pass
structure, and viewing behavior. These are creative prompts, not evidence of
global novelty. The implementation still has to work.

## Version discipline

The main blog snapshot and the embedded Sandpacks can use different dependencies.
For example, the raymarching wrapper pins Three.js `0.149.0` and R3F `8.11.2`,
while atmospheric examples use Three.js `0.179.0` and R3F `9.2.0`.
The top-level package does not determine the runtime of every article demo.
Read the selected wrapper. Never merge GLSL `Effect`/`Pass` examples and TSL node
examples merely because both are called post-processing.
