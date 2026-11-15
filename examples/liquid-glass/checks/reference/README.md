# Reference shaders (commit 6a58487)

Copies of `liquid_glass.frag`, `liquid_glass.vert`, `backdrop.frag` and `study.json` (for its uniform bindings) as they were at commit 6a58487, before the family sync. The preview compiles them as a second program (`reference: true` in a draw) so tests can check that the synced shader keeps the old image wherever a change must not alter it (an opaque Refraction TOP, Object size 1, fog off, the checker backdrop).

Do not edit them. They are test data, not part of the material.
