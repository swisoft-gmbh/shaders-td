# Native mechanisms exercised by the five-study suite

These are tested toolkit adaptations and engineering decisions, not native
procedures authored by Heckel. The [sample index](../../../examples/FIVE-MECHANISMS.md)
links the code, derivations and evidence. Read the archive sources alongside them.

## Distance surfaces

A loop ending is not proof of a surface hit. Keep an explicit hit result,
travel bound, iteration bound and epsilon. Rigid transforms preserve primitive
distance; arbitrary displacement may not. A conservative multiplier is useful
but is not a mathematical license to trace any scalar field as a distance.
Compare a simple fixture against analytic intersections before judging a complex
composition. Check aspect from actual output dimensions.

## Volumetric integration

Keep view transmission and light-path visibility separate. With segment length
ds, extinction sigma and density rho, segment transmission is
`exp(-sigma * rho * ds)`. Add `T * (1 - segmentT) * source` before updating T.
A light march modifies the source term; it does not replace T. Test a homogeneous
slab at several step counts and zero extinction. Convergence of view sampling
does not establish convergence of a separate fixed light march.

## Local image statistics

A radius expressed in source texels should use the source's dimensions. State
edge-extension behavior and avoid silently inheriting a sampler convention.
Clamp tiny negative roundoff in `E[c²] - E[c]²`. A weighted sum of RGB channel
variances is not variance of weighted luminance. A radius-zero identity,
constant image and isolated edge are useful invariants before evaluating a
complicated photograph. A basic quadrant filter is not an anisotropic filter.

## Vertex displacement and normals

For `F(x,y,z) = (x, y + g(x,z), z)`, inverse-transpose Jacobian correction gives
`(nx - gx*ny, ny, nz - gz*ny)`. This formula is specific to that map. Apply the
native normal transform afterward, keeping lighting vectors in a common space.
Use [TDDeformNorm](https://docs.derivative.ca/Write_a_GLSL_MAT) for normal transforms;
position/vector helpers have a different contract. The live material was tested
under rotation and nonuniform scale. Finite-difference tangent comparison checks
the equation separately. An exact zero-amplitude branch avoids unnecessary
normalization drift in the baseline.

## State transport

The new Tidal Ink study stores two pigments and advects them through a prescribed
periodic field. It does not evolve velocity or solve pressure. A backward
midpoint lookup and explicitly wrapped bilinear interpolation keep the spatial
contract visible. The zero-speed branch uses the prior texel directly. This
prevents repeated coordinate/interpolation roundoff from changing a stationary
image.

A fixed delta means simulated seconds per cook. It does not imply wall-clock
frame-rate independence. Flat-field decay at 30/60 steps tests time-unit decay;
transported textures can still differ because interpolation is diffusive.
Measure approximate mass retention rather than claiming exact conservation.
Keep initialization, empty input, reset, hold, source saturation and output demand
as separate checks. A hidden feedback branch does not necessarily cook.

The supplemental [GPU Gems advection chapter](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)
provides background on texture-based backward transport. The delivered study's
prescribed field, boundaries and test conditions are stated in its own code and
tutorial. The complete external chapter is not bundled.
