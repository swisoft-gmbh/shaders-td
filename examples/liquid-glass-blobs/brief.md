# Liquid Glass Blobs: brief

One member of a family of liquid-glass shader studies for TouchDesigner 2025.x (GLSL 4.60, macOS Apple Silicon). The family's reference implementation and conventions are the core study, `studies/liquid-glass` at commit a6f95c6.

## What it should be

Liquid glass made of blobs that drift, merge and split, with optional small droplets that pinch off and rejoin (like the side drops in reference 3). The blobs are raymarched distance fields joined with a smooth minimum. They must drop into any TouchDesigner 3D scene, with any camera, and sort correctly in depth against ordinary geometry. The look follows the core: refraction with a real path through the glass, dispersion, absorption, fresnel, reflections, rim and thin film. The four reference images set the look, not the shape:

1. clear glass with dense rainbow dispersion,
2. a pale lavender gel with deep violet rims, see-through,
3. a blue-violet magnifying blob with droplets,
4. reflective glass bending bold type, with colour fringes.

## Fixed requirements (from the user's family brief)

- Universality first: works on any scene and camera with the least wiring.
- Adjustable glass colour and reflection, translucency, opacity and overall style.
- No dithering: every transition is continuous.
- Presets: 12 styles; a menu loads editable values, plus an A/B morph. (This line left out the count until verifier finding V1; the study shipped 8 presets until then.)
- Separate Refraction TOP and Reflection TOP inputs.
- Tutorial for TouchDesigner users new to GLSL.

## Success criteria

- The shaders compile as GLSL 4.60 (and Vulkan SPIR-V) against TouchDesigner stand-ins, and a deliberately broken copy fails.
- A WebGL2 render of the same files shows every preset as a distinct, convincing look.
- Property tests hold: a single-sphere field normal matches the analytic normal; the measured path matches the exact chord; the written depth matches a rasterized sphere's depth; IOR 1 makes the blobs invisible; the smooth minimum stays finite with no holes. Added after the independent review: blobs too big for the box show no holes; where the glass samples the Refraction TOP matches an exact lens trace; the tint follows the measured path.
- The plugin's static checker, the tutorial checker and `checks/run_all.sh` pass.
- Native TouchDesigner compile, render, export and performance remain pending until a user runs them, and every record says so.
