# The published teaching pattern

This table is a synthesis of observable article structure. It does not claim
access to unpublished reasoning. All source paths are in `corpus/articles/`.

| Evidence | Teaching move | Native adaptation |
|---|---|---|
| `shading-motion.mdx` 58–157: differencing diagram, code, raw mask widget, flicker limitation, decay, second widget | Introduce one new cause when the previous model reaches a visible limit. | Separate raw mask, stored state and styled output TOPs; compare matched frames and reset before each run. |
| Same 159–270: compute preparation versus rendering | Explain architecture by the kind of work each stage performs. | Annotated network with input contracts; state pass stores data, style pass only interprets it. |
| Same 648–745: signed encoding and intermediate field | Explain representation before using it creatively. | Show channel legend and actual direction diagnostic; state when the field is only a heuristic. |
| `on-crafting-painterly-shaders.mdx` 62–112: kernel model then full-image visualizer | Make the local operator understandable before its global image. | A small neighborhood diagram and a controlled input TOP with an edge. |
| Same 224–425: sectors, weighting, cost | Let a useful limitation motivate a more sophisticated model. | Switch between variants at fixed input and resolution; measure sample/cook cost separately. |
| Same 426–829: tensor graph, gradients, eigenfield, anisotropy | Show the hidden field and the pass dependencies. | Tensor/orientation views named exactly like nodes in the native project. |
| `painting-with-math-a-gentle-study-of-raymarching.mdx`, “Marching rays” | A stepping diagram precedes a complete scene. | Ray-step plot and iteration view; code excerpts from the delivered shader. |
| `shades-of-halftone.mdx` 52–202, 291–413 | Shape, sampling and interference get their own controls. | Fixed pitch/angle/luma tests, AA comparison and reset presets. |
| `refraction-dispersion-and-other-shader-light-effects.mdx` 335–458 | A simplified channel separation model precedes more samples and their cost. | Sample-count experiment with unchanged input/camera/time. |

Read the imported widgets too. Their parameter ranges, reset behavior, overlays,
captions and progression are part of the method. Scene modules and full example
implementations may use different conventions: compare them before adapting.

## What an in-depth new explanation includes

Start with a concrete visual question. Define the minimum mathematical model,
derive only what the implementation needs, name spaces/units, and reveal the
signal before embellishing it. Tie a real decision to its alternative and
consequence. Invite a precise action, explain what the reader should inspect,
then report what actually happened when tested.

Keep technical correctness and storytelling honest. Do not invent “I spent days
discovering…” anecdotes, failed attempts, benchmark numbers or source-author
motivations. A limitation can be explained without pretending it was personally
discovered. Credit Heckel's pedagogical contribution and the original research
his articles cite when used.

A native tutorial can be explorable through the delivered network, parameter
presets and captures. If the user wants a browser blog with embedded interactive
models, build that additional presentation explicitly; a README pointing to a
network is not equivalent. Share one implementation or generated excerpts to
prevent drift.
