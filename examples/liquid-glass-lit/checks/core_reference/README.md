# Core reference (Liquid Glass, family close)

Copies of the core study's `liquid_glass.frag`, `liquid_glass.vert`, `native.py` and `study.json` (2026-11-02, based on commit c94e849; sha256 in [sources.json](../../sources.json)). The shaders and `native.py` are as the core's family close left them. `study.json` was refreshed after the core's family close critic fix PV4, which changed two labels only. Liquid Glass Flow pins the same two shader files and the same `study.json`.

The unit tests compare what this study shares with the core against these copies:

- the vertex shader, code for code (comments aside);
- `screenSign()`, which differs only in the Flip V slot (`uState.z` here, `uState.w` in the core), and the derivatives at the top of `main()`;
- `worldScale()`, the ripple and film lookups, the uniform expressions of the Object size rule, and `fit_glass()`, run on the core's demo torus;
- the Thickness and Object size labels, word for word (`test_pv4_labels_say_what_object_size_does`);
- all four files, byte for byte, against the sha256 in sources.json (`test_core_reference_is_the_current_core`).

When the core study sits next to this folder (`../liquid-glass`), the same tests also compare against it, and the four files must equal its current files, so a change on either side fails until both agree again. Moved on its own, this study still checks against these copies.

Do not edit them by hand. To refresh them, copy the four files from the core and record their new sha256 in sources.json. They are test data, not part of the material.
