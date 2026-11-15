# Validation scope

The [five mechanism suite](five-mechanisms/README.md) adds five complete
four-mode studies, 25 teaching presets, property checks and native export/reopen
evidence. The original three-study evidence below remains separately scoped.

The source library remains unchanged and is hash-verifiable. Recipe and article
checks validate structure, bindings, source excerpts and section placement.
Native evidence was gathered inside TouchDesigner 2025.33230 on macOS 15.8.1
with an arm64 runtime. The GPU model was not obtained from `app`; no GPU
performance measurement is claimed.

Evidence files distinguish:

- `fresh-build.json`: the current source recipes build and compile without
  reported errors; output readbacks are finite.
- `controls.json`: tested parameter changes alter the expected image branches.
- `temporal-tests.json`: initialized first frame, static input, induced change,
  no new motion after stopping, exponential decay, pause, reset and two fixed
  simulation steps.
- `export-reopen.json`: genuine native saves and loading under a different
  parent, with source/code integrity and render comparisons.
- `package-validation.json`: manifest/skills, source integrity, structural
  checks, relocation and negative regression cases. Its original keys record
  the 0.3.0 suite. 0.4.0 added two keys, `liquid_glass_examples` and
  `package_0_4_0`, described below.
- `review.md`: findings, fixes and remaining limits.
- `user-feedback.json`: the user reported all three outputs visible, with one
  moving. This matches the initial paused contour presets and animated feedback
  preset; it establishes visibility, not creative or tutorial acceptance.

The eight native examples' `validation.json` files link the relevant receipts.
Their captures are actual native outputs; SVG figures are labeled schematics.
The tutorials use predictions for instructions and keep test observations in
the evidence record.

Not established: user acceptance of each shader/tutorial, other operating
systems/builds, live camera/audio resilience, measured performance, a compute
or POPs implementation, or a fresh host invoking the account-installed skills.
The plugin contains no rendering server; an installed skills package is not an
application connection.

## Liquid Glass examples (preview-only)

The five [Liquid Glass](../examples/LIQUID-GLASS.md) studies in `examples/` are
preview-only. **Nothing in them has run in TouchDesigner, and they have no
`.tox`.** Their evidence comes from checks outside TouchDesigner:

- glslang compiles (GLSL 4.60 and Vulkan) against stand-ins for
  TouchDesigner's built-ins, plus negative tests: deliberately broken copies
  that must fail;
- WebGL2 (SwiftShader) previews of the same GLSL files, driven by each
  `study.json`;
- Python unit tests on fake `td` objects;
- the plugin's static study check and tutorial check.

For 0.4.0, on 3 November 2026, the unit tests, glslang compiles, static checks
and tutorial checks were run again on every study, and the preview tests on
Flow, the one study whose shader file changed (comment lines only). The other
preview counts are the committed results of 2 November 2026; no shader logic
changed since. `package-validation.json` keeps the numbers under
`liquid_glass_examples`.

| Study | Unit tests | glslang compiles (negative tests) | Preview tests | Records |
|---|---|---|---|---|
| Liquid Glass (core) | 75 OK | 12 (1) | 35 OK | [validation.json](../examples/liquid-glass/validation.json), [checks/results](../examples/liquid-glass/checks/results/) |
| Flow | 91 OK | 14 (2) | 44 OK (rerun) | [validation.json](../examples/liquid-glass-flow/validation.json), [checks/results](../examples/liquid-glass-flow/checks/results/) |
| Blobs | 81 OK | 14 (1) | 42 OK | [validation.json](../examples/liquid-glass-blobs/validation.json), [checks/results](../examples/liquid-glass-blobs/checks/results/) |
| Prism | 84 OK | 12 (2) | 54 OK | [validation.json](../examples/liquid-glass-prism/validation.json), [checks/results](../examples/liquid-glass-prism/checks/results/) |
| Lit | 96 OK | 58 (4, plus 2 picking preprocess checks) | 36 OK | [validation.json](../examples/liquid-glass-lit/validation.json), [checks/results](../examples/liquid-glass-lit/checks/results/) |

