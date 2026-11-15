# Tidal Ink

Transport two pigment concentrations into interleaved curls. Test real persistent state, periodic sampling, initialization, pause/reset and simulated-time decay, using a prescribed field rather than a full fluid solver.

![Native final output](captures/native-final.png)

This is an original TouchDesigner study grounded in the cited archive. It separates the published technique, the new native implementation, and observations from actual tests. The source tutorial and excerpts are generated together so the explanation stays tied to the delivered shader.

## Open the study

Drag [the native component](native/study.tox) into TouchDesigner, or run `build.py` inside its Python Textport with `runpy`. Keep the returned component in a variable named `component` for the experiment commands below. Open its `out` viewer and use the Study parameter page. Presets fix unrelated controls; Pause and Time make comparisons reproducible. Any reset or warmup requirement is stated beside its experiment.

The recipe is [study.json](study.json), the source trail is [research.md](research.md), and native results are summarized in [review.md](review.md). The tested host is TouchDesigner 2025.33230 on macOS. Browser copies of these algorithms would require their own validation.

## A texture can hold pigment instead of a picture

The state texture stores two nonnegative pigment concentrations in R and G, reserves B, and uses A as an initialization marker. A separate display pass turns those numbers into color. This separation follows the archive's use of textures as data, while the specific advection mechanism is a new extension.

Reset restores a deterministic pattern of two intersecting pigment bands. Flat and empty fixtures support tests that would be difficult to interpret from the decorative pattern. Pause holds the stored state exactly; it does not merely freeze a time uniform while allowing the simulation to keep evolving.

Feedback TOP supplies the previous state to the current state pass. That temporal target is a previous-frame reference rather than an ordinary same-frame wire cycle. The output needs a consuming viewer or explicit cook driver to advance. A hidden unused network may remain unchanged even while the project timeline runs.

From [seed.frag](seed.frag), lines 4–12:

```glsl
void main(){
    vec2 p=vUV.st;
    vec2 pigments=vec2(0.0);
    if(uSeed.x<0.5){
        pigments.x=exp(-pow((p.x-0.3)/0.055,2.0))*smoothstep(0.1,0.2,p.y)*(1.0-smoothstep(0.8,0.9,p.y));
        pigments.y=exp(-pow((p.y-0.65)/0.045,2.0))*smoothstep(0.1,0.2,p.x)*(1.0-smoothstep(0.8,0.9,p.x));
    }else if(uSeed.x<1.5) pigments=vec2(0.25,0.6);
    fragColor=TDOutputSwizzle(vec4(pigments,0.0,1.0));
}
```

**Native experiment `seed`:** What data persists between frames?

On the built component, run `component.op('study_tools').module.apply(component, 'seed')`.

Prediction: Two pigment concentrations occupy R and G; reset restores the deterministic seed.

Parameters: Pause=True, Time=2, Step=0.016666666666666666, Stage=state, Speed=0.12, Decay=0.15, Inject=0.5, Seed=pattern. Reset history before observing.

![Native seed stage](captures/native-seed.png)

Captured native stage; [capture conditions](captures/native-seed.png.json). Captured from the native component with no reported operator errors. Mechanism-specific comparisons are recorded in review.md.

![Actual node names and dependencies, shown schematically](figures/network.svg)

The diagram is a schematic of the recipe, not a captured network screenshot. Texture wires and parameter references are labeled separately.

## Prescribe a velocity with a known property

The velocity is S*(sin(2πx)cos(2πy), -cos(2πx)sin(2πy)), with S measured in normalized UV units per simulated second. Its X derivative and Y derivative cancel, so the continuous field has zero divergence. It is also periodic at the domain boundaries.

This is a prescribed transport field. It does not respond to pigment, solve pressure, conserve momentum or represent the full Navier–Stokes equations. The visible curls are useful for an advection test without claiming a complete fluid simulation.

The velocity diagnostic encodes signed components around a middle value of 0.5. It should remain unchanged when pigment concentrations change. That independence is a useful architectural check: the display image and state are not secretly feeding back into the velocity definition.

From [state.frag](state.frag), lines 7–9:

```glsl
vec2 velocity(vec2 p){
    return uFlow.x*vec2(sin(TAU*p.x)*cos(TAU*p.y),-cos(TAU*p.x)*sin(TAU*p.y));
}
```

**Native experiment `velocity`:** Which way will the pigments travel?

