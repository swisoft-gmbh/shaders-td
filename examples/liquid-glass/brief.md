# Liquid Glass: brief

A universally applicable liquid-glass shader for 3D objects in TouchDesigner. The four reference images show the look, not the shape: clear glass with strong rainbow dispersion (1), a thick lavender gel with deep violet rims (2), a blue-violet magnifying drop over a logo (3) and highly reflective glass bending bold type behind it (4).

The material must work on any object and expose, at minimum: glass colour and reflection, translucency, opacity, and the overall glass style. Dithering is explicitly not wanted; the look must stay continuous. Twelve presets cover different liquid-glass ideas (tinted, frosted, several glass body colours), loadable from a menu and morphable A to B. Refraction and reflection each come from their own TOP; the reflection TOP can be a 360 panorama or a flat image. Thickness works in a single pass with a slider, with a strictly optional back-face pass.

Deliverables: the GLSL MAT vertex and pixel shaders, a Textport builder that creates a ready component with every control as a custom parameter, a usage guide, and a tutorial for TouchDesigner users new to GLSL.

Success criteria: the shaders compile as GLSL 4.60; a render of the same GLSL shows all twelve presets as distinct looks; property tests hold (invisible at IOR 1, invisible at opacity 0, measured thickness equals the true chord, morph endpoints); everything is committed. Native TouchDesigner compile, render and export are run by the user and remain pending until then.
