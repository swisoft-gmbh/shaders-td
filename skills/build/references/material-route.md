# A material is a scene contract

A GLSL MAT requires geometry, attributes, transforms, camera and a Render TOP.
Copying a fragment shader into a MAT without this context is incomplete.

The contour-material example uses a sphere SOP inside a geometry component,
an unlit procedural GLSL MAT, a camera on +Z and a scoped Render TOP.
Its pattern uses **object-space position** so the lines move with the object.
It passes **world-space position** to the fragment stage for a derivative
surface normal. This is a deliberate flat-facet approximation that remains
consistent with transformed geometry; it is not a smooth interpolated normal.
The source's material teaching motivates coordinate isolation and debug views,
but this native implementation is newly authored.

If the desired result is smooth shaded, use appropriate native normal
attributes and normal transforms. If geometry is displaced, update its normals.
Nonuniform scale requires a correct inverse-transpose/deformation path.
Keep eye direction and lighting in the same space as normals. Decide whether
the key light stays with the world or with the camera, and offer the choice
when the camera moves. Heckel's deployed refraction demos
([/refraction](https://r3f.maximeheckel.com/refraction), read 3 November 2026,
and the painting6 bundle, line 489) use camera-space normals with a constant
light, so the highlight stays put on screen as you orbit (bundle URL and use
limits: [live sources](../../research/references/NOTICE.md#live-sources-not-included)).
The article's final scene
(`skills/research/references/corpus/blog/core/components/MDX/Widgets/RefractionDispersionReactThreeFiber/final.ts`,
lines 115 to 128) uses world-space normals and keeps the highlight with the
scene. In a GLSL MAT, a camera-locked direction is
`mat3(uTDMats[i].camInverse)` times the camera-space direction; or parent a
Light COMP to the Camera COMP.
Not yet run in TouchDesigner. Test rotating the geometry
separately from changing the camera.

The derivative normal example requires nondegenerate triangles and uses
`gl_FrontFacing` to orient the cross product. If a target host/backend reverses
the expected convention, verify with a known front-facing plane before
changing signs. The normal debug view is part of the tutorial.

A refraction material additionally needs a separately rendered background
texture, a sampler binding and a deliberate thickness/offset approximation.
Do not sample the same render target currently receiving the material.
Depth, multi-camera and instancing conventions require build-specific checks.
The Render Pass TOP route samples its input render while drawing onto its
own copy; whether TouchDesigner allows that is unverified, so keep the Over
TOP fallback. Read [glass notes](glass-refraction.md) and
[material integration](material-integration.md).
