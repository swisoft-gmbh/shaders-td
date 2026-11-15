# Web shader coverage and format audit · 20 October 2026

The live [blog index](https://blog.maximeheckel.com/) and all 17 selected shader
article pages were opened for this audit. The visible web-graphics curriculum
matches the 17 core articles already bundled, including
[halftone](https://blog.maximeheckel.com/posts/shades-of-halftone/),
[motion](https://blog.maximeheckel.com/posts/shading-motion/), and
[atmospheric scattering](https://blog.maximeheckel.com/posts/on-rendering-the-sky-sunsets-and-planets/).
No additional web-shader tutorial was identified in that index.

This is an article-coverage comparison, not a byte-for-byte comparison of every
live implementation. It does not establish complete coverage of every experiment,
external link, old deployment or social post. The archive, collected from
public sources, remains the ground truth for the bundled original files.

The observed index footer linked commit
`514818461e256154b310fa246ad21736ccc8fc4b`, while the archive remains pinned to
`9837a4106e226c7c35775e44456a0250f1b894e5`. The linked live commit adds image
accordion UI, not a new shader tutorial. Different fetched pages exposed
different footer revisions, so this audit does not pretend they form one atomic
site snapshot.
[Observed live commit](https://github.com/maximeheckel/blog.maximeheckel.com/commit/514818461e256154b310fa246ad21736ccc8fc4b).

## What this audit changed in 1.4

- Added 33 archived code/support files that the previous selection omitted,
  including the shared Sandpack host, setup and editor presentation, image and
  video presentation, comparison/fullbleed/math infrastructure, and glossary
  generator provenance. The previous selection treated Sandpack as a directory,
  but the shared host is a file.
- Added the archived glossary as separately labeled generated navigation.
  The [live glossary](https://blog.maximeheckel.com/glossary/) is useful for
  discovery; the retained generator establishes that its definitions are
  generated, so they are not promoted to authored technical authority.
- Mapped all 141 embedded Sandpack selectors from the 17 core articles after
  the final 1.4.1 critique corrected an omission: the initial 1.4.0 catalog had
  134 demos from 16 articles, missing seven Vaporwave `script=` embeds.
  Decoded 342 distinct virtual file contents, preserving module, wrapper,
  shared setup and imported-literal provenance. Added source export without
  executing archived JavaScript.
- Added an image reference inventory covering 110 literal `<Image>` uses.
  Three diagrams matched recovered, hash-verified payloads under the supported
  manifest/resource matching rules and are included. Other rows remain
  reference-only. This is not a conclusion that the other images are absent
  from every archive representation.
- Added explicit notes on prose/code angle variants, refraction coordinate
  spaces, volume integration and smoothing edges. Originals stay unchanged;
  the new work records and tests its adaptations.

The resulting source corpus has 393 preserved text files: 27 articles, 352
code/support references, nine deployed captures, four notices and one generated
glossary. Derived catalogs, decoded payloads and diagrams are additional package
files. See [source formats](../skills/research/references/source-formats.md) for practical usage and limits.

## Test scope

The three new studies exercise refraction/dispersion, volumetric integration,
and halftone post-processing, each paired with an interactive browser article.
They use local, procedural WebGL2 implementations and do not require downloaded
textures, models or npm packages. Their numerical/static checks are distinct
from browser rendering and user acceptance.

The user subsequently reviewed all three pairs and gave positive overall
feedback. The final critique tightened section-to-demo validation and corrected
the scene index. That closure review (`validation/final-critique.md`) is not
included in this plugin.

These three studies do not validate the TSL/WebGPU runtime, every archived
example, installed-host activation, device performance, or mobile behavior.
The plugin's test record keeps those boundaries explicit.
