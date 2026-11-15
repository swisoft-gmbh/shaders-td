# Contour Loom: drawing a material from equal-height lines

![Native final output](captures/native-final.png)

Captured in TouchDesigner 2025.33230; see the stage receipts for settings.

The intended image is a dark field crossed by fine copper and blue threads.
Those threads trace a continuous surface, then take their color from a second,
diagonal signal. The result is a screen-space study of how one scalar field can
control structure while another controls its visual interpretation.

This original native study draws on Maxime Heckel's separation of sampling,
pattern and composition in [Post-Processing Shaders as a Creative Medium](https://blog.maximeheckel.com/posts/post-processing-as-a-creative-medium/)
and his incremental pattern experiments in [Shades of Halftone](https://blog.maximeheckel.com/posts/shades-of-halftone/).
The TouchDesigner network and code here are new adaptations.

Build with `runpy.run_path('/path/to/build.py')['build']()` inside TouchDesigner.
Keep the returned component in `component`. Its Study page exposes the controls.
The default image is 640 × 640; Pause fixes time to two seconds.

## What shape exists before the lines?

![Schematic of the native pass and its staged interpretation](figures/network.svg)

We need a scalar for each screen point. Two Gaussian hills provide a stable
large-scale shape; a lower-amplitude trigonometric fold introduces motion.
The exponent uses squared distance, so each hill fades smoothly without a hard
boundary. The second hill is narrower because its exponent coefficient is larger.
This choice gives the contour lines an asymmetric structure without sampling
noise or an external image.

From [shader.frag](shader.frag), lines 8–16:

```glsl
float field(vec2 p, float time) {
    vec2 a = p - vec2(-0.30, 0.13);
    vec2 b = p - vec2(0.32, -0.20);
    float hills = 0.68 * exp(-3.8 * dot(a, a))
                + 0.46 * exp(-7.0 * dot(b, b));
    float fold = sin(4.5 * p.x + 2.1 * p.y + 0.35 * time)
               * cos(3.0 * p.y - 0.22 * time);
    return hills + 0.23 * uControls.y * fold;
}
```

**Native experiment `field`:** Where do the contours come from?

On the built component, run `component.op('study_tools').module.apply(component, 'field')`.

Prediction: Two overlapping smooth hills and a bounded fold form one scalar field.

Parameters: Pause=True, Time=2, Stage=field, Warp=0.65, Bands=18, Width=0.075. Time and unrelated controls are fixed by this preset.

![Native field stage](captures/native-field.png)

Captured native stage; [capture conditions](captures/native-field.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters.

The field's brightness reveals its height. Increasing Warp should move the
level sets; it does not simply recolor them. Gaussian hills were chosen over a
full noise field because they make this relationship easier to predict. For a
new artwork, a signed distance field, image luma or audio-driven potential could
replace them, provided its range and derivatives are understood.

## How do equal values become threads?

The screen coordinates span roughly −1 to +1. Multiplying X by width/height
keeps the field's geometry consistent on a rectangular output.

From [shader.frag](shader.frag), lines 21–24:

```glsl
    vec2 uv = vUV.st;
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= uTDOutputInfo.res.z / uTDOutputInfo.res.w;
    float height = field(p, uClock.x);
```

Multiply the field by the contour count. The fractional part repeats once per
unit of phase. Measuring distance to its nearest integer gives a periodic line
mask, so a contour is a set of points with the same underlying field value.

From [shader.frag](shader.frag), lines 28–32:

```glsl
    float phase = height * max(uControls.x, 1.0);
    float distanceToLine = abs(fract(phase + 0.5) - 0.5);
    float aa = max(fwidth(phase), 0.0001);
    float line = 1.0 - smoothstep(uControls.z - aa,
                                 uControls.z + aa, distanceToLine);
```

**Native experiment `lines`:** How does a scalar become a line?

On the built component, run `component.op('study_tools').module.apply(component, 'lines')`.

Prediction: Periodic thresholding draws equal-height bands.

Parameters: Pause=True, Time=2, Stage=lines, Warp=0.65, Bands=18, Width=0.075. Time and unrelated controls are fixed by this preset.

![Native lines stage](captures/native-lines.png)

Captured native stage; [capture conditions](captures/native-lines.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters.

The `fwidth` of the unwrapped phase estimates how quickly it changes across a
pixel. It sets a transition width for antialiasing. Taking that derivative
before the fractional wrap avoids interpreting a periodic seam as a large
signal jump. The small floor prevents equal smoothing edges.

The line half-width is in phase units, not constant screen pixels. Threads can
therefore appear wider where the field changes slowly. This is a deliberate
level-set treatment; a constant-pixel stroke would require a different width
model and testing near zero gradients.

## What happens when the pattern becomes dense?

From [shader.frag](shader.frag), lines 28–32:

```glsl
    float phase = height * max(uControls.x, 1.0);
    float distanceToLine = abs(fract(phase + 0.5) - 0.5);
    float aa = max(fwidth(phase), 0.0001);
    float line = 1.0 - smoothstep(uControls.z - aa,
                                 uControls.z + aa, distanceToLine);
```

**Native experiment `dense`:** What does doubling the count change?

On the built component, run `component.op('study_tools').module.apply(component, 'dense')`.

Prediction: Contour frequency doubles without changing the underlying hills.

Parameters: Pause=True, Time=2, Stage=lines, Warp=0.65, Bands=36, Width=0.075. Time and unrelated controls are fixed by this preset.

![Native dense stage](captures/native-dense.png)

Captured native stage; [capture conditions](captures/native-dense.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters.

Compare this with the previous preset at the same time and Warp. Only Bands
changes from 18 to 36. The height field stays fixed while the number of selected
levels increases. At enough density, neighboring antialiasing transitions can
overlap and the pattern loses contrast. Antialiasing reduces unstable edges; it
cannot preserve arbitrary detail below the pixel scale.

A practical quality test compares the two counts at fixed resolution, then
increases resolution without changing the field. Do not infer performance from
how quickly a still image appears. Record the native build, pixel format and
timing method when measuring.

## How does a diagram become a material?

From [shader.frag](shader.frag), lines 36–45:

```glsl
    float weave = 0.5 + 0.5 * sin(10.0 * p.x - 7.0 * p.y + height * 5.0);
    vec3 paper = mix(vec3(0.018, 0.033, 0.055),
                     vec3(0.045, 0.095, 0.12), clamp(height, 0.0, 1.0));
    vec3 ink = mix(vec3(0.12, 0.54, 0.62), vec3(0.95, 0.57, 0.22), weave);
    vec3 color = mix(paper, ink, line);
    int stage = int(uControls.w + 0.5);
    if (stage == 1) color = vec3(clamp(height, 0.0, 1.0));
    if (stage == 2) color = vec3(line);
    if (stage == 3) color = vec3(uv, 0.0);
    fragColor = TDOutputSwizzle(vec4(color, 1.0));
```

**Native experiment `final`:** What does composition add?

On the built component, run `component.op('study_tools').module.apply(component, 'final')`.

Prediction: The same line mask reveals a woven warm/cool pigment field.

Parameters: Pause=True, Time=2, Stage=final, Warp=0.65, Bands=18, Width=0.075. Time and unrelated controls are fixed by this preset.

![Native final stage](captures/native-final.png)

Captured native stage; [capture conditions](captures/native-final.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters.

The same line mask now mixes a dark base with a blue-to-copper pigment signal.
The diagonal color oscillation is intentionally independent of contour
thresholding, which makes the image resemble intersecting threads without
pretending to simulate fibers or light transport.

This separation is useful for teaching and art direction: changing ink cannot
move a contour. The field and lines stages let us verify that claim directly.
The finished palette is an artistic choice; it is not a physically measured
metal response. Native output color also depends on the project's color
settings, which should accompany captures.

## Evidence and limits

See `validation.json` and any native capture receipts for what was actually
tested. Predictions above are experiment instructions, not fabricated
observations. The package includes source and a native builder; native exports
and captures are valid only when produced by TouchDesigner. User acceptance and
performance measurements are separate from shader compilation.
