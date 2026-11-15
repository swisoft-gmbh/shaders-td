---
name: research
description: "Looks up how a TouchDesigner (TD) shader idea could work, using the bundled copies of Maxime Heckel's published web articles and their code, and compares native routes. Use before building, or when asked how a web, three.js or React Three Fiber effect (refraction, glass, caustics, raymarching, dithering) could work in TD. To build it, use the build skill."
license: "Mixed. Toolkit text CC-BY-NC-4.0. Maxime Heckel's articles (CC-BY-NC-4.0) and code (MIT) are covered by the notice in references/NOTICE.md. See the plugin's NOTICE.md."
---

# Research a TouchDesigner shader idea

Works in chat hosts and coding agents. [Hosts](references/chat-web.md) says
what to deliver with the tools you have, and what outranks this skill: the
user's instructions, then the host's or organisation's standing rules. One rule
never yields: do not claim a check that did not run.

## Common mistakes

- Porting the web formula instead of the mechanism. A web demo's numbers assume its canvas, camera and units; find what the code does to the image, then choose the TouchDesigner operators that do the same ([native routes](references/native-techniques.md)).
- Trusting the article over its code, or the code over the article. They sometimes differ; read both and say which one a claim rests on ([known differences](references/source-formats.md#known-differences-and-adaptation-cautions)).
- Copying code that is not licensed for it. His deployed demo bundles and six files based on Shadertoy shaders are reference only: read them, quote a short excerpt, write your own version ([live sources](references/NOTICE.md#live-sources-not-included), [third-party code](../../THIRD-PARTY.md)).
- Citing from memory. Give the source ID, line range and URL you actually read, so the claim can be checked.

## Research steps

Read [scope and source hierarchy](references/native-scope.md) first. This library
contains Heckel's published web graphics work; **Shading Motion describes bringing
TouchDesigner-inspired effects to WebGPU**, not a native TouchDesigner tutorial.
Do not invent native articles, authorial intent, endorsement, or training.

The library separates four things: bundled sources, reference-only material
that is linked but not included, native API guidance, and techniques this
toolkit added. Do not present the last three as something the archive contains.

The archive physically travels with this plugin. Resolve paths relative to this
skill, never a previous user's Downloads folder. Python helpers require Python
3.10+. A host without file execution can still read the references directly.

1. Extract observable goals, inputs, state, output, and explanatory audience from
   the request. Follow [co-design](../build/references/co-design.md) for
   missing creative choices; a research-only request need not build anything.
2. Read [the documented method](references/method.md) and
   [native technique routes](references/native-techniques.md).
3. Retrieve relevant article sections **and their actual implementation/widgets**:

   ```sh
   python3 scripts/corpus.py search "temporal decay" --kind article
   python3 scripts/corpus.py article shading-motion
   python3 scripts/corpus.py read articles/shading-motion.mdx --start 58 --end 157
   python3 scripts/demos.py list --article shading-motion
   python3 scripts/demos.py show shading-motion::scene1
   ```

   Select actual IDs from `list`; do not assume every article uses `scene1`.
   [Source formats](references/source-formats.md) explains MDX, virtual files,
   code labels, wrapper dependencies and known inconsistencies.
   `demos.py export ID /new/directory` exports **web reference code**, not a
   native project. It decodes static strings without executing archived JS.
4. Retrieve 2–4 focused mechanisms, not the whole corpus. For each report:
   source ID, lines, URL, hash/commit, relevant mechanism, source limitation,
   proposed native operator/pass, and adaptation needed.
5. Verify build-sensitive native APIs using [official sources](references/native-api.md)
   and the user's installed TouchDesigner. Archived source is ground truth for
   what was published; it does not specify today's host APIs.
6. Compare viable routes in terms the user can see: image processing, geometry
   material, persistent texture state, volume integration, or buffer compute.
   Explain the alternative and why a route fits. Do not simply rename TSL/WGSL
   functions to GLSL.
7. Return useful options or move directly into
   [build](../build/SKILL.md) when the user asked for creation.

Use [publication evidence](references/teaching-evidence.md) to plan how the reader
will discover the mechanism. Separate source facts, toolkit inferences, new
choices and observed results. Explain decisions concisely; never fabricate a
person's private thought process or a chronology of experiments.

## Other references

- [Compact source index](references/chat-source-index.md): read first for any source lookup.
- [Technique field guide](references/techniques.md): read when choosing a route or searching techniques by need.
- [Source map](references/source-map.md): read when you need exact article lines or scene selectors.
- [Supplemental sources](references/supplemental-sources.md): supporting articles, companion projects, his live demo site and the experiments on it that have no article.
- [Notice for Heckel's material](references/NOTICE.md) and [third-party code](../../THIRD-PARTY.md): licences, credits and live-source URLs. Read before quoting or adapting anything, and keep the credits.
- [Name, credit and colours](references/branding.md): how to describe the plugin, and why a study never wears his look.
- The plugin's `maintainer/` folder holds provenance records (archive assessment, coverage audits, catalogues). No task needs them.
