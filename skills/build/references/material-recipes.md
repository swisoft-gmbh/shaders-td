# Material recipes: displacement, raymarched proxies and data passes

Read when: a GLSL MAT moves vertices, raymarches a distance field that must
sort with a scene, or needs per-pixel data from a second render.

Evidence: rules marked Docs follow Derivative pages checked 3 November 2026.
The others come from the preview-only liquid-glass examples
([status](../../review/references/host-free-checks.md#status-of-the-liquid-glass-evidence)).

## Contents

- [Displace any mesh without cracks](#displace-any-mesh-without-cracks)
- [Raymarch inside a proxy box that writes depth](#raymarch-inside-a-proxy-box-that-writes-depth)
- [Render a data pass](#render-a-data-pass)

## Displace any mesh without cracks

Make the displacement amount and direction depend only on position (an
object-space field, pointing away from a centre), because then every copy of
a split vertex moves the same way. Split vertices sit on hard edges and UV
seams, so any mesh has them.

- Displacing along the vertex normal tears meshes with split normals: a
  0.24-unit gap and 702 hole pixels (Preview).
- Rebuild normals by central differences: move two tangent neighbours and
  cross the two steps. Do it before `TDDeform()` and `TDDeformNorm()`, so
  object, non-uniform-scale and instance transforms still apply. On the demo
  torus with Aqua Jelly's motion, rebuilt normals stayed within 0.02 degrees,
  against up to 9 degrees for shortcut normals (Preview,
  `normal_mode_error_is_bounded`). In ten cases on the displaced sphere they
  stayed within the test bound of 0.5 degrees of a float64 reference, and
  within 1 degree where the field squeezes the surface (Preview,
  `normals_match_finite_differences`).
- Mesh density: about 8 vertices across the smallest bulge or ripple. For
  Flow's ripples, a radius-1 sphere needs about 100 rows and 200 columns.
- Smooth the centre-direction fallback with `smoothstep(0.0, 0.05, length(q))`,
  so points near the centre do not snap.
- Shadow, depth and pick passes drawn with other materials see the rest shape.
- World-space effects such as gravity need `inverse(TDInstanceMat3())` on
  instances.
- A Box SOP with Use Divisions outputs open polygons that do not render (Docs:
  [Box SOP](https://docs.derivative.ca/Box_SOP)). Build a divided box from
  Grid, Transform and Merge SOPs instead.

For the analytic single-heightfield case, see the
[extension notes](../../research/references/native-extended-mechanisms.md).
Example: `flowOffset()` and `flowNormal()` in
[liquid_flow.vert](../../../examples/liquid-glass-flow/liquid_flow.vert)
(preview test `crack_free_keeps_coincident_vertices_together`).

## Raymarch inside a proxy box that writes depth

Raymarching means stepping along each view ray through a distance field until
it hits a surface. Do it inside an ordinary box mesh, because the box then
moves, scales, instances and sorts in depth like any object.

1. Render the box's back faces (Cull Face = Front Faces): one fragment per
   pixel, and it still works with the camera inside the box.
2. Start each ray at the near plane: `camProjInverse * vec4(ndc, 0.0, 1.0)`.
   This handles orthographic and blended projections. Before this fix,
   231,876 pixels were written at depth 0 (Preview).
3. March in the box's object space.
4. Write `gl_FragDepth = (proj * P).z / (proj * P).w`; `uTDMats[].proj` maps
   Z to 0..1, Vulkan style (Docs).
5. Intersect the field with the box: `max(field, sdBox(p))`. Without it,
   blobs larger than the box lost 40,348 to 98,575 pixels to holes (Preview).

Limits:

- `TDWorldToProj()` is vertex-only and applies fisheye, Quad Reproject and the
  pick adjustment (Docs). A pixel stage that projects its own depth therefore
  cannot support fisheye or Quad Reproject.
- Writing `gl_FragDepth` disables early depth rejection.
- MSAA (multisample antialiasing) cannot smooth a raymarched edge, so smooth
  it analytically.
- Order Independent Transparency and depth peeling are unsupported.

Derivative's own advice for raymarching MATs is a sphere around the camera
that covers the viewport ([Write a GLSL MAT](https://docs.derivative.ca/Write_a_GLSL_MAT));
the box that hugs the content is the alternative. Evidence: Preview, depth
within 0.0005 units of a raster sphere. Example: `blobField()`, `sdBox()`,
`rayPoint()` and the `gl_FragDepth` write in
[blobs.frag](../../../examples/liquid-glass-blobs/blobs.frag).

## Render a data pass

For per-pixel data from a second render (thickness, far-side normal,
distance), set up two things:

- A second GLSL MAT with the same shader and a pass switch: Cull Face = Front
  Faces, Blending off.
- Its own Render TOP at the main render's aspect ratio: Pixel Format 32-bit
  float RGBA, background alpha 0, Pre-Multiply RGB by Alpha off.

Then:

- Read it with `texelFetch()` and a hand-written bilinear filter over covered
  texels only. Hardware linear filtering blends the empty background into the
  edges (a dark fringe of 95/255); Nearest leaves steps.
- Store distance along the view ray for perspective cameras, and view depth
  for orthographic ones.
- Use a sentinel (a marker value) that no background can produce. Prism
  stores minus the distance; whether negative alpha survives a float Render
  TOP is unverified.
- Fall back to an analytic estimate where the pass has no data.

Evidence: Preview, chord within 0.5/255 at 50 units (test bound 2/255,
`backface_thickness_matches_chord_far`). Example: `backfaceAt()` and
`glassThickness()` in
[liquid_glass.frag](../../../examples/liquid-glass/liquid_glass.frag);
"Optional: back-face pass" in the
[core README](../../../examples/liquid-glass/README.md).
