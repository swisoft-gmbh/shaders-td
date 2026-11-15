# Liquid Glass Flow: brief

Liquid Glass Flow is one member of a family of liquid-glass studies for TouchDesigner. The family brief is the user's: a universal liquid glass for 3D objects in TouchDesigner 2025.x (GLSL 4.60, macOS Apple Silicon), with adjustable glass colour and reflection, translucency, opacity and overall glass style; continuous looks only (no dithering); presets that load editable values plus an A/B morph; separate Refraction TOP and Reflection TOP inputs; a tutorial for TouchDesigner users new to GLSL. The user ranked universality first (any object, scene and camera with the least wiring), then the match to four reference images (look, not shape).

This member's direction: make the silhouette itself move like liquid. A GLSL MAT moves every vertex of any mesh with an animated liquid field (swell, ripples, travelling waves, gravity sag and drips) and rebuilds the normals of the moved surface, so refraction, fresnel and highlights follow the new shape. The pixel stage is the core Liquid Glass look (studies/liquid-glass; first commit a6f95c6, since the family sync of 2026-11-02 the core working tree after its family-sync merge on 6a58487); its controls and twelve presets keep working.

Universality requirements: arbitrary SOP meshes; a graceful fallback without normals; no cracks along hard edges or UV seams in a crack-free mode, with the trade-off explained; tessellation needs documented; non-uniform scale and instancing through TDDeform and TDDeformNorm.

Success criteria (observable):

- With Amplitude 0 the material renders exactly like the current core Liquid Glass (pixel-identical in the WebGL preview).
- Rebuilt normals match finite-difference normals of a displaced sphere within a stated tolerance.
- The rendered silhouette (alpha coverage) changes with Amplitude.
- On a mesh whose vertices share positions but not normals, crack-free mode keeps them together and the render has no holes.
- Every preset is distinct and moves in its own way in the WebGL preview; images are labelled as previews.
- The plugin's static checker, the tutorial checker and `checks/run_all.sh` pass.

Native TouchDesigner compile, render, builder run, export and performance are run by the user and stay pending until then.
