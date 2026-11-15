# Reference files (commit 6a58487)

Test data for the family sync, not part of the material. Do not edit them.

- `liquid_flow.vert`, `liquid_flow.frag`, `study.json`, `presets.json`, `backdrop.frag`, `env.frag`: this study as it was at commit 6a58487, before the family sync. The preview draws them with `reference: true`, and `node checks/preview_tests.cjs <port> --reference` runs every preview test against them (the red run in `checks/results/red-run-6a58487.json`).
- `core_liquid_glass.frag`: the core study's pixel shader at commit 6a58487. `draw({ pixelStage: 'core6a58487' })` feeds it the delivered vertex shader and bindings, so `opaque_scene_matches_pre_sync` can check that the scene alpha, output cap, screen orientation, fog and Object size change nothing over an opaque scene.

`checks/core_reference/` is different: it holds the core study's current shaders, study.json and presets.json (the core working tree after its family-sync merge, on 6a58487), which this study's pixel stage must match exactly.
