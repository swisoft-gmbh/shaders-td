# Reference files (commit 6a58487)

Copies of `liquid_prism.frag`, `liquid_prism.vert`, `backdrop.frag`, `env.frag` and `study.json` (for its uniform bindings) as they were at commit 6a58487, before the family sync. `core_backdrop.frag` is the core Liquid Glass study's `backdrop.frag` at the same commit: its checkerboard is the family's shared demo scene.

The preview compiles them as a second program (`reference: true` in a draw), so tests can check that the synced shader keeps the old image wherever a change must not alter it (an opaque Refraction TOP with ripples, film and frost off; Object size 1; fog off), and `preview_tests.cjs --reference` runs the whole suite against the old material to show which tests guard the sync.

`presets.json` is the preset file as it was at commit 6a58487, unchanged until the family close (the same at c94e849). The six prism looks were mapped to the family's reference size there (decisions.json, family close G1); the unit test `test_g1_prism_looks_keep_their_look_on_the_demo` checks the new values against these.

Do not edit them. They are test data, not part of the material.