On the built component, run `component.op('study_tools').module.apply(component, 'velocity')`.

Prediction: Red and green encode the prescribed signed velocity; the field is independent of pigment concentration.

Parameters: Pause=True, Time=2, Step=0.016666666666666666, Stage=velocity, Speed=0.12, Decay=0.15, Inject=0.5, Seed=pattern. Time and unrelated controls are fixed by this preset.

![Native velocity stage](captures/native-velocity.png)

Captured native stage; [capture conditions](captures/native-velocity.png.json). Captured from the native component with no reported operator errors. Mechanism-specific comparisons are recorded in review.md.

## Follow the lookup backward

For each destination texel we trace backward through the velocity field to find where its pigment came from. A midpoint estimate samples velocity halfway along the step before choosing the departure location. The old texture is then sampled at that location.

The domain is periodic. Merely applying fract to UV coordinates would not guarantee correct interpolation at the seam if the sampler clamped its neighboring texels. The implementation therefore fetches four wrapped integer texels and blends them explicitly. Subtracting half a texel aligns the interpolation coordinates with texel centers.

This interpolation is stable in the sense that a convex combination of bounded values stays bounded, but it is diffusive and not exactly conservative. A native zero-velocity test detected small drift from repeated coordinate conversion and interpolation. The corrected implementation reads the previous texel directly when Speed is zero, preserving the identity case rather than relaxing the test.

From [state.frag](state.frag), lines 12–22:

```glsl
ivec2 wrapCell(ivec2 p,ivec2 size){return (p%size+size)%size;}
vec2 periodicSample(vec2 uv){
    ivec2 size=textureSize(sTD2DInputs[0],0);
    vec2 pixel=fract(uv)*vec2(size)-0.5;
    ivec2 base=ivec2(floor(pixel));vec2 w=fract(pixel);
    vec2 a=texelFetch(sTD2DInputs[0],wrapCell(base,size),0).rg;
    vec2 b=texelFetch(sTD2DInputs[0],wrapCell(base+ivec2(1,0),size),0).rg;
    vec2 c=texelFetch(sTD2DInputs[0],wrapCell(base+ivec2(0,1),size),0).rg;
    vec2 d=texelFetch(sTD2DInputs[0],wrapCell(base+ivec2(1,1),size),0).rg;
    return mix(mix(a,b,w.x),mix(c,d,w.x),w.y);
}
```

**Native experiment `backtrace`:** Where does each new texel look for its old value?

On the built component, run `component.op('study_tools').module.apply(component, 'backtrace')`.

Prediction: The UV diagnostic shows a backward lookup, with periodic wrapping.

Parameters: Pause=True, Time=2, Step=0.016666666666666666, Stage=backtrace, Speed=0.12, Decay=0.15, Inject=0.5, Seed=pattern. Time and unrelated controls are fixed by this preset.

![Native backtrace stage](captures/native-backtrace.png)

Captured native stage; [capture conditions](captures/native-backtrace.png.json). Captured from the native component with no reported operator errors. Mechanism-specific comparisons are recorded in review.md.

## Challenge the lifecycle with simple states

A uniform field should stay uniform under transport when decay and sources are disabled. An empty field should stay empty. Reset should replace the old pattern with the selected seed, and Pause should return the previous RGBA values exactly. These are different properties and are checked separately.

For decay alone, multiplying by exp(-rate*dt) gives a known answer after one simulated second. The native test compares sixty 1/60-second updates with thirty 1/30-second updates on a flat field. It does not expect those two step sizes to produce identical transported textures: interpolation introduces step-dependent numerical diffusion.

Step is simulated seconds per cook, not seconds measured from the wall clock. At a different presentation frame rate, the same fixed Step changes the rate of simulation relative to real time. That is intentional for repeatable testing. An installation that needs real-time synchronization should supply a bounded measured delta and revalidate its lifecycle.

From [state.frag](state.frag), lines 35–36:

```glsl
    if(uFlow.w>0.5 || previous.a<0.5){fragColor=TDOutputSwizzle(vec4(seedAt(p),0.0,1.0));return;}
    if(uClock.z>0.5){fragColor=TDOutputSwizzle(previous);return;}
```

**Native experiment `flat`:** Can transport invent contrast in a uniform field?

On the built component, run `component.op('study_tools').module.apply(component, 'flat')`.

Prediction: A uniform initialized field stays uniform when source and decay are off.

