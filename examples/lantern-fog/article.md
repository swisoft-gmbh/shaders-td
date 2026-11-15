# Lantern Fog

Make two lit helical density ribbons suspended in a dark volume. Teach view transmission and light visibility as different quantities, and test step-size consistency with a homogeneous slab.

![Native final output](captures/native-final.png)

This is an original TouchDesigner study grounded in the cited archive. It separates the published technique, the new native implementation, and observations from actual tests. The source tutorial and excerpts are generated together so the explanation stays tied to the delivered shader.

## Open the study

Drag [the native component](native/study.tox) into TouchDesigner, or run `build.py` inside its Python Textport with `runpy`. Keep the returned component in a variable named `component` for the experiment commands below. Open its `out` viewer and use the Study parameter page. Presets fix unrelated controls; Pause and Time make comparisons reproducible. Any reset or warmup requirement is stated beside its experiment.

The recipe is [study.json](study.json), the source trail is [research.md](research.md), and native results are summarized in [review.md](review.md). The tested host is TouchDesigner 2025.33230 on macOS. Browser copies of these algorithms would require their own validation.

## Start with density, not a translucent surface

The scene contains two helical ribbons of density. Their centers wind through the XZ plane as Y changes, and exponential radial falloff gives each ribbon a soft cross-section. A vertical envelope limits their ends. A bounded sinusoidal modulation adds internal variation without requiring an external noise texture.

Density is nonnegative and exists only inside a cube with half-extent 1.5 scene units. A view ray traverses a total Z length of three units. The diagnostic shows a central slice rather than the integrated volume, so it answers where material exists before questions about lighting arise.

The Slab fixture replaces the ribbon function with a constant density of 0.4. That unglamorous option is central to the test: it removes spatial complexity and gives transmission a known answer. The image border extends slightly beyond the volume, so analytic slab comparisons use an interior region.

From [volume.frag](volume.frag), lines 6–16:

```glsl
float density(vec3 p){
    if(any(greaterThan(abs(p),vec3(1.5)))) return 0.0;
    if(uVolume.w>0.5) return 0.4;
    float t=uClock.x*0.24;
    vec2 center=0.48*vec2(cos(2.1*p.y+t),sin(2.1*p.y+t));
    float r1=length(p.xz-center);
    float r2=length(p.xz+center*0.85);
    float envelope=1.0-smoothstep(0.85,1.4,abs(p.y));
    float detail=0.65+0.35*sin(8.0*p.x+3.0*sin(4.0*p.z)+3.0*p.y-t);
    return (exp(-r1*r1*19.0)+0.7*exp(-r2*r2*28.0))*envelope*detail;
}
```

**Native experiment `density`:** What is the volume before illumination?

On the built component, run `component.op('study_tools').module.apply(component, 'density')`.

Prediction: A central density slice reveals intertwined helical ribbons.

Parameters: Pause=True, Time=2, Stage=density, Extinction=2.2, Steps=64, Light=1, Slab=False. Time and unrelated controls are fixed by this preset.

![Native density stage](captures/native-density.png)

Captured native stage; [capture conditions](captures/native-density.png.json). Captured from the native component with no reported operator errors. Mechanism-specific comparisons are recorded in review.md.

![Actual node names and dependencies, shown schematically](figures/network.svg)

The diagram is a schematic of the recipe, not a captured network screenshot. Texture wires and parameter references are labeled separately.

## Transmission belongs to the view ray

For a segment of length ds, density rho and extinction sigma produce a segment transmission exp(-sigma*rho*ds). Density is dimensionless here and extinction is inverse scene distance, making the exponent dimensionless. The cumulative transmission T is the fraction surviving from the camera to the current sample.

The segment contributes T*(1-segmentT)*source to radiance, then updates T by multiplying it by segmentT. This order accounts for the current segment using the transmission that reached its front. A constant segment source makes this an exact exponential segment integral under the piecewise-constant approximation.

Including ds is essential. Simply adding a density contribution at every iteration would change brightness when sample count changed. This native implementation intentionally differs from historical snippets in the archive where the accumulation mixes those roles. The preserved source remains evidence of the published version; it is not silently rewritten to match this shader.

