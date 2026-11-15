# Phosphor Memory: giving image change a material

![Native final output](captures/native-final.png)

Captured in TouchDesigner 2025.33230; see the stage receipts for settings.

Imagine a moving light leaving an engraved afterimage: fresh changes look cool,
while older motion settles into warm diagonal hatching. The shader uses a
measured change signal and a stored trail, then gives them separate visual roles.
It is an artistic persistence effect, not a model of a physical phosphor.

The foundation comes from Maxime Heckel's [Shading Motion](https://blog.maximeheckel.com/posts/shading-motion/):
compare frames, retain useful history and style the resulting signal in another
stage. That article implements these ideas with WebGPU. Here the native
adaptation uses GLSL TOPs and a Feedback TOP, with a time-unit decay rule and an
explicit initialization channel.

Build with `runpy.run_path('/path/to/build.py')['build']()` in TouchDesigner.
The returned `component` contains source, seed, history, state, display and out.
The Study page provides threshold, lifetime, pitch, stage, Pause and Reset.

## What do we mean by motion?

![Network schematic with an explicitly previous-frame feedback edge](figures/network.svg)

A moving Gaussian disc and thin ring make a deterministic input. This removes
camera permissions, file dependencies and exposure changes from the first test.

From [source.frag](source.frag), lines 4–13:

```glsl
void main() {
    vec2 p = (vUV.st - 0.5) * 2.0;
    p.x *= uTDOutputInfo.res.z / uTDOutputInfo.res.w;
    vec2 center = vec2(0.43 * cos(uClock.x * 0.8),
                       0.31 * sin(uClock.x * 1.1));
    float orb = exp(-65.0 * dot(p - center, p - center));
    float ring = exp(-600.0 * pow(length(p + center * 0.5) - 0.27, 2.0));
    vec3 color = vec3(clamp(orb + 0.65 * ring, 0.0, 1.0));
    fragColor = TDOutputSwizzle(vec4(color, 1.0));
}
```

**Native experiment `source`:** What changes between frames?

On the built component, run `component.op('study_tools').module.apply(component, 'source')`.

Prediction: An orbiting disc and ring provide controlled brightness changes.

Parameters: Pause=False, Stage=source, Reset=False, Threshold=0.018, Lifetime=0.65, Pitch=9. Reset history before observing.

![Native source stage](captures/native-source.png)

