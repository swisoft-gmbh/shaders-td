# What the archive establishes

The archive, collected from public sources, is the ground truth for Heckel's
published explanations and implementations. Its 60-article catalog and 51
repository records were inspected alongside the full text index. A search for
`TouchDesigner` returned the authored `shading-motion.mdx` and two captures of
that article; the spaced form `Touch Designer` returned no indexed matches. No
`.toe` or `.tox` paths were found in the downloaded payloads. The audit record is `maintainer/native-archive-audit.json` in the plugin repository.

`corpus/articles/shading-motion.mdx` lines 17, 302 and 1019 explicitly frame the
work as reproducing effects seen in TouchDesigner **on the web**. Its code uses
WebGPU/TSL/WGSL, React Three Fiber and related browser infrastructure. The live
[article](https://blog.maximeheckel.com/posts/shading-motion/) and blog index were
checked on 20 October 2026 and corroborated this scope. This is a bounded audit,
not a claim that the author has never used or taught TouchDesigner elsewhere.

The plugin therefore has three clearly labeled layers:

1. **Preserved evidence:** unchanged articles, code, widgets, notices and
   historical references from the archive, collected from public sources. The
   deployed demo bundles are linked by live URL, not bundled.
2. **Documented practice:** a synthesis of visible technical and teaching
   patterns, supported by article sections and demos.
3. **Native implementation:** newly authored TouchDesigner recipes and guides
   using official Derivative documentation and observed host behavior.

The third layer must not be attributed to Heckel as his own native workflow.
The toolkit can reproduce documented methods and standards; it cannot reproduce
private thoughts, establish identical decisions, or act as a fine-tuned model.

## Archive priorities

| Archive area | Use |
|---|---|
| Assembled source archive | Authored MDX, widget source, virtual scene files, dependencies and licenses. Primary technical/teaching evidence. |
| Page captures and recovery | Corroborate deployed presentation and fill explicit gaps. Preserve revision distinctions. |
| Media and dependencies | Source images, diagrams and resources. Verify bytes and license before bundling. |
| Offline replay | Supporting reproduction context; not proof that all demos work. |
| Indexes, checkpoints and audits | Provenance, inventory and recovery limitations. |
| Retired payloads | Excluded from the active library. |
| Space exports | Navigation/history, not primary shader authority. |

The reusable reference subset inherits 381 preserved text records, 17 core
graphics articles, 10 context articles, decoded mappings for 141 web scenes,
342 decoded payloads and selected recovered figures from the audited web
sibling. Retrieval preserves paths, hashes, line ranges and original URLs.
The full media archive is not installed.

## Source conflicts

Read [source formats](source-formats.md) before porting. Particular pitfalls:
MDX `glsl` fences sometimes contain WGSL; a TS scene wrapper contains virtual
files rather than an executable standalone app; a teaching widget may simplify
the production scene. Source-preserving does not mean bug-preserving.

In addition to the inherited cautions, the painterly article's prose
quantization formula has ambiguous grouping while its GLSL uses
`floor(x * (n - 1) + 0.5) / (n - 1)` (lines 841–861). Use the explicit shader
expression for a new implementation and document the difference.

The motion article's neighbor-difference direction is a creative heuristic,
not a calibrated velocity solver. Its normalized direction discards speed.
Do not label its output pixels/second or substitute it for a native Optical Flow
TOP without inspecting that operator's current output convention.
