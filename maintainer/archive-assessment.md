# Archive assessment and selection

The archive, collected from public sources, is the evidence base. Its existing
index reports 383 saved items, 65,871 payload paths, 26,512 content groups, and
5,057 text-indexed unique documents. Those are different denominators: many
paths are duplicates, dependencies, transport records, or repeated recovery
checkpoints.

## What matters for this toolkit

| Archive area | Priority | Use and limits |
|---|---|---|
| `Downloads/01-source-code-and-repositories/_assembled/source-archive/repositories/blog.maximeheckel.com/` | Essential | Authored MDX, component registry, shader examples, visualizers, Sandpack scene maps, dependency versions, and code/content notices. The package selects the shader curriculum and relevant widget families. |
| Same assembled archive, `historical-sources/` | Important when a post cites an older commit | Preserve a pinned version separately. The historical atmospheric `lut.ts` is included alongside the main snapshot; neither silently overrides the other. |
| Same assembled archive, `repositories/design-system/` | Essential for requested branding | Light/dark theme tokens, typography, spacing, radii. Token provenance is recorded in `brand-provenance.json`; the toolkit transcribes a small semantic subset and creates its own icon. |
| Same archive, `linear-vaporwave-three.js`, `linear-vaporwave-react-three-fiber`, `color-to-vec3`, `sandpack-webgpu-repro` | Supporting | Selected source, package metadata, and available notices are bundled as project, conversion, and integration context. Whole repositories and dependencies are not copied. Since 0.6.0 `sandpack-webgpu-repro` is linked by live URL, not bundled: it has no redistribution licence. |
| `Downloads/01-.../01-Code-and-source-reconciliation-10-October-2026/` | Evidence and fallback | Separates authored code context from deployed JavaScript batches. Bundles do not establish original source completeness. |
| `Downloads/02-page-captures-and-recovery/` | Corroboration and missing-page fallback | Rendered/derived text, captured HTML, and recovery evidence. Prefer authored MDX for tutorial structure; keep capture date and URL when using a page capture. |
| `Downloads/03-media-assets-and-dependencies/` | Visual references and exact-demo replay | Textures, videos, models, decoders, CSS, and dependencies. Preserve their exact hashes/URLs if used; the toolkit does not ship this entire media library. Use procedural or user-provided assets for new work when possible. |
| `Downloads/04-offline-replay/_assembled/local-replay/` | Bounded visual reconstruction | Local replay derivative and transport checks. Its README explicitly says it is not a functioning copy of every historical demo. Archived visual checks were limited by GPU access. |
| `Downloads/05-indexes-checkpoints-and-audits/` | Provenance, gaps, duplicate resolution | Use ledgers and corrections to decide what a capture actually proves. Repeated checkpoints are not additional tutorials and should not inflate retrieval relevance. |
| `Downloads/06-retired-do-not-restore/` | Excluded | Retired/truncated archives are not restored or promoted to reference truth. |
| `Space-exports/` | Navigation/history | Collection-level context, not primary shader implementation evidence. |
| `plugin-preparation/` | Starting index | Existing SQLite retrieval and catalogs speed discovery. Indexed absence is not proof that a large/minified/binary file is missing. |

## Selected curriculum

The core comprises **17 graphics/shader tutorials**: vaporwave, shader
foundations, particles, refraction/dispersion, render targets, surface
raymarching, volumetric clouds, caustics, Moebius-style filtering, painterly
filtering, retro/dithering, creative post-processing, volumetric lighting,
TSL/WebGPU, halftone, motion, and atmospheric scattering.

Ten supporting articles cover learning in public, Config 2025, design-system
thinking, Bézier curves, spring physics, scrolling, animation orchestration,
advanced and layout animation, and CSS composition. Their widget source is
included. The remaining posts concern topics such as React state, CI, serverless,
SwiftUI, or personal history.

The [coverage audit](coverage-audit.json) records decisions for all 60
articles, 51 repositories, 26 gist groups, and 25 historical files. It added
the standalone shader renderer/playground, the index particle/ASCII scene,
exact design tokens, companion project code, and nine separately labeled
deployed demo captures. Since 2026-11-05 those captures are linked by live URL, not
bundled. See [the supplemental guide](../skills/research/references/supplemental-sources.md).

The main blog commit is
`9837a4106e226c7c35775e44456a0250f1b894e5`. The design-system snapshot is
`54a19e07f016d67f349e19e064278bd00ae549c4`.
The source manifest retains original paths, file hashes, URLs, and commits.
The bundled corpus can be used without the original 5.5 GB folder.
The secondary catalogs point back to the original archive and are not portable
payloads; their absence after moving the plugin does not affect core retrieval.

An additional check against the combined link index found apparent article
paths such as `/posts/shaders/` and `/posts/lighting/`. The retained
`source-batches/provenance-001/literal-context.json` shows these in tests, while
the provenance batch's `semantic-assessment.md` distinguishes five fixture
families and two mock-stream families. They are not added as missing tutorials
merely because their strings resemble real blog URLs. This establishes the
origin of those indexed literals, not that such URLs could never have existed.

## Scope of completeness

This package is a curated source/reference toolkit, not a mirror of every
deployed shader. Sandpack modules contain virtual source files inside template
strings and may reference remote models/textures or imports supplied by their
wrapper. They are searchable source evidence, not prebuilt runnable apps.
Neither retaining source nor hash verification proves a demo renders.

The replay README originally describes nine current captures and 71 mappings;
the archive's replay catalog lists 74 resource records after later additions.
Preserve those records' own scope rather than combining them into a claim of
total historical coverage. Original URLs that appear in a post may be unavailable.

Archived source is authoritative for what was captured, not infallible technical
truth or a promise of current API behavior. Validate new implementations,
especially version-sensitive Three.js/TSL, WebGPU limits, and rendering defaults.

The [20 October live audit](live-audit-2026-10-20.md) rechecked all 17 core
article URLs against the live index. The 1.4 selection adds shared teaching
infrastructure, generated-glossary provenance, decoded scene export, a media
reference inventory and explicit source-variant notes. Read
[source formats](../skills/research/references/source-formats.md) before adapting an example. Article coverage,
reference portability and executable dependency closure are separate properties.