Captured native stage; [capture conditions](captures/native-source.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters. This capture freezes a controlled input sequence; the live preset starts a new sequence. It is not an isolated matched-time comparison of different lifetimes.

We will compare brightness at the same pixel in two frames. A moving edge
usually changes that value. A uniformly colored region can move without a
visible change inside it; an exposure jump can change every pixel without any
object moving. Frame difference therefore measures image change. It provides
neither a reliable direction nor a speed.

## Why must the first frame be special?

The history stores four data channels: current luma, accumulated trail, raw
motion mask and an initialized flag. The all-zero seed has alpha zero. On the
first valid input, the shader stores luma and marks the state initialized,
while leaving both masks empty. Otherwise the first scene would be compared
with black and could flash as false motion.

From [state.frag](state.frag), lines 9–17:

```glsl
    float luminance = dot(current, vec3(0.2126, 0.7152, 0.0722));
    if (old.a < 0.5) {
        fragColor = TDOutputSwizzle(vec4(luminance, 0.0, 0.0, 1.0));
        return;
    }
    if (uClock.z > 0.5) {
        fragColor = TDOutputSwizzle(old);
        return;
    }
```

From [state.frag](state.frag), lines 20–22:

```glsl
    float difference = abs(luminance - old.r);
    float threshold = max(uControls.x, 0.001);
    float motion = smoothstep(threshold, threshold * 3.0, difference);
```

**Native experiment `motion`:** Does change mean velocity?

On the built component, run `component.op('study_tools').module.apply(component, 'motion')`.

Prediction: Only brightness changes appear; direction is not encoded.

Parameters: Pause=False, Stage=motion, Reset=False, Threshold=0.018, Lifetime=0.65, Pitch=9. Reset history before observing.

![Native motion stage](captures/native-motion.png)

Captured native stage; [capture conditions](captures/native-motion.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters. This capture freezes a controlled input sequence; the live preset starts a new sequence. It is not an isolated matched-time comparison of different lifetimes.

The luminance weights assume the intended linear input interpretation; they
are a stated adaptation from the source article's example weights. The supplied
test input is grayscale, so this distinction does not affect the initial test.
For external media, inspect actual input/working spaces first.

The threshold maps small differences to zero and larger differences smoothly
to one. It must remain positive so the smoothing interval has ordered, distinct
edges. Raising it rejects more noise but also misses subtle motion.

## How can an image remember?

From [state.frag](state.frag), lines 25–28:

```glsl
    float dt = clamp(uClock.y, 0.0, 0.1);
    float lifetime = max(uControls.y, 0.02);
    float trail = max(motion, old.g * exp(-dt / lifetime));
    fragColor = TDOutputSwizzle(vec4(luminance, trail, motion, 1.0));
```

**Native experiment `trail`:** How does history bridge frames?

On the built component, run `component.op('study_tools').module.apply(component, 'trail')`.

Prediction: Trail survives local motion and decays at the declared simulation step.

Parameters: Pause=False, Stage=trail, Reset=False, Threshold=0.018, Lifetime=0.65, Pitch=9. Reset history before observing.

![Native trail stage](captures/native-trail.png)

Captured native stage; [capture conditions](captures/native-trail.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters. This capture freezes a controlled input sequence; the live preset starts a new sequence. It is not an isolated matched-time comparison of different lifetimes.

The previous trail is multiplied by `exp(-dt / lifetime)`. With no fresh motion,
after one lifetime it retains about 36.8% of its initial value. We then keep
the larger of the new motion and the decayed trail. The rule stays bounded
when the inputs lie in [0,1].

Unlike a fixed multiplier per frame, this equation has an explicit time unit.
The example's dt is a **fixed simulation step**, supplied by the Step control.
It is not a measurement of wall-clock time. Skipped cooks change wall-clock
persistence. A live installation should define timestamp, gap and reset policy
for its actual input.

The Feedback TOP targets `state`, never the styled output. This is a delayed
dependency: the state shader samples the previous frame while writing the
current one. Hold Reset for a frame and release it to reinitialize; reset after
source changes, seeks or resizing. Pause freezes both time and valid history.

To compare lifetimes fairly, start from the same input sequence and reset for
each run. Do not compare unrelated live moments and call the difference an
isolated decay experiment.

## How does memory become hatching?

From [display.frag](display.frag), lines 8–16:

```glsl
    vec2 pixels = uv * uTDOutputInfo.res.zw;
    float phase = (pixels.x + pixels.y) / max(uControls.z, 2.0);
    float d = abs(fract(phase + 0.5) - 0.5);
    float aa = max(fwidth(phase), 0.0001);
    float hatch = 1.0 - smoothstep(0.16 - aa, 0.16 + aa, d);
    vec3 color = vec3(0.012, 0.020, 0.035) + source * 0.12;
    color += state.g * mix(vec3(0.04, 0.25, 0.28),
                           vec3(0.90, 0.35, 0.12), hatch);
    color += state.b * vec3(0.12, 0.45, 0.52);
```

From [display.frag](display.frag), lines 19–23:

```glsl
    int stage = int(uControls.w + 0.5);
    if (stage == 1) color = source;
    if (stage == 2) color = vec3(state.b);
    if (stage == 3) color = vec3(state.g);
    fragColor = TDOutputSwizzle(vec4(color, 1.0));
```

**Native experiment `final`:** Can the same state become a new material?

On the built component, run `component.op('study_tools').module.apply(component, 'final')`.

Prediction: Diagonal hatching renders older motion warm and fresh motion cool.

Parameters: Pause=False, Stage=final, Reset=False, Threshold=0.018, Lifetime=0.65, Pitch=9. Reset history before observing.

![Native final stage](captures/native-final.png)

Captured native stage; [capture conditions](captures/native-final.png.json). Rendered in TouchDesigner 2025.33230 with no reported operator errors. The receipt records the captured parameters. This capture freezes a controlled input sequence; the live preset starts a new sequence. It is not an isolated matched-time comparison of different lifetimes.

The display pass reads the stored channels but never updates them. Diagonal
lines are defined in output pixels, with a derivative transition around each
line. The trail controls warm coverage and the raw mask adds a cooler signal.
Changing pitch or palette should leave the state texture unchanged.

This is the new composition: the age relationship drives a material-like
representation. It is more than a palette swap of a motion demo because the
state/display contract, timing rule and hatch interpretation are explicit and
independently testable.

## Evidence and limits

Check `validation.json` for actual native compile, render, reset, hold and decay
tests. Capture receipts identify the controls and host. A still cannot prove
temporal behavior. This study does not implement optical flow or blob tracking,
and it does not guarantee robustness to camera noise, exposure or frame loss.
The procedural source makes the basic mechanism reproducible before those
additional problems are introduced.

For temporal playback, open the output TOP viewer (right-click `out` → View) or connect a consuming output. TouchDesigner cooks on demand; a hidden, unused branch does not advance history merely because time advances. The validation driver deliberately cooks once per frame and is not embedded in exported components.
