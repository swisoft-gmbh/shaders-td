# Liquid Glass Lit: brief

One member of a family of liquid-glass shader studies for TouchDesigner 2025.x (GLSL 4.60, macOS Apple Silicon). The family brief, from the user: universal liquid glass for any 3D object; adjustable glass colour and reflection, translucency, opacity and overall glass style; no dithering, continuous output only; presets that load editable values, plus an A/B morph; separate Refraction and Reflection TOPs where the route uses them; a tutorial for TouchDesigner users new to GLSL. Judging priority: universality first (any object, scene and camera with the least wiring), then the look of the four reference images (clear rainbow dispersion; lavender gel with violet rims; blue-violet magnifying blob; reflective glass bending bold type).

This member takes its light from the scene. It drops into an existing lit scene with no Reflection TOP to wire. Light COMPs reach it through TouchDesigner's lighting helpers (point, cone, distant, attenuation, optional shadows) for highlights and body light. The Environment Light COMP gives reflections and ambient light, with roughness turned into a mipmap level and the light's own rotation applied. The Refraction TOP still gives the view through the glass. With zero lights or zero environment lights it falls back to a built-in key light and studio.

## Success criteria

- The material compiles for TD_NUM_LIGHTS = 0, 1, 3 and TD_NUM_ENV_LIGHTS = 0, 1 against stand-ins built from Derivative's documented structs and signatures, and a broken copy fails.
- Property tests on the same GLSL (WebGL2 preview with stand-in light functions): no lights equals the built-in fallback; adding a light only adds energy where N·L > 0; environment roughness blurs monotonically; IOR 1 is invisible with the light terms off.
- Twelve presets render as distinct looks; four of them aim at the reference images.
- A builder creates a component with strict core nodes and lenient demo nodes, and a demo scene with Light COMPs and an Environment Light fed by an environment-map TOP.
- A tutorial where each section has a reader question, a small model, a real code excerpt, an experiment and a labelled preview observation.
- Native TouchDesigner compile, render, export and performance are run by the user and stay pending until then.