From [volume.frag](volume.frag), lines 38–53:

```glsl
        int count=int(clamp(uVolume.y,16.0,128.0));
        float ds=3.0/float(count);
        float transmission=1.0;
        vec3 radiance=vec3(0.0);
        for(int i=0;i<128;i++){
            if(i>=count) break;
            vec3 samplePoint=vec3(p,1.5-(float(i)+0.5)*ds);
            float rho=density(samplePoint);
            float segmentT=exp(-uVolume.x*rho*ds);
            if(rho>0.001 && stage!=2){
                float visibility=mix(1.0,lightVisibility(samplePoint),uVolume.z);
                vec3 source=vec3(0.055,0.09,0.2)+vec3(1.3,0.69,0.27)*visibility;
                radiance+=transmission*(1.0-segmentT)*source;
            }
            transmission*=segmentT;
        }
```

**Native experiment `transmission`:** How much background light survives?

On the built component, run `component.op('study_tools').module.apply(component, 'transmission')`.

Prediction: Bright areas transmit more; dense overlapping ribbons transmit less.

Parameters: Pause=True, Time=2, Stage=transmittance, Extinction=2.2, Steps=64, Light=1, Slab=False. Time and unrelated controls are fixed by this preset.

![Native transmission stage](captures/native-transmission.png)

Captured native stage; [capture conditions](captures/native-transmission.png.json). Captured from the native component with no reported operator errors. Mechanism-specific comparisons are recorded in review.md.

## Light takes a different journey

A sample can be visible to the camera yet poorly lit because material blocks its path toward the light. The second march estimates that separate path. It accumulates density times a 0.25-unit segment length along a fixed light direction and converts the resulting optical depth to transmission.

That visibility modifies the local source color. It does not replace cumulative view transmission. The two values answer different questions: whether light reaches a sample, and whether light from that sample reaches the camera.

The light march has twelve midpoint samples and a fixed three-unit reach. This is a deliberate bounded approximation. It can miss attenuation outside that reach or fine density detail between samples. The view-step convergence test therefore says nothing about convergence of the light march; keeping this limit visible prevents an attractive result from being mistaken for a fully converged scattering model.

From [volume.frag](volume.frag), lines 19–27:

```glsl
float lightVisibility(vec3 p){
    vec3 direction=normalize(vec3(-0.8,0.55,0.7));
    float opticalDepth=0.0;
    const float stepLength=0.25;
    for(int j=0;j<12;j++){
        opticalDepth+=density(p+direction*(float(j)+0.5)*stepLength)*stepLength;
    }
    return exp(-uVolume.x*opticalDepth);
}
```

**Native experiment `light`:** Does light visibility have its own path?

On the built component, run `component.op('study_tools').module.apply(component, 'light')`.

Prediction: The central slice shows light attenuation from a fixed direction, separate from the view ray.

Parameters: Pause=True, Time=2, Stage=light, Extinction=2.2, Steps=64, Light=1, Slab=False. Time and unrelated controls are fixed by this preset.

![Native light stage](captures/native-light.png)

Captured native stage; [capture conditions](captures/native-light.png.json). Captured from the native component with no reported operator errors. Mechanism-specific comparisons are recorded in review.md.

## Use a slab to challenge the equation

With density 0.4, extinction 2 and path length 3, the exact transmission is exp(-2.4), approximately 0.090718. Dividing the path into 16, 64 or 128 equal segments should preserve that product apart from floating-point roundoff. The test checks all three choices on the native output.

The zero-extinction case should return transmission one. Increasing extinction should never increase transmission for the same density. These checks test the equation and parameter meaning independently from the visual ribbons.

For the spatially varying scene we also compare 32 and 64 view steps against a 128-step reference. Lower error at 64 supports convergence for this fixture. It is not a universal quality guarantee: a new high-frequency density function can require more samples, and an image error threshold should be chosen for its actual use.

From [volume.frag](volume.frag), lines 38–53:

