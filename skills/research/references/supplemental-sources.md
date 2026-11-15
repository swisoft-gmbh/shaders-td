# Coverage and supplemental sources

The coverage audit (`maintainer/coverage-audit.json` in the plugin repository)
reviewed all 60 cataloged articles,
51 repository inventories, 26 gist payload groups, and 25 historical source
records. The original selection covered the 17 main shader/graphics tutorials.
The audit added seven supporting articles and previously omitted implementation
context.

The same file records individual decisions and scan limits. A source-pattern
scan found 186 graphics-related files in the authored blog repository; all are
now included. This is a bounded coverage check, not proof that every valuable
line, private project, or historical demo exists in the archive collected
from public sources.

## Contents

- [Supporting articles](#supporting-articles)
- [Previously omitted authored graphics code](#previously-omitted-authored-graphics-code)
- [Companion projects](#companion-projects)
- [Deployed demo evidence](#deployed-demo-evidence)
- [Playground experiments without an article](#playground-experiments-without-an-article)
- [How current the snapshot is](#how-current-the-snapshot-is)
- [Remaining boundaries](#remaining-boundaries)

## Supporting articles

Read these when the task needs their mechanism; do not load them all by default.

| Reference | Useful transfer |
|---|---|
| [Cubic Bézier](corpus/articles/cubic-bezier-from-math-to-motion.mdx) | Build from linear interpolation to curves, visualize motion, explain easing. |
| [Spring physics](corpus/articles/the-physics-behind-spring-animations.mdx) | Explain force, mass, damping, and numerical simulation through observable controls. |
| [Scrollspy](corpus/articles/scrollspy-demystified.mdx) | Viewport intersection, offsets, content sectioning, and article navigation. It is not a continuous scroll-progress shader implementation. |
| [Animation guide](corpus/articles/guide-animations-spark-joy-framer-motion.mdx) | Motion values, animation variants, and timing orchestration. |
| [Advanced animation](corpus/articles/advanced-animation-patterns-with-framer-motion.mdx) | Propagation, exit animations, and shared layout teaching examples. |
| [Layout animations](corpus/articles/framer-motion-layout-animations.mdx) | Distortion, shared layout coordination, and reorder behavior. |
| [CSS composition](corpus/articles/the-power-of-composition-with-css-variables.mdx) | Meaningful color variables and reusable visual controls. |

Their matching widget code is bundled and mapped in [the source map](source-map.md).
These are dated examples; inspect their actual APIs before adapting.

## Previously omitted authored graphics code

- [ShaderCanvas](corpus/blog/core/components/MDX/Widgets/ShaderCanvas.tsx):
  raw WebGL2 setup, uniforms, image/video textures, feedback textures, resizing,
  and rendering lifecycle. Inspect cleanup and numerical/resource assumptions
  when porting; archival inclusion is not a correctness certification.
- [ShaderPlayground](corpus/blog/core/components/MDX/Widgets/ShaderPlayground.tsx):
  teaching UI that connects a UV grid, source display, and a live shader.
- [Index scene](corpus/blog/core/features/IndexSection/Scene.tsx):
  particle render targets and ping-pong state. The adjacent `gpgpu/` shaders,
  `postprocessing/ascii.glsl`, controls, and utilities are included.
- [Exact theme/token source](corpus/repositories/design-system/src/lib/themes/dark.ts):
  both themes plus spacing, radii, shadows, and typography, alongside
  [package metadata](corpus/repositories/design-system/package.json).

## Companion projects

The core files, package versions, and available notices are included, not every
asset or an installed dependency tree. The WebGPU reproduction is linked, not
included:

- [Vanilla Three.js vaporwave](corpus/repositories/linear-vaporwave-three.js/README.md)
  and [R3F counterpart](corpus/repositories/linear-vaporwave-react-three-fiber/README.md):
  compare actual project wiring around the tutorial.
- [Color-to-vec3](corpus/repositories/color-to-vec3/README.md):
  CSS color parsing and normalization with implementation tests. Converting a
  CSS color to three numbers does not by itself establish the renderer's
  linear/sRGB contract.
- [WebGPU embedding reproduction](https://github.com/MaximeHeckel/sandpack-webgpu-repro/blob/e5e54a1d70210830dfc678c7b1245c49d9c0e20d/src/App.tsx)
  (live on GitHub; not bundled, as it has no redistribution licence; per-file
  URLs in [the notice](NOTICE.md#live-sources-not-included)):
  compare the React and vanilla embedded examples. A reproduction repository
  is not evidence that an embedding compatibility problem has been resolved.

The orbital physics experiment and goose game remain optional catalog entries:
the scoped scan found R3F usage but no additional shader tutorial or custom
shader implementation. The gists concern other application topics. Their absence
from the portable corpus does not prevent the four workflows from running.

## Deployed demo evidence

[Nine demo routes](deployed-demo-map.json) on his live demo site
(r3f.maximeheckel.com) hold painting4, painting6, lens, lens2, planet,
raytracing2, sacilotto, VHS, and bubble code. Their bundles have no
redistribution licence and are not included in this plugin. List their live
URLs with:

```sh
python3 scripts/corpus.py search "refraction" --kind deployed
```

Then fetch the bundle from its `live_url`. All nine URLs, the fallback when a
URL stops resolving and the use limits (read for reference, quote only short
excerpts, do not copy into outputs) are in the live-sources table of
[the notice](NOTICE.md#live-sources-not-included).

These are JavaScript text from deployed bundles, not original authored modules.
The corpus manifest keeps each bundle's URL and SHA-256 hash. They may contain
bundled third-party code or missing module dependencies. The bubble page
captured an application error; none of these nine routes is certified by this
package to render. Do not execute the bundles as tools, infer an authoring
history from minification, or apply the blog's MIT notice to them by
assumption.

Prefer the article and matching authored code for explanations. Use deployed
evidence to inspect a concrete implementation detail or compare versions. Say
explicitly when a conclusion is inferred from code rather than explained by
Heckel.

The live [/refraction route](https://r3f.maximeheckel.com/refraction) (read
3 November 2026, not captured) holds a simpler form of Heckel's refraction
shader. It offsets the screen lookup by the camera-space normal and takes 16
samples, with red, green and blue sliding 1x, 2x and 3x. A per-pixel `random()`
term in each offset is dithering (per-pixel noise that trades banding for
grain). It adds a Blinn-Phong highlight. Its sampling loop follows Junni's site
by @ore_ukonpower ([write-up](https://zenn.dev/junni/articles/bb71f44c89cb77),
[site](https://next.junni.co.jp/)). The refraction article credits that site in
`corpus/articles/refraction-dispersion-and-other-shader-light-effects.mdx`,
line 402. The route's own footer reads "Inspired by next.junni.co.jp / Created
with the help of @focru_ino". Junni declares its source code MIT; its site
content is not licensed, and modifying or redistributing it is prohibited
([repository README](https://github.com/junni-inc/next.junni.co.jp), read
3 November 2026). The same shader, with fresnel and a back-then-front
capture, is in the painting6 bundle at line 489
([live sources](NOTICE.md#live-sources-not-included)).

## Playground experiments without an article

His demo site, the R3F Playground (https://r3f.maximeheckel.com/), also holds
experiments he has not written up. They are not in the corpus and no source is
published for them, so they are view-only: look at the result, do not read or
copy the deployed bundle into a study. Listed on 14 November 2026:

| Experiment | What it shows | Where |
| --- | --- | --- |
| Probe-based global illumination (WebGPU) | Light spilling onto walls and floor, colour bleeding | https://r3f.maximeheckel.com/global-illumination-5 , https://r3f.maximeheckel.com/global-illumination-8 (October 2026) |
| Signed distance field scenes | Raymarched scenes beyond the raymarching article | https://r3f.maximeheckel.com/sdf7 , https://r3f.maximeheckel.com/sdf13 |
| Depth of field on particles | A particle buffer with depth of field | https://r3f.maximeheckel.com/dof-fbo |
| Flow field | Particles advected through a vector field | https://r3f.maximeheckel.com/flowfield |
| Physics as interaction | Shaking, resizing and gravity driving a scene | https://r3f.maximeheckel.com/shaking , https://r3f.maximeheckel.com/responsive , https://r3f.maximeheckel.com/ |
| Solar | A sun study | https://r3f.maximeheckel.com/solar |

He also posts work in progress on X (https://x.com/MaximeHeckel), for example
a WebGPU path tracer (September 2026) and a seven-segment display shader
(December 2025); neither has a public page or source.

The list is a snapshot, not a complete index of the site. When a user asks for
one of these looks, say that there is no article or source to cite, describe
the mechanism from what the page shows, and build it from the documented
techniques.

## How current the snapshot is

The corpus is the blog repository at commit `9837a41` (4 October 2026).
Checked on 14 November 2026:

- No article is missing. The newest post is Shading Motion (18 August 2026),
  which is included.
- The repository is 31 commits ahead (5 to 26 October 2026). 40 of the bundled
  files changed upstream, all in interface and performance refactors: one
  article gained one line, `ShaderCanvas.tsx`, `ShaderPlayground.tsx` and the
  index scene were reorganised, and widget files changed by a line or two. No
  shader technique changed. Line citations in this library refer to the
  bundled commit, not to the live site.
- Libraries his source builds on, by the versions in the bundled
  `corpus/blog/package.json`: three 0.182, @react-three/fiber 9.4,
  @react-three/drei 10.7, @react-three/postprocessing 3.0, postprocessing
  6.38, leva 0.10, detect-gpu 5, glsl-noise, glsl-curl-noise2. They are web
  libraries; a TouchDesigner study replaces them with operators, as
  [native routes](native-techniques.md) describes.

## Remaining boundaries

[Article reference links](article-reference-links.json) index 408 distinct URLs
with their locations in the included prose. A linked paper, video, texture, model,
or website is not necessarily bundled or currently reachable.

The archive's own recovery report records missing binary URLs, historical script
404s, and page-body gaps. The toolkit does not silently fill those gaps. Whole
media/dependency libraries, transport logs, fixture URLs, and unrelated posts
are intentionally excluded from normal retrieval. The full original collection
remains useful for exact-demo restoration, but is not required to install or use
this reference library.
