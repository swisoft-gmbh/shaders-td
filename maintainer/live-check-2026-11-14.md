# Live check, 14 November 2026

Scope: whether anything Maxime Heckel published is missing from the library.
Method: his blog feed and index (fetched live), the GitHub API for his
repositories and gists, the comparison of the bundled blog commit with the
repository's head, and two web searches. Read-only; nothing was added to the
corpus.

## Result

| Source | Finding |
| --- | --- |
| Blog articles | None missing. The feed (built 26 October 2026) has no post newer than Shading Motion (18 August 2026). All 17 graphics articles and the 10 context articles are bundled. |
| Blog repository | Head `047b866` (26 October 2026) is 31 commits ahead of the bundled `9837a41` (4 October 2026). 145 files changed; 40 of them are bundled. All changes are interface or performance work (Next.js upgrade, callouts, slideshow, dock, deferred shader initialisation). `content/on-rendering-the-sky-sunsets-and-planets.mdx` gained one line. No new article or shader file. |
| Repositories | 107 public, 51 catalogued (forks were never catalogued). `media-tagger` was renamed `media-tag`. `pencilcase` is new (15 October 2026, a Swift app, unrelated). His forks of `drei` (July 2025) and `react-postprocessing` (June 2025) are not catalogued. |
| Gists | 25 public, all catalogued. |
| Playground site | r3f.maximeheckel.com has experiments without an article: `global-illumination-5`, `global-illumination-8`, `sdf7`, `sdf13`, `dof-fbo`, `flowfield`, `solar`, `shaking`, `responsive`, and the root scene. No source is published. Added to `supplemental-sources.md` as view-only links. |
| Elsewhere | Work in progress on X only: a WebGPU path tracer (September 2026) and a seven-segment display shader (December 2025). The Config 2025 talk is covered by its bundled article. |

## Decision

The corpus stays at `9837a41`. Refreshing it would shift line numbers in 40
files and invalidate verified citations, for no change in technique. The
drift is stated in `supplemental-sources.md` ("How current the snapshot is").

## Not checked

The full route list of the playground site (only routes linked from his
portfolio, articles and recent posts were seen), his Bluesky account, and
whether the two Shadertoy authors named in `THIRD-PARTY.md` state a licence.