```glsl
        int count=int(clamp(uVolume.y,16.0,128.0));
        float ds=3.0/float(count);
        float transmission=1.0;
        vec3 radiance=vec3(0.0);
        for(int i=0;i<128;i++){
            if(i>=count) break;
            vec3 samplePoint=vec3(p,1.5-(float(i)+0.5)*ds);
            float rho=density(samplePoint);
            float segmentT=exp(-uVolume.x*rho*ds);
            if(rho>0.001 && stage!=2){
                float visibility=mix(1.0,lightVisibility(samplePoint),uVolume.z);
                vec3 source=vec3(0.055,0.09,0.2)+vec3(1.3,0.69,0.27)*visibility;
                radiance+=transmission*(1.0-segmentT)*source;
            }
            transmission*=segmentT;
        }
```

**Native experiment `slab`:** Can a homogeneous slab match an equation?

On the built component, run `component.op('study_tools').module.apply(component, 'slab')`.

Prediction: Transmission equals exp(-2 × 0.4 × 3), independent of the step count up to floating-point error.

Parameters: Pause=True, Time=2, Stage=transmittance, Extinction=2, Steps=64, Light=0, Slab=True. Time and unrelated controls are fixed by this preset.

![Native slab stage](captures/native-slab.png)

Captured native stage; [capture conditions](captures/native-slab.png.json). Captured from the native component with no reported operator errors. Mechanism-specific comparisons are recorded in review.md.

## Composite what survives

The remaining background is multiplied by final transmission and added to accumulated radiance. This prevents empty space from behaving like an opaque black surface. The displayed TOP is opaque because it includes the background; its alpha is not a reusable volume transmittance channel.

The amber illumination and violet-blue ambient term are chosen for legibility. They are not measured spectral scattering coefficients. The broad helical form gives a visibly different result from the opaque SDF study even though both shaders march rays.

The default 64-step view integration is an educational compromise. Native cook observations are recorded separately from image correctness and are not presented as GPU benchmarks. A production volume could add a tighter bounding volume, adaptive sampling, temporal reconstruction or a more complete lighting model, each with additional tests.

From [volume.frag](volume.frag), lines 56–57:

```glsl
        vec3 background=mix(vec3(0.012,0.02,0.055),vec3(0.09,0.025,0.1),vUV.y);
        color=stage==2 ? vec3(transmission) : radiance+transmission*background;
```

**Native experiment `final`:** What does scattering add?

On the built component, run `component.op('study_tools').module.apply(component, 'final')`.

Prediction: Amber-lit violet density accumulates over the dark background with front-to-back attenuation.

Parameters: Pause=True, Time=2, Stage=final, Extinction=2.2, Steps=64, Light=1, Slab=False. Time and unrelated controls are fixed by this preset.

![Native final stage](captures/native-final.png)

Captured native stage; [capture conditions](captures/native-final.png.json). Captured from the native component with no reported operator errors. Mechanism-specific comparisons are recorded in review.md.

## Evidence, tradeoffs and next experiments

The [review record](review.md) lists the actual checks and their limits. Captured presets establish those states; shader compilation establishes accepted code; mathematical fixtures test specific relationships. None alone establishes artistic acceptance or performance on another device. Native CPU cook observations are not labeled GPU execution time.

Change one mechanism at a time, preserve a fixed baseline, and explain why the new choice helps the intended image. The presets are teaching tools, not a restriction on new compositions. Shader approval and tutorial approval remain separate.

## Sources and credit

[Maxime Heckel’s article](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/) and its matching archived demo informed the mechanism and teaching structure. [Exact source records](sources.json) preserve the relevant lines, hashes and adaptation notes. Credit for underlying algorithms remains with the researchers named in those sources. New prose, diagrams and native code are authored for this toolkit. See [the package attribution](../../ATTRIBUTION.md) for original source terms.

Native host contracts: [GLSL TOP](https://docs.derivative.ca/Write_a_GLSL_TOP), [GLSL MAT](https://docs.derivative.ca/Write_a_GLSL_MAT), and [Feedback TOP](https://docs.derivative.ca/Feedback_TOP), as applicable to the recipe. The live host provides the parameter and compile evidence.