Pending in TouchDesigner, for every study: compile, render, Render Pick, the
Render Pass TOP route (Blobs has none: depth sorting of its proxy box instead),
fog, Fit to Glass geometry, odd render sizes, export and performance. Each
study's `validation.json` lists its native checks as pending, with the steps to
run them. TouchDesigner run pending (status 2026-11-03).

## 0.4.0 package checks

Run on 3 November 2026 for version 0.4.0, then again after the fix round and
the gap-fix round that day. `package-validation.json` keeps the results under
`package_0_4_0`.

Passed:

- `claude plugin validate . --strict` and `claude plugin validate skills`
  (Claude Code 2.1.317). The root `plugin.json` also passes the Agent Plugins
  1.0.0 schema with its new `license`, `homepage` and `repository` fields.
- The three manifests carry version 0.4.0, and the OpenAI interface, review and
  publication text in `plugin.json` equals `.codex-plugin/plugin.json`. The two
  marketplace files have no version field. Both `license` fields give
  `CC-BY-NC-4.0 AND MIT`; [NOTICE.md](../NOTICE.md) lists the full terms.
- Each SKILL.md uses only spec frontmatter keys (`name`, `description`,
  `license`), and its name matches its folder. Its description names
  TouchDesigner in the first 60 characters, is within the spec limit of 1024
  characters and has no angle brackets. The longest SKILL.md has 119 lines.
  All four descriptions also meet this release's own 450-character target;
  the longest, shader-build's, has 446 characters.
- Every relative link and anchor resolves: 619 in the 45 files these checks
  cover, and 1728 across all 123 Markdown files outside the corpus.
- Each of the 32 reference files outside the corpus is linked directly from a
  SKILL.md.
- `corpus.py verify` and `demos.py verify`; the static study check and tutorial
  check on all thirteen examples.
- No stale audit version or old sibling-plugin name remains outside the
  corpus. The previous release number appears only where a record names that
  release on purpose.
- Every liquid-glass sentence added in 0.4.0 either says the examples are
  preview-only or links to a page that says so, and none claims a
  TouchDesigner result.

Open: none.

Fixed since the first run: the broken link in `live-audit-2026-10-20.md` and
the missing Contents list in `chat-web.md`. Fixed in the gap-fix round: the
research SKILL.md now links `chat-source-index.md` directly, and the
shader-build description went from 471 to 446 characters.

Navigation check: three fresh `claude -p` sessions, read-only, with the plugin
loaded from this folder. This is one observation, not a trigger rate.

- *Liquid glass for any SOP with separate refraction and reflection outputs*:
  used shader-build, then the glass notes, the family overview, the core README
  and shader, and the scene-integration notes. It called the examples
  preview-only.
- *Port a three.js dithering shader to a GLSL TOP*: used shader-build, read the
  research SKILL.md, the GLSL pitfalls and the bundled dither source. It did not
  open the source-format notes.
- *A TD Python script that renames operators*: used no plugin workflow, citing
  shader-build's scope line.

Both shader prompts also opened the web-chat delivery contract, which every
SKILL.md asks the agent to follow.

Since 1.0.0 the study ZIPs are no longer stored in the repository: the release
workflow builds them from `examples/` (`.github/package.sh`), so they always
match the tagged tree. The paragraphs below describe the ZIPs that were stored
in `downloads/` until then.

The ZIPs in `downloads/` were built before 0.4.0 (commits b0cfb6a and 4a530cd)
and are not rebuilt. They lack the 0.4.0 doc and comment edits; shader logic is
unchanged. A file-by-file comparison on 3 November 2026 found every shader,
Python, JSON and TSV file in the six ZIPs equal to the repository, except six
Flow files. Those differ only in comments, docstrings, path text, and one
snippet's line range and hash. The ZIPs also lack the
[Known gaps](../examples/LIQUID-GLASS.md#known-gaps) section and the notes on
the move to `examples/`.

In 0.6.0 (5 November 2026) each ZIP gained the repository's `LICENSE`,
`NOTICE.md` and `ATTRIBUTION.md` at its root. Their other entries are unchanged,
and `downloads/SHA256SUMS.txt` was regenerated and checked with
`sha256sum -c`.
