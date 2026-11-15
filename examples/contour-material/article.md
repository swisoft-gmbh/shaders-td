# Contour Material: deciding which space owns a pattern

![Native final output](captures/native-final.png)

Captured in TouchDesigner 2025.33230; see the stage receipts for settings.

A sphere carries thin warm contour bands over a blue-green surface. Rotating
the object moves its pattern, while a fixed world-space light continues to
illuminate the geometry from one direction. The study makes coordinate-space
choices visible rather than hiding them inside a finished material.

It follows the decomposition of vertex and fragment work in Maxime Heckel's
[The Study of Shaders](https://blog.maximeheckel.com/posts/the-study-of-shaders-with-react-three-fiber/)
and the explicit light/vector concerns of
[Refraction, dispersion, and other shader light effects](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/).
It does not reproduce that article's glass effect. The native MAT, scene and
contour composition are new toolkit work.

Build with `runpy.run_path('/path/to/build.py')['build']()` inside TouchDesigner.
The resulting component includes geometry/sphere, material, camera, render and
out. The material is deliberately self-lit in its fragment shader; no external
Light COMP is needed.

## Where should the pattern live?

![Schematic of geometry, material, camera and the Render TOP](figures/network.svg)

The vertex stage passes object-space position and transformed world-space
position separately. It delegates native deformation and projection to
TouchDesigner's helpers. These are native host operations, not substitutes
copied from a Three.js uniform list.

From [vertex.vert](vertex.vert), lines 4–9:

```glsl
void main() {
    objectPosition = TDPos();
    vec4 world = TDDeform(objectPosition);
    worldPosition = world.xyz;
    gl_Position = TDWorldToProj(world);
}
```

**Native experiment `field`:** What space owns the pattern?

On the built component, run `component.op('study_tools').module.apply(component, 'field')`.

Prediction: The scalar field is attached to the object.

Parameters: Pause=True, Time=2, Stage=field, Turn=25, Stretch=1. Time and unrelated controls are fixed by this preset.

![Native field stage](captures/native-field.png)

Captured native stage; [capture conditions](captures/native-field.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters.

Object space is convenient for a pattern that belongs to an object. Moving the
camera changes its projection, but does not rewrite the field. World-space
position will serve a different purpose: determining the actual orientation
of the rendered surface. Combining these two roles into an ambiguously named
position vector would make later lighting errors difficult to explain.

## How do we draw contours over a surface?

From [pixel.frag](pixel.frag), lines 8–14:

```glsl
    vec3 p = objectPosition;
    float field = p.y + uControls.y * 0.25
                * sin(5.0 * p.x + uClock.x * 0.3) * cos(4.0 * p.z);
    float phase = field * max(uControls.x, 1.0);
    float d = abs(fract(phase + 0.5) - 0.5);
    float aa = max(fwidth(phase), 0.0001);
    float line = 1.0 - smoothstep(uControls.z - aa, uControls.z + aa, d);
```

**Native experiment `field`:** What space owns the pattern?

On the built component, run `component.op('study_tools').module.apply(component, 'field')`.

Prediction: The scalar field is attached to the object.

Parameters: Pause=True, Time=2, Stage=field, Turn=25, Stretch=1. Time and unrelated controls are fixed by this preset.

![Native field stage](captures/native-field.png)

Captured native stage; [capture conditions](captures/native-field.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters.

The field begins with object-space Y and adds a bounded fold in X and Z. Its
equal-valued surfaces intersect the sphere to create curved bands. As in the
image example, a periodic distance and derivative-width transition produce
the line mask. The surface geometry itself is unchanged.

This is a useful distinction when evaluating originality and cost: we changed
the representation attached to the surface, not the mesh topology. True raised
engraving would need displacement or a separately stated normal perturbation,
with corresponding geometry and shading validation.

## Which normal matches the light?

From [pixel.frag](pixel.frag), lines 17–20:

```glsl
    vec3 crossNormal = cross(dFdx(worldPosition), dFdy(worldPosition));
    vec3 normal = crossNormal / max(length(crossNormal), 0.00001);
    normal *= gl_FrontFacing ? 1.0 : -1.0;
    float diffuse = 0.25 + 0.75 * max(dot(normal, normalize(vec3(-0.4, 0.7, 0.6))), 0.0);
```

**Native experiment `normal`:** What space owns the light?

On the built component, run `component.op('study_tools').module.apply(component, 'normal')`.

Prediction: World-space normals vary across transformed facets.

Parameters: Pause=True, Time=2, Stage=normal, Turn=25, Stretch=1. Time and unrelated controls are fixed by this preset.

![Native normal stage](captures/native-normal.png)

Captured native stage; [capture conditions](captures/native-normal.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters.

The cross product of screen derivatives of world position yields a geometric
surface normal. Dividing by its length, with a small denominator floor, makes
the dot product with a normalized world-space light direction meaningful.
Front/back orientation is explicit.

This normal describes the rendered facets, not an interpolated smooth normal.
It was chosen to keep the experiment tied to the transformed surface and to
make the tradeoff visible. A smooth material should instead use appropriate
normal attributes and native normal deformation. A displaced surface would
also require updated normals; a visually plausible highlight is not proof that
the transformation is correct.

## What happens when we stretch the object?

From [pixel.frag](pixel.frag), lines 17–20:

```glsl
    vec3 crossNormal = cross(dFdx(worldPosition), dFdy(worldPosition));
    vec3 normal = crossNormal / max(length(crossNormal), 0.00001);
    normal *= gl_FrontFacing ? 1.0 : -1.0;
    float diffuse = 0.25 + 0.75 * max(dot(normal, normalize(vec3(-0.4, 0.7, 0.6))), 0.0);
```

**Native experiment `stretch`:** What changes under nonuniform scale?

On the built component, run `component.op('study_tools').module.apply(component, 'stretch')`.

Prediction: Derivative normals follow the actual transformed surface.

Parameters: Pause=True, Time=2, Stage=normal, Turn=25, Stretch=1.4. Time and unrelated controls are fixed by this preset.

![Native stretch stage](captures/native-stretch.png)

Captured native stage; [capture conditions](captures/native-stretch.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters.

Change only X scale from 1 to 1.4, leaving camera, time and rotation fixed.
Because the derivative normal is constructed from world-space positions after
transformation, it follows the stretched surface. Compare this with the
unscaled normal preset.

This experiment exposes a common adaptation risk: transforming a normal as an
ordinary position or direction under nonuniform scale is generally wrong.
If replacing this faceted method with attribute normals, use the correct
normal transform and repeat the test. Do not copy a historical shortcut solely
because it appeared in a visually successful browser demo.

## What does the final composition add?

From [pixel.frag](pixel.frag), lines 23–30:

```glsl
    vec3 clay = mix(vec3(0.055, 0.13, 0.16), vec3(0.20, 0.43, 0.46),
                    clamp(field * 0.5 + 0.5, 0.0, 1.0));
    vec3 color = mix(clay, vec3(0.95, 0.63, 0.27), line) * diffuse;
    int stage = int(uControls.w + 0.5);
    if (stage == 1) color = vec3(fract(field * 0.5 + 0.5));
    if (stage == 2) color = normal * 0.5 + 0.5;
    if (stage == 3) color = vec3(line);
    fragColor = TDOutputSwizzle(vec4(color, 1.0));
```

**Native experiment `final`:** How do surface and light combine?

On the built component, run `component.op('study_tools').module.apply(component, 'final')`.

Prediction: Object-attached contours are lit in world space.

Parameters: Pause=True, Time=2, Stage=final, Turn=25, Stretch=1. Time and unrelated controls are fixed by this preset.

![Native final stage](captures/native-final.png)

Captured native stage; [capture conditions](captures/native-final.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters.

A dark clay-like base and warm bands are multiplied by a simple diffuse term
with a small ambient floor. This is a stylized lighting model, not a calibrated
BRDF or a claim of physical clay properties. The debug stages separate
field, normals and line mask, making each contribution inspectable.

The Render TOP references only this study's geometry and camera. That scoped
selection matters when the component is loaded into a larger project: unrelated
objects should not silently enter the render.

## Evidence and limits

Native compile reports, captures, control checks and export/reopen results
belong in `validation.json` and their receipts. A successful material compile
must be followed by a scene render; a MAT preview alone is insufficient.
The intended faceting, artistic color and simple diffuse light are documented
choices. Multi-camera rendering, instancing, displacement and other builds
require additional native tests.