Parameters: Pause=True, Time=2, Step=0.016666666666666666, Stage=state, Speed=0.12, Decay=0, Inject=0, Seed=flat. Reset history before observing.

![Native flat stage](captures/native-flat.png)

Captured native stage; [capture conditions](captures/native-flat.png.json). Captured from the native component with no reported operator errors. Mechanism-specific comparisons are recorded in review.md.

## Display the transported state without changing it

After transport, an exponential factor removes pigment and two localized sources add new concentration proportional to dt. Concentration is bounded to [0,1]. Clamping is an artistic saturation rule; once active, it is an additional reason not to claim exact mass conservation.

The final display multiplies a paper color by an exponential of two chosen absorption vectors. Mixing the pigments therefore darkens different channels without feeding the styled RGB image back into the simulation. The palette is illustrative rather than a measured paint model.

The final capture is taken after 120 controlled updates from reset. To compare it exactly, use the same seed, step, source and decay values and count simulation cooks, not elapsed seconds. The accompanying test also measures approximate mass change with sources and decay disabled. Its small measured loss describes this run; a different resolution or velocity can diffuse more strongly.

From [state.frag](state.frag), lines 39–47:

```glsl
    float dt=clamp(uClock.y,0.001,0.1);
    vec2 midpoint=p-0.5*dt*velocity(p);
    vec2 departure=p-dt*velocity(midpoint);
    vec2 transported=uFlow.x<1e-8 ? previous.rg : periodicSample(departure);
    vec2 ink=transported*exp(-uFlow.y*dt);
    vec2 source=vec2(exp(-dot(p-vec2(0.25,0.26),p-vec2(0.25,0.26))*1200.0),
                     exp(-dot(p-vec2(0.72,0.7),p-vec2(0.72,0.7))*1200.0));
    ink=clamp(ink+source*uFlow.z*dt,0.0,1.0);
    fragColor=TDOutputSwizzle(vec4(ink,0.0,1.0));
```

**Native experiment `final`:** How does transport make ribbons?

On the built component, run `component.op('study_tools').module.apply(component, 'final')`.

Prediction: After reset and 120 cooks, two pigments stretch into curls under a fixed prescribed field.

Parameters: Pause=False, Time=2, Step=0.016666666666666666, Stage=final, Speed=0.12, Decay=0.15, Inject=0.5, Seed=pattern. Reset history before observing.

![Native final stage](captures/native-final.png)

Captured native stage; [capture conditions](captures/native-final.png.json). Captured after 120 controlled updates from reset at Step=1/60. The capture receipt records the warmup; wall-clock time is not the simulation clock.

The display pass reads those concentrations independently:

From [display.frag](display.frag), lines 15–17:

```glsl
        vec3 paper=vec3(0.93,0.88,0.76);
        vec3 opticalDepth=pigments.x*vec3(3.0,0.7,0.25)+pigments.y*vec3(0.25,1.7,2.6);
        color=paper*exp(-opticalDepth*2.5);
```

## Evidence, tradeoffs and next experiments

The [review record](review.md) lists the actual checks and their limits. Captured presets establish those states; shader compilation establishes accepted code; mathematical fixtures test specific relationships. None alone establishes artistic acceptance or performance on another device. Native CPU cook observations are not labeled GPU execution time.

Change one mechanism at a time, preserve a fixed baseline, and explain why the new choice helps the intended image. The presets are teaching tools, not a restriction on new compositions. Shader approval and tutorial approval remain separate.

## Sources and credit

[Maxime Heckel’s article](https://blog.maximeheckel.com/posts/the-magical-world-of-particles-with-react-three-fiber-and-shaders/) and its matching archived demo informed the mechanism and teaching structure. [Exact source records](sources.json) preserve the relevant lines, hashes and adaptation notes. Credit for underlying algorithms remains with the researchers named in those sources. New prose, diagrams and native code are authored for this toolkit. See [the package attribution](../../ATTRIBUTION.md) for original source terms.

Native host contracts: [GLSL TOP](https://docs.derivative.ca/Write_a_GLSL_TOP), [GLSL MAT](https://docs.derivative.ca/Write_a_GLSL_MAT), and [Feedback TOP](https://docs.derivative.ca/Feedback_TOP), as applicable to the recipe. The live host provides the parameter and compile evidence.

For the supplemental backward-advection concept, see [Mark J. Harris, GPU Gems chapter 38](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu). The prescribed field and explicit midpoint implementation here are scoped in the research record.
