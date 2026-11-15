# Liquid Glass Prism: brief

The physically richer member of the Liquid Glass family for TouchDesigner 2025.x (GLSL 4.60, macOS Apple Silicon). Family brief, from the user: universal liquid glass for 3D objects; adjustable glass colour and reflection, translucency, opacity and overall glass style; no dithering (continuous only); presets loaded from a menu as editable values, plus an A/B morph; separate Refraction TOP and Reflection TOP inputs; a tutorial for TouchDesigner users new to GLSL. Judging priority: universality first (any object, scene and camera with the least wiring), then the look of the four reference images (not their shapes).

This member targets references 1 (clear glass, dense rainbow) and 4 (reflective glass bending bold type, colour fringes):

- Refraction at both surfaces, entry and exit, with an optional back-face pass that stores the far side's normal and distance.
- Total internal reflection with an approximated internal bounce: bright trapped-light bands and rims.
- Dispersion per wavelength through both surfaces: a stronger, correctly ordered rainbow.
- Optional inner glow imitating focused light.
- All continuous.
- A drop-in GLSL MAT like the core. Without the back-face pass, an analytic estimate of the far side that never breaks.
- The core's look controls and presets stay compatible; prism-specific presets are added.

## Success criteria

- Shaders compile as GLSL 4.60 (stand-ins), with a negative test.
- Property tests in a WebGL preview of the same files: IOR 1 invisible through both surfaces; a parallel-sided slab gives zero net angular deviation; total internal reflection beyond the critical angle and not below; violet deviates more than red; finite output without the back-face pass.
- Twelve distinct presets, previewed and inspected against the references.
- `check_study.py`, `article.py check` and `checks/run_all.sh` pass.
- Native TouchDesigner compile, render, export and performance remain pending until run on a real host.
