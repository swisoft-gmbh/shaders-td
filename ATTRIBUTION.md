# Attribution and source notices

**Maxime Heckel's articles, interactive explanations, and shader examples are
the foundation of this toolkit.** Original work:
[blog.maximeheckel.com](https://blog.maximeheckel.com/),
[blog source](https://github.com/MaximeHeckel/blog.maximeheckel.com),
and [design system](https://github.com/MaximeHeckel/design-system).

This is an independent toolkit published by Swisoft GmbH. Its reference library
("the archive") was collected from material Maxime Heckel makes publicly
available: his blog, the blog's public source repository, his public companion
repositories and his live demo site. It is not authored, sponsored or endorsed
by Maxime Heckel. The plugin name is
generic; Maxime Heckel is credited as the knowledge base. The workflow
synthesis, retrieval tooling, templates, and example study are newly authored
for this package. No model has been fine-tuned.

## Preserved material

- Article MDX is copied unchanged from the public blog repository
  (github.com/MaximeHeckel/blog.maximeheckel.com, commit 9837a41). Its notice is
  [Creative Commons Attribution–NonCommercial 4.0](skills/research/references/corpus/licenses/BLOG-CONTENT-CC-BY-NC-4.0.txt).
  The archived README distinguishes article/image content from source code.
  The attribution that travels with the files is
  [their notice](skills/research/references/NOTICE.md).
- Blog widget/source code is copied unchanged and retains the
  [MIT notice, copyright 2024 Maxime Heckel](skills/research/references/corpus/licenses/BLOG-CODE-MIT.txt).
  Keep the notice when adapting substantial source code.
- Exact source links, commits, SHA-256 hashes, and original archive paths are in
  [the manifest](skills/research/references/corpus/manifest.json).
- Decoded scene exports are derived from those unchanged source files and retain
  the MIT notice. No image of his is bundled: the
  [media catalog](skills/research/references/media-catalog.json) lists each
  image's caption, alt text and public URL only. Three diagrams that earlier
  versions carried were removed in 1.0.0, because they are served by his CDN
  and are not part of the licensed blog repository.
- The glossary (`corpus/blog/content/glossary.json`) derives from Heckel's
  article content (upstream `content/`). It was generated with an AI model by
  the blog repository's own script, which is retained as provenance. It is an
  adaptation of the article content under CC BY-NC 4.0, not MIT code, and it is
  navigation, not newly attributed authored explanation.
- The plugin's icons and colours are Swisoft's own. They no longer use values
  from his design system (changed in 1.0.0). The design-system snapshot stays
  in the reference library as source material; its package metadata declares
  MIT and the upstream repository has no licence file, so the standard MIT text
  is included as `corpus/repositories/design-system/LICENSE`.
- Source articles and source files credit other researchers and creators.
  [THIRD-PARTY.md](THIRD-PARTY.md) lists each one with author, licence and
  files. Preserve those credits when their algorithms are used; this toolkit
  does not reassign those inventions to Heckel.
- Companion repositories retain their own package metadata and available
  notices. The two vaporwave projects include their MIT notices. Color-to-vec3
  and the design system declare MIT in package metadata and have no licence
  file upstream; the standard MIT text is now included as `LICENSE` in each
  folder.
- The nine bundles from his live demo site (r3f.maximeheckel.com) and the
  WebGPU reproduction repository have no redistribution licence and are not
  distributed with this plugin. The skills link to their live public URLs
  instead; see the live-sources table in
  [skills/research/references/NOTICE.md](skills/research/references/NOTICE.md#live-sources-not-included).

This package includes noncommercial article content. Its presence is not a
blanket commercial license for redistributing that content.
No blanket license covering all bundled sources is declared. New shaders and
new prose should identify their actual borrowed material and applicable notices.

## What applies to a study you build

| What the study contains | Terms that travel with it |
| --- | --- |
| Files started from a toolkit seed (`scaffold.py`), copied from the bundled scripts (`native_builder.py`, `native_tools.py`) or adapted from a toolkit example | CC BY-NC 4.0, credit to Swisoft GmbH and to Maxime Heckel; non-commercial use only |
| Text or code blocks taken from one of his articles | CC BY-NC 4.0, credit to Maxime Heckel with the article's title and URL |
| Code adapted from his blog source or companion repositories | MIT; keep "Copyright (c) 2024 Maxime Heckel" and the permission notice with the copy |
| Code from another author that his source quotes | That author's terms, see [THIRD-PARTY.md](THIRD-PARTY.md) |
| Files you wrote from scratch for your own brief | Yours. Crediting the article that taught the technique is still the right thing to do |

## Suggested credit in a new tutorial

> This study builds on techniques explained by Maxime Heckel in [specific
> article title and URL]. The new composition, controls, and implementation
> adaptations are described here. See the linked original work and its cited
> researchers for the foundations.

Replace the placeholder with the sources actually used. Say “code adapted from”
where code is adapted; “informed by” is not a substitute for a code notice.

## TouchDesigner adaptation

The native recipes, builders, shaders, figures and tutorial prose are newly authored toolkit material. The archive's TouchDesigner mentions refer to web recreations; they do not establish that Heckel authored these native projects. Derivative API summaries link their official sources and are kept separate from preserved authored material. The icon reuses this toolkit's original contour motif and adds an original node-chain motif.
