# Article and demo source map

Paths below are relative to `references/corpus/`. Originals are unmodified.
Sandpack modules are source references, not standalone applications. Read their wrapper
for dependency versions and map the article's scene selector before adapting code.

## Contents

- [Building a Vaporwave scene with Three.js](#building-a-vaporwave-scene-with-threejs)
- [The Study of Shaders with React Three Fiber](#the-study-of-shaders-with-react-three-fiber)
- [The magical world of Particles with React Three Fiber and Shaders](#the-magical-world-of-particles-with-react-three-fiber-and-shaders)
- [Refraction, dispersion, and other shader light effects](#refraction-dispersion-and-other-shader-light-effects)
- [Beautiful and mind-bending effects with WebGL Render Targets](#beautiful-and-mind-bending-effects-with-webgl-render-targets)
- [Painting with Math: A Gentle Study of Raymarching](#painting-with-math-a-gentle-study-of-raymarching)
- [Real-time dreamy Cloudscapes with Volumetric Raymarching](#real-time-dreamy-cloudscapes-with-volumetric-raymarching)
- [Shining a light on Caustics with Shaders and React Three Fiber](#shining-a-light-on-caustics-with-shaders-and-react-three-fiber)
- [Moebius-style post-processing and other stylized shaders](#moebius-style-post-processing-and-other-stylized-shaders)
- [On Crafting Painterly Shaders](#on-crafting-painterly-shaders)
- [The Art of Dithering and Retro Shading for the Web](#the-art-of-dithering-and-retro-shading-for-the-web)
- [Post-Processing Shaders as a Creative Medium](#post-processing-shaders-as-a-creative-medium)
- [On Shaping Light](#on-shaping-light)
- [Field Guide to TSL and WebGPU](#field-guide-to-tsl-and-webgpu)
- [Shades of Halftone](#shades-of-halftone)
- [Shading Motion](#shading-motion)
- [On Rendering the Sky, Sunsets, and Planets](#on-rendering-the-sky-sunsets-and-planets)
- [Learning in public](#learning-in-public)
- [Speaking at Figma Config 2025](#speaking-at-figma-config-2025)
- [Building a Design System from scratch](#building-a-design-system-from-scratch)
- [Cubic Bézier: from math to motion](#cubic-bézier-from-math-to-motion)
- [The physics behind spring animations](#the-physics-behind-spring-animations)
- [Scrollspy demystified](#scrollspy-demystified)
- [Guide to creating animations that spark joy with Framer Motion](#guide-to-creating-animations-that-spark-joy-with-framer-motion)
- [Advanced animation patterns with Framer Motion](#advanced-animation-patterns-with-framer-motion)
- [Everything about Framer Motion layout animations](#everything-about-framer-motion-layout-animations)
- [The Power of Composition with CSS Variables](#the-power-of-composition-with-css-variables)

## Building a Vaporwave scene with Three.js

Slug: `vaporwave-3d-scene-with-threejs`

[Article source](corpus/articles/vaporwave-3d-scene-with-threejs.mdx) · [Original article](https://blog.maximeheckel.com/posts/vaporwave-3d-scene-with-threejs/)

- L1–41: Introduction
- L42–285: Setting up the scene
- L286–289: Building the terrain
- L290–308: Deconstructing the original scene
- L309–335: Texture
- L336–381: Terrain
- L382–385: Animating the scene
- L386–441: Animation patterns and Frame Rate
- L442–523: Making the scene endless
- L524–622: Adding post-processing effects
- L623–695: Let there be light!
- L696–715: Conclusion

Demo selectors: `VaporwaveThreejsSandpacks script="script1"`, `VaporwaveThreejsSandpacks script="script2"`, `VaporwaveThreejsSandpacks script="script3"`, `VaporwaveThreejsSandpacks script="script4"`, `VaporwaveThreejsSandpacks script="script5"`, `VaporwaveThreejsSandpacks script="script6"`, `VaporwaveThreejsSandpacks script="script7"`

- `VaporwaveThreejsDisclaimer` → `blog/core/components/MDX/Widgets/VaporwaveThreejs/CalloutGPUTier`
- `VaporwaveThreejsSandpacks` → `blog/core/components/MDX/Widgets/VaporwaveThreejs/Sandpack`

## The Study of Shaders with React Three Fiber

Slug: `the-study-of-shaders-with-react-three-fiber`

[Article source](corpus/articles/the-study-of-shaders-with-react-three-fiber.mdx) · [Original article](https://blog.maximeheckel.com/posts/the-study-of-shaders-with-react-three-fiber/)

- L1–70: Introduction
- L71–119: Shaders in React Three Fiber
- L120–158: What is a shader?
- L159–187: Vertex Shader
- L188–213: Fragment Shader
- L214–221: Why are shaders so hard to use?
- L222–225: Dynamic Shaders with uniforms and varyings
- L226–347: Uniforms
- L348–422: Varyings
- L423–432: Combining uniforms and varyings
- L433–436: Advanced Interactive Shaders
- L437–470: Let's make some noise 🤘!
- L471–512: Blob
- L513–534: Gradient
- L535–639: Composable shader layers with Lamina
- L640–646: Conclusion

Demo selectors: `R3FShaderSandpack scene="scene1"`, `R3FShaderSandpack scene="scene2"`, `R3FShaderSandpack scene="scene3"`, `R3FShaderSandpack scene="scene4"`, `R3FShaderSandpack scene="scene5"`, `R3FShaderSandpack scene="scene6"`, `R3FShaderSandpack scene="scene7"`, `R3FShaderSandpack scene="scene8"`

- `FragmentShaderVisualizer` → `blog/core/components/MDX/Widgets/ShaderReactThreeFiber/FragmentShaderVisualizer`
- `R3FShaderSandpack` → `blog/core/components/MDX/Widgets/ShaderReactThreeFiber/Sandpack`

## The magical world of Particles with React Three Fiber and Shaders

Slug: `the-magical-world-of-particles-with-react-three-fiber-and-shaders`

[Article source](corpus/articles/the-magical-world-of-particles-with-react-three-fiber-and-shaders.mdx) · [Original article](https://blog.maximeheckel.com/posts/the-magical-world-of-particles-with-react-three-fiber-and-shaders/)

- L1–74: Introduction
- L75–78: An introduction to attributes
- L79–112: What are attributes?
- L113–164: Playing with attributes
- L165–194: Attributes with Shaders
- L195–198: Particles in React Three Fiber
- L199–235: Our first scene with Particles
- L236–333: Using BufferGeometry and attributes to create custom geometries
- L334–344: Customizing and animating Particles with Shaders
- L345–385: Animating Particles with attributes
- L386–485: How to animate our particles with a vertex shader
- L486–563: How to change the size and appearance of our particles with shaders
- L564–587: Going beyond with Frame Buffer Objects
- L588–791: How does a Frame Buffer Object work with particles?
- L792–824: Creating magical scenes with FBO
- L825–832: Conclusion

Demo selectors: `ParticlesShaderSandpack scene="scene1"`, `ParticlesShaderSandpack scene="scene2"`, `ParticlesShaderSandpack scene="scene3"`, `ParticlesShaderSandpack scene="scene4"`, `ParticlesShaderSandpack scene="scene5"`, `ParticlesShaderSandpack scene="scene6"`, `ParticlesShaderSandpack scene="scene7"`, `ParticlesShaderSandpack scene="scene8"`, `ParticlesShaderSandpack scene="scene9"`

- `AttributesVisualizer` → `blog/core/components/MDX/Widgets/ParticlesReactThreeFiber/AttributesVisualizer`
- `ParticlesShaderSandpack` → `blog/core/components/MDX/Widgets/ParticlesReactThreeFiber/Sandpack`

## Refraction, dispersion, and other shader light effects

Slug: `refraction-dispersion-and-other-shader-light-effects`

[Article source](corpus/articles/refraction-dispersion-and-other-shader-light-effects.mdx) · [Original article](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/)

- L1–85: Introduction
- L86–97: Bending light with refraction
- L98–225: Transparent mesh with FBO
- L226–321: Refraction
- L322–334: Chromatic Dispersion
- L335–399: Splitting colors with Chromatic Aberration
- L400–464: Additional samples for a smoother dispersion
- L465–468: Saturating and expanding our color space
- L469–519: How to saturate a color in GLSL
- L520–560: From RGB to rygcbv and back
- L561–569: Adding volume and shininess to our dispersion
- L570–656: Specular & Diffuse light
- L657–695: Reflection with the Fresnel effect
- L696–774: Backside rendering
- L775–781: Conclusion

Demo selectors: `RefractionDispersionSandpack scene="scene1"`, `RefractionDispersionSandpack scene="scene2"`, `RefractionDispersionSandpack scene="scene3"`, `RefractionDispersionSandpack scene="scene4"`, `RefractionDispersionSandpack scene="scene5"`, `RefractionDispersionSandpack scene="scene6"`, `RefractionDispersionSandpack scene="scene7"`, `RefractionDispersionSandpack scene="scene8"`, `RefractionDispersionSandpack scene="scene9"`

- `ColorChannelSummary` → `blog/core/components/MDX/Widgets/RefractionDispersionReactThreeFiber/ColorChannelSummary`
- `RGBShiftVisualizer` → `blog/core/components/MDX/Widgets/RefractionDispersionReactThreeFiber/RGBShiftVisualizer`
- `RefractionDispersionSandpack` → `blog/core/components/MDX/Widgets/RefractionDispersionReactThreeFiber/Sandpack`

## Beautiful and mind-bending effects with WebGL Render Targets

Slug: `beautiful-and-mind-bending-effects-with-webgl-render-targets`

[Article source](corpus/articles/beautiful-and-mind-bending-effects-with-webgl-render-targets.mdx) · [Original article](https://blog.maximeheckel.com/posts/beautiful-and-mind-bending-effects-with-webgl-render-targets/)

- L1–84: Introduction
- L85–174: Render Targets in React Three Fiber
- L175–178: Offscreen scenes
- L179–215: A quick introduction to createPortal
- L216–276: createPortal in combination with render target
- L277–303: Using shader materials
- L304–328: Using Drei's RenderTexture component
- L329–334: Render targets with screen coordinates
- L335–383: UV coordinates VS screen coordinates.
- L384–476: Swapping materials and geometries in the render loop
- L477–501: A more advanced Portal scene
- L502–625: An alternative to EffectComposer for post-processing effects
- L626–681: Transition gracefully between scenes
- L682–687: Conclusion

Demo selectors: `RenderTargetsSandpack scene="scene1"`, `RenderTargetsSandpack scene="scene2"`, `RenderTargetsSandpack scene="scene3"`, `RenderTargetsSandpack scene="scene4"`, `RenderTargetsSandpack scene="scene5"`, `RenderTargetsSandpack scene="scene6"`, `RenderTargetsSandpack scene="scene7"`, `RenderTargetsSandpack scene="scene8"`, `RenderTargetsSandpack scene="scene9"`

- `RenderTargetsSandpack` → `blog/core/components/MDX/Widgets/RenderTargetsReactThreeFiber/Sandpack`

## Painting with Math: A Gentle Study of Raymarching

Slug: `painting-with-math-a-gentle-study-of-raymarching`

[Article source](corpus/articles/painting-with-math-a-gentle-study-of-raymarching.mdx) · [Original article](https://blog.maximeheckel.com/posts/painting-with-math-a-gentle-study-of-raymarching/)

- L1–49: Introduction
- L50–55: Snapshots of Math: demystifying the concept of Raymarching
- L56–73: Marching rays
- L74–134: Defining the World with Signed Distance Fields
- L135–149: Our first Raymarched scene
- L150–244: The canvas
- L245–295: Beaming rays
- L296–371: Adding some depth with light
- L372–379: SDF operations, complex scenes, and fractals
- L380–452: Combining SDFs
- L453–555: Moving, rotating, and scaling
- L556–645: Scaling to infinity
- L646–651: Building Worlds with Raymarching and noise derivatives
- L652–722: Composing noise with Fractal Brownian Motion
- L723–833: Noise derivatives
- L834–914: Sky, fog, and Martian landscape
- L915–927: Final thoughts

Demo selectors: `RaymarchingSandpack scene="scene1"`, `RaymarchingSandpack scene="scene2"`, `RaymarchingSandpack scene="scene3"`, `RaymarchingSandpack scene="scene4"`, `RaymarchingSandpack scene="scene5"`, `RaymarchingSandpack scene="scene6"`, `RaymarchingSandpack scene="scene7"`, `RaymarchingSandpack scene="scene8"`, `RaymarchingSandpack scene="scene9"`, `RaymarchingSandpack scene="scene10"`

- `RaymarchingSandpack` → `blog/core/components/MDX/Widgets/Raymarching/Sandpack`
- `RaymarchingVisualizer` → `blog/core/components/MDX/Widgets/Raymarching/RaymarchingVisualizer`

## Real-time dreamy Cloudscapes with Volumetric Raymarching

Slug: `real-time-cloudscapes-with-volumetric-raymarching`

[Article source](corpus/articles/real-time-cloudscapes-with-volumetric-raymarching.mdx) · [Original article](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/)

- L1–49: Introduction
- L50–58: Volumetric rendering: Raymarching with a twist
- L59–104: How to sample a volume
- L105–182: Our first Volumetric Raymarching scene
- L183–186: Drawing Fluffy Raymarched Clouds
- L187–277: Noisy Volume
- L278–405: Adding light
- L406–458: Morphing clouds
- L459–471: Performance optimization
- L472–563: Blue noise dithering
- L564–607: Upscaling with Bicubic filtering
- L608–621: Physically accurate Clouds
- L622–695: Beer's Law
- L696–786: Sampling light
- L787–881: Anisotropic scattering and phase function
- L882–888: Conclusion

Demo selectors: `RaymarchingSandpack scene="scene11"`, `RaymarchingSandpack scene="scene12"`, `RaymarchingSandpack scene="scene13"`, `RaymarchingSandpack scene="scene14"`, `RaymarchingSandpack scene="scene15"`, `RaymarchingSandpack scene="scene16"`, `RaymarchingSandpack scene="scene17"`, `RaymarchingSandpack scene="scene18"`, `RaymarchingSandpack scene="scene19"`

- `RaymarchingSandpack` → `blog/core/components/MDX/Widgets/Raymarching/Sandpack`
- `VolumetricRaymarchingVisualizer` → `blog/core/components/MDX/Widgets/Raymarching/VolumetricRaymarchingVisualizer`

## Shining a light on Caustics with Shaders and React Three Fiber

Slug: `caustics-in-webgl`

[Article source](corpus/articles/caustics-in-webgl.mdx) · [Original article](https://blog.maximeheckel.com/posts/caustics-in-webgl/)

- L1–44: Introduction
- L45–81: Anatomy of a Caustic Effect in WebGL
- L82–212: Extracting Normals
- L213–222: Building our Caustics material
- L223–411: Calculating caustics intensity
- L412–526: Creating beautiful swirls of light
- L527–543: Scaling and positioning our Caustic Plane
- L544–602: Building a "bounding cube" for our mesh
- L603–645: Projecting the vertices of the bounding cube and positioning our plane
- L646–699: Fitting our caustic pattern inside the plane
- L700–816: Dynamic Caustics
- L817–825: Conclusion

Demo selectors: `CausticsSandpack scene="scene1"`, `CausticsSandpack scene="scene2"`, `CausticsSandpack scene="scene3"`, `CausticsSandpack scene="scene4"`, `CausticsSandpack scene="scene5"`

- `CausticsSandpack` → `blog/core/components/MDX/Widgets/Caustics/Sandpack`

## Moebius-style post-processing and other stylized shaders

Slug: `moebius-style-post-processing`

[Article source](corpus/articles/moebius-style-post-processing.mdx) · [Original article](https://blog.maximeheckel.com/posts/moebius-style-post-processing/)

- L1–56: Introduction
- L57–218: Setting up the stage for post-processing
- L219–229: Drawing outlines with shaders for our React Three Fiber scene
- L230–331: Getting the Depth Buffer of our scene
- L332–410: Getting the Normal Buffer of our scene
- L411–581: Edge detection with Sobel filters
- L582–591: Stylized outlines, shadows, and lighting patterns
- L592–665: Giving our outlines an hand-drawn look in GLSL
- L666–734: Adding custom shadow patterns to our post-processing effect
- L735–806: Crosshatched and raster shadow patterns
- L807–903: Custom Stylized Lighting
- L904–1020: A Moebius-worthy WebGL scene and some final thoughts

Demo selectors: `MoebiusSandpack scene="scene1"`, `MoebiusSandpack scene="scene2"`, `MoebiusSandpack scene="scene3"`, `MoebiusSandpack scene="scene4"`, `MoebiusSandpack scene="scene5"`, `MoebiusSandpack scene="scene6"`, `MoebiusSandpack scene="scene7"`, `MoebiusSandpack scene="scene8"`, `MoebiusSandpack scene="scene9"`, `MoebiusSandpack scene="scene10"`

- `MoebiusSandpack` → `blog/core/components/MDX/Widgets/Moebius/Sandpack`
- `ShadingVisualizer` → `blog/core/components/MDX/Widgets/Moebius/ShadingVisualizer`
- `SobelVisualizer` → `blog/core/components/MDX/Widgets/Moebius/SobelVisualizer`

## On Crafting Painterly Shaders

Slug: `on-crafting-painterly-shaders`

[Article source](corpus/articles/on-crafting-painterly-shaders.mdx) · [Original article](https://blog.maximeheckel.com/posts/on-crafting-painterly-shaders/)

- L1–45: Introduction
- L46–61: Painterly post-processing with the Kuwahara filter
- L62–111: Characteristics of the Kuwahara filter
- L112–212: Our first implementation of the Kuwahara filter as a post-processing effect
- L213–223: The Papari extension
- L224–293: Circular kernel
- L294–384: A better weighting of colors
- L385–425: Fixing a performance pitfall
- L426–471: From Structure Tensor to Anisotropic Kuwahara filter
- L472–580: Sobel operator and partial derivatives
- L581–690: From Structure Tensor to flow
- L691–830: Deriving and applying anisotropy to our filter
- L831–965: Final touches and conclusion

Demo selectors: `KuwaharaSandpack scene="scene0"`, `KuwaharaSandpack scene="scene1"`, `KuwaharaSandpack scene="scene2"`, `KuwaharaSandpack scene="scene3"`, `KuwaharaSandpack scene="scene4"`, `KuwaharaSandpack scene="scene5"`, `KuwaharaSandpack scene="scene6"`

- `KernelVisualizer` → `blog/core/components/MDX/Widgets/PainterlyShaders/KernelVisualizer`
- `KuwaharaSandpack` → `blog/core/components/MDX/Widgets/PainterlyShaders/Sandpack`
- `KuwaharaVisualizer` → `blog/core/components/MDX/Widgets/PainterlyShaders/KuwaharaVisualizer`

## The Art of Dithering and Retro Shading for the Web

Slug: `the-art-of-dithering-and-retro-shading-web`

[Article source](corpus/articles/the-art-of-dithering-and-retro-shading-web.mdx) · [Original article](https://blog.maximeheckel.com/posts/the-art-of-dithering-and-retro-shading-web/)

- L1–37: Introduction
- L38–62: Dithering techniques
- L63–178: A first pass at dithering in React Three Fiber
- L179–269: Ordered Dithering and Bayer Matrix
- L270–307: Blue noise dithering
- L308–318: Color Quantization
- L319–391: Shades of gray and colors
- L392–438: Custom color palettes
- L439–455: Hue-lightness-based color quantization
- L456–526: Pixelization
- L527–540: Cathode-Ray Tube effect
- L541–623: RGB Cells
- L624–668: Curving the display
- L669–762: Scanlines, distortion, and final touches
- L763–767: Conclusion

Demo selectors: `RetroSandpack scene="scene1"`, `RetroSandpack scene="scene2"`, `RetroSandpack scene="scene3"`, `RetroSandpack scene="scene4"`, `RetroSandpack scene="scene5"`, `RetroSandpack scene="scene6"`, `RetroSandpack scene="scene7"`, `RetroSandpack scene="scene8"`, `RetroSandpack scene="scene9"`, `RetroSandpack scene="scene10"`, `RetroSandpack scene="scene11"`, `RetroSandpack scene="scene12"`

- `DitheringVisualizer` → `blog/core/components/MDX/Widgets/Retro/DitheringVisualizer`
- `QuantizationVisualizer` → `blog/core/components/MDX/Widgets/Retro/QuantizationVisualizer`
- `RetroSandpack` → `blog/core/components/MDX/Widgets/Retro/Sandpack`

## Post-Processing Shaders as a Creative Medium

Slug: `post-processing-as-a-creative-medium`

[Article source](corpus/articles/post-processing-as-a-creative-medium.mdx) · [Original article](https://blog.maximeheckel.com/posts/post-processing-as-a-creative-medium/)

- L1–46: Introduction
- L47–52: Intricate Pixel Patterns
- L53–102: Pixelating your scene
- L103–307: Shaping pixels
- L308–442: Complex pixel patterns
- L443–449: Trompe l'œil and other optical illusions
- L450–532: Stagged LED cell panel
- L533–592: Woven Crochet Effect
- L593–641: Lego bricks
- L642–732: Fluted & frosted glass
- L733–736: Dynamic and interactive post-processing
- L737–787: Progressive Depixelation
- L788–890: Pixelating Mouse Trail
- L891–898: Final Thoughts

Demo selectors: `PostProcessingSandpack scene="scene1"`, `PostProcessingSandpack scene="scene2"`, `PostProcessingSandpack scene="scene3"`, `PostProcessingSandpack scene="scene4"`, `PostProcessingSandpack scene="scene5"`, `PostProcessingSandpack scene="scene6"`, `PostProcessingSandpack scene="scene7"`, `PostProcessingSandpack scene="scene8"`, `PostProcessingSandpack scene="scene9"`, `PostProcessingSandpack scene="scene10"`, `PostProcessingSandpack scene="scene11"`, `PostProcessingSandpack scene="scene12"`

- `PixelizationVisualizer` → `blog/core/components/MDX/Widgets/PostProcessing/PixelizationVisualizer`
- `PostProcessingSandpack` → `blog/core/components/MDX/Widgets/PostProcessing/Sandpack`
- `ThresholdVisualizer` → `blog/core/components/MDX/Widgets/PostProcessing/ThresholdVisualizer`

## On Shaping Light

Slug: `shaping-light-volumetric-lighting-with-post-processing-and-raymarching`

[Article source](corpus/articles/shaping-light-volumetric-lighting-with-post-processing-and-raymarching.mdx) · [Original article](https://blog.maximeheckel.com/posts/shaping-light-volumetric-lighting-with-post-processing-and-raymarching/)

- L1–45: Introduction
- L46–51: Raymarching Light with Post-Processing
- L52–115: Coordinate systems and transformations
- L116–253: Our first light ray
- L254–299: Depth-based stopping
- L300–353: Shaping our light ray
- L354–361: Shadow Mapping
- L362–455: Creating a shadow map of our scene
- L456–613: Calculating shadows and occlusion
- L614–617: Light Scattering and other improvements
- L618–782: Phase function and noise
- L783–838: Performance improvements
- L839–844: Elevating your work with light
- L845–878: Arches
- L879–929: Asteroid Belt
- L930–1095: Beyond

Demo selectors: `VolumetricLightingSandpack scene="scene1"`, `VolumetricLightingSandpack scene="scene2"`, `VolumetricLightingSandpack scene="scene3"`, `VolumetricLightingSandpack scene="scene4"`, `VolumetricLightingSandpack scene="scene5"`, `VolumetricLightingSandpack scene="scene6"`, `VolumetricLightingSandpack scene="scene7"`, `VolumetricLightingSandpack scene="scene9"`, `VolumetricLightingSandpack scene="scene10"`, `VolumetricLightingSandpack scene="scene11"`, `VolumetricLightingSandpack scene="scene12"`

- `VolumetricLightingSandpack` → `blog/core/components/MDX/Widgets/VolumetricLighting/Sandpack`

## Field Guide to TSL and WebGPU

Slug: `field-guide-to-tsl-and-webgpu`

[Article source](corpus/articles/field-guide-to-tsl-and-webgpu.mdx) · [Original article](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)

- L1–48: Introduction
- L49–52: Terminology
- L53–156: TSL and WebGPU
- L157–185: The Node System
- L186–189: Writing Shaders for WebGPU with TSL
- L190–254: Using the WebGPU renderer
- L255–478: Displacement and Normals
- L479–738: Glass Material
- L739–772: Compute Shaders
- L773–819: Creating Compute Shaders in TSL
- L820–961: Leveraging compute shaders for your 3D scene
- L962–1018: Workgroup and dispatch sizes
- L1019–1037: Powering Particles with Compute Shaders
- L1038–1126: Setting up our Particle System with Compute Shaders
- L1127–1199: Attractors with Compute Shaders
- L1200–1205: Post-Processing with TSL
- L1206–1327: Setting up custom post-processing effects with TSL on React Three Fiber
- L1328–1418: Post-processing effects with Compute Shaders
- L1419–1546: Final thoughts and what's next

Demo selectors: `TSLWebGPUSandpack scene="scene1"`, `TSLWebGPUSandpack scene="scene2"`, `TSLWebGPUSandpack scene="scene3"`, `TSLWebGPUSandpack scene="scene4"`, `TSLWebGPUSandpack scene="scene5"`, `TSLWebGPUSandpack scene="scene6"`, `TSLWebGPUSandpack scene="scene7"`, `TSLWebGPUSandpack scene="scene8"`

- `EffectCompute` → `blog/core/components/MDX/Widgets/TSLWebGPU/EffectCompute`
- `ParticleCompute` → `blog/core/components/MDX/Widgets/TSLWebGPU/ParticleCompute`
- `SimpleCompute` → `blog/core/components/MDX/Widgets/TSLWebGPU/SimpleCompute`
- `TSLWebGPUSandpack` → `blog/core/components/MDX/Widgets/TSLWebGPU/Sandpack`

## Shades of Halftone

Slug: `shades-of-halftone`

[Article source](corpus/articles/shades-of-halftone.mdx) · [Original article](https://blog.maximeheckel.com/posts/shades-of-halftone/)

- L1–35: Introduction
- L36–51: Behind the Dot Pattern
- L52–111: Rendering a grid of dots
- L112–203: Applying Halftone
- L204–284: Not just dots
- L285–290: Multichannel Halftoning and Interferences
- L291–354: Moiré Pattern
- L355–397: Digital vs Physical color blending
- L398–521: CMYK halftone
- L522–525: Breaking the Grid
- L526–595: Cell wall
- L596–615: Gooey halftone
- L616–676: Displaced dots
- L677–739: Final Thoughts

Demo selectors: `HalftoneSandpack scene="scene1"`, `HalftoneSandpack scene="scene2"`, `HalftoneSandpack scene="scene3"`, `HalftoneSandpack scene="scene4"`

- `CMYKHalftoneDemo` → `blog/core/components/MDX/Widgets/Halftone/CMYKHalftoneDemo`
- `ColorBlending` → `blog/core/components/MDX/Widgets/Halftone/ColorBlending`
- `GooeyDemo` → `blog/core/components/MDX/Widgets/Halftone/GooeyDemo`
- `GridDotsDemo` → `blog/core/components/MDX/Widgets/Halftone/GridDotsDemo`
- `HalftoneSandpack` → `blog/core/components/MDX/Widgets/Halftone/Sandpack`
- `MoireDemo` → `blog/core/components/MDX/Widgets/Halftone/MoireDemo`
- `PatternDemo` → `blog/core/components/MDX/Widgets/Halftone/PatternDemo`
- `Reflectance` → `blog/core/components/MDX/Widgets/Halftone/Reflectance`
- `RingDemo` → `blog/core/components/MDX/Widgets/Halftone/RingDemo`
- `SimpleGridDemo` → `blog/core/components/MDX/Widgets/Halftone/SimpleGridDemo`
- `WhiteDots` → `blog/core/components/MDX/Widgets/Halftone/WhiteDots`

## Shading Motion

Slug: `shading-motion`

[Article source](corpus/articles/shading-motion.mdx) · [Original article](https://blog.maximeheckel.com/posts/shading-motion/)

- L1–32: Introduction
- L33–57: Detecting, Extracting, and Stylizing Motion
- L58–115: Comparing frames
- L116–158: Smooting out the motion
- L159–279: Stylizing the motion
- L280–311: Blob Tracking
- L312–453: Detecting motion blobs
- L454–539: Drawing blobs
- L540–637: Using blobs as masks
- L638–647: Optical Flow
- L648–746: Extracting the direction of motion
- L747–805: Drawing a motion field
- L806–814: Motion Blur
- L815–948: Capturing object motion
- L949–1017: Wagon-wheel effect
- L1018–1080: Afterword

Demo selectors: `ShadingMotionSandpack scene="asciiMotionMask"`, `ShadingMotionSandpack scene="blobTracking"`, `ShadingMotionSandpack scene="blobTrackingSegments"`, `ShadingMotionSandpack scene="blobTrackingEffects"`, `ShadingMotionSandpack scene="opticalFlow"`, `ShadingMotionSandpack scene="velocityMap"`, `ShadingMotionSandpack scene="objectSmear"`

- `BlobTracking` → `blog/core/components/MDX/Widgets/ShadingMotion/BlobTracking`
- `DecorativeMotion` → `blog/core/components/MDX/Widgets/ShadingMotion/DecorativeMotion`
- `DitheredMotionMaskDemo` → `blog/core/components/MDX/Widgets/ShadingMotion/DitheredMotionMaskDemo`
- `MotionMask` → `blog/core/components/MDX/Widgets/ShadingMotion/MotionMask`
- `SDFShapes` → `blog/core/components/MDX/Widgets/SDFShapes`
- `ShadingMotionSandpack` → `blog/core/components/MDX/Widgets/ShadingMotion/Sandpack`

## On Rendering the Sky, Sunsets, and Planets

Slug: `on-rendering-the-sky-sunsets-and-planets`

[Article source](corpus/articles/on-rendering-the-sky-sunsets-and-planets.mdx) · [Original article](https://blog.maximeheckel.com/posts/on-rendering-the-sky-sunsets-and-planets/)

- L1–53: Introduction
- L54–61: How to Render a Sky
- L62–196: Sampling Atmospheric Density
- L197–311: Mie Scattering and Ozone
- L312–375: Light and Transmittance
- L376–383: Planetary Atmosphere
- L384–494: World-space reconstruction, Depth, and Atmospheric Fog
- L495–669: Rendering Planets
- L670–764: Handling eclipses
- L765–814: Outer-Worldly Atmosphere
- L815–842: LUT Based Atmospheric Scattering
- L843–931: Transmittance LUT
- L932–1078: Sky View and Aerial Perspective LUTs
- L1079–1145: Composition
- L1146–1202: Final Thoughts

Demo selectors: `AtmosphericScatteringSandpack scene="scene1"`, `AtmosphericScatteringSandpack scene="scene2"`, `AtmosphericScatteringSandpack scene="scene3"`, `AtmosphericScatteringSandpack scene="scene4"`

- `AtmosphericScatteringSandpack` → `blog/core/components/MDX/Widgets/AtmosphericScattering/Sandpack`
- `Density` → `blog/core/components/MDX/Widgets/AtmosphericScattering/Density`
- `LightDensity` → `blog/core/components/MDX/Widgets/AtmosphericScattering/LightDensity`
- `Lightmarching` → `blog/core/components/MDX/Widgets/AtmosphericScattering/Lightmarching`
- `MieOzoneDensity` → `blog/core/components/MDX/Widgets/AtmosphericScattering/MieOzoneDensity`
- `RaySphereIntersect` → `blog/core/components/MDX/Widgets/AtmosphericScattering/RaySphereIntersect`
- `RaySphereIntersectPlanet` → `blog/core/components/MDX/Widgets/AtmosphericScattering/RaySphereIntersect`
- `RayleighDensity` → `blog/core/components/MDX/Widgets/AtmosphericScattering/RayleighDensity`
- `TransmittanceLUT` → `blog/core/components/MDX/Widgets/AtmosphericScattering/TransmittanceLUT`

## Learning in public

Slug: `learning-in-public`

[Article source](corpus/articles/learning-in-public.mdx) · [Original article](https://blog.maximeheckel.com/posts/learning-in-public/)

- L1–25: Introduction
- L26–33: How I plan to share what I learn
- L34–161: My list

Demo selectors: 


## Speaking at Figma Config 2025

Slug: `config-2025`

[Article source](corpus/articles/config-2025.mdx) · [Original article](https://blog.maximeheckel.com/posts/config-2025/)

- L1–17: Introduction
- L18–30: Talk
- L31–34: Resources
- L35–42: Paid Courses
- L43–56: Free resources and inspiring work around the Web
- L57–60: Discord servers

Demo selectors: 


## Building a Design System from scratch

Slug: `building-a-design-system-from-scratch`

[Article source](corpus/articles/building-a-design-system-from-scratch.mdx) · [Original article](https://blog.maximeheckel.com/posts/building-a-design-system-from-scratch/)

- L1–51: Introduction
- L52–66: Context: Why would I even choose to build my own design system?
- L67–70: Tokens
- L71–100: Color system
- L101–151: Other tokens
- L152–160: Lessons learned
- L161–180: Component patterns
- L181–303: Variant driven components
- L304–342: Utility components
- L343–410: Compound components
- L411–502: Polymorphism and composition
- L503–516: Make it shine!
- L517–524: Packaging and shipping
- L525–541: Versioning
- L542–545: File structure
- L546–637: Bundling
- L638–665: Releasing
- L666–679: Conclusion

Demo selectors: 

- `DesignSystemColorTokens` → `blog/core/components/MDX/Widgets/DesignSystem/ColorTokens`
- `DesignSystemFlexGridShowcase` → `blog/core/components/MDX/Widgets/DesignSystem/FlexGridShowcase`
- `DesignSystemMicroInteractionShowcase` → `blog/core/components/MDX/Widgets/DesignSystem/MicroInteractionShowcase`
- `DesignSystemTextShowcase` → `blog/core/components/MDX/Widgets/DesignSystem/TextShowcase`

## Cubic Bézier: from math to motion

Slug: `cubic-bezier-from-math-to-motion`

[Article source](corpus/articles/cubic-bezier-from-math-to-motion.mdx) · [Original article](https://blog.maximeheckel.com/posts/cubic-bezier-from-math-to-motion/)

- L1–34: Introduction
- L35–44: The math behind Bézier curves
- L45–68: Linear Interpolation
- L69–132: Quadratic Bézier
- L133–200: Cubic Bézier
- L201–265: Visualizing the motion
- L266–269: Easing functions
- L270–289: Cubic Béziers, Cubic Béziers everywhere
- L290–328: Cubic Bézier in Framer Motion
- L329–359: Conclusion

Demo selectors: 

- `BezierCurve` → `blog/core/components/MDX/Widgets/BezierCurve`
- `CubicBezierVisualizer` → `blog/core/components/MDX/Widgets/CubicBezierVisualizer`

## The physics behind spring animations

Slug: `the-physics-behind-spring-animations`

[Article source](corpus/articles/the-physics-behind-spring-animations.mdx) · [Original article](https://blog.maximeheckel.com/posts/the-physics-behind-spring-animations/)

- L1–34: Introduction
- L35–117: Hooke's Law
- L118–173: Translating the maths to Javascript
- L174–257: Taking damping into account
- L258–282: A real-life example

Demo selectors: 

- `SpringAnimationSandpack` → `blog/core/components/MDX/Widgets/SpringAnimation/Sandpack`
- `SpringPhysics` → `blog/core/components/MDX/Widgets/SpringAnimation/SpringPhysics`

## Scrollspy demystified

Slug: `scrollspy-demystified`

[Article source](corpus/articles/scrollspy-demystified.mdx) · [Original article](https://blog.maximeheckel.com/posts/scrollspy-demystified/)

- L1–42: Introduction
- L43–48: It's all about knowing what's intersecting the viewport
- L49–58: What is the Intersection Observer API?
- L59–82: How can it be used in the context of a Scrollspy?
- L83–107: Why use this rather than a scroll event and detecting if the element's scroll position fits in the viewport?
- L108–120: Abstracting the implementation in a React Hook
- L121–153: First steps with Intersection Observers
- L154–270: Building an efficient Hook
- L271–389: Handling offsets and custom settings
- L390–407: Markdown and MDX integration
- L408–469: My solution to this: sectionize my content with remark plugins
- L470–539: Wiring up everything

Demo selectors: 

- `HighlightSection` → `blog/core/components/MDX/Widgets/Scrollspy/HighlightSection`
- `ScrollSpySandpack` → `blog/core/components/MDX/Widgets/Scrollspy/Sandpack`
- `ScrollSpyWidget` → `blog/core/components/MDX/Widgets/Scrollspy/ScrollSpyWidget`

## Guide to creating animations that spark joy with Framer Motion

Slug: `guide-animations-spark-joy-framer-motion`

[Article source](corpus/articles/guide-animations-spark-joy-framer-motion.mdx) · [Original article](https://blog.maximeheckel.com/posts/guide-animations-spark-joy-framer-motion/)

- L1–40: Introduction
- L41–122: Anatomy of an animation
- L123–211: Using variants
- L212–221: Advanced animations using Motion Values
- L222–232: Motion Values
- L233–372: Dissecting the "Copy To Clipboard" animation
- L373–379: Orchestration
- L380–394: Delays and repetition
- L395–494: Parent-Children
- L495–513: Conclusion

Demo selectors: 

- `AnimationTypes` → `blog/core/components/MDX/Widgets/GuideToFramerMotion/AnimationTypes`
- `ClipboardAnimationDetails` → `blog/core/components/MDX/Widgets/GuideToFramerMotion/ClipboardAnimationDetails`
- `GuideToFramerMotionSandpack` → `blog/core/components/MDX/Widgets/GuideToFramerMotion/Sandpack`
- `Orchestration` → `blog/core/components/MDX/Widgets/GuideToFramerMotion/Orchestration`

## Advanced animation patterns with Framer Motion

Slug: `advanced-animation-patterns-with-framer-motion`

[Article source](corpus/articles/advanced-animation-patterns-with-framer-motion.mdx) · [Original article](https://blog.maximeheckel.com/posts/advanced-animation-patterns-with-framer-motion/)

- L1–37: Introduction
- L38–94: Propagation
- L95–191: Animate components when they are unmounting
- L192–208: Layout animations
- L209–236: What is a "layout animation"?
- L237–323: Shared Layout Animation
- L324–342: Conclusion

Demo selectors: 

- `AdvancedFramerMotionSandpack` → `blog/core/components/MDX/Widgets/AdvancedFramerMotion/Sandpack`
- `FramerMotionAnimatePresence` → `blog/core/components/MDX/Widgets/AdvancedFramerMotion/FramerMotionAnimatePresence`
- `FramerMotionAnimationLayout` → `blog/core/components/MDX/Widgets/AdvancedFramerMotion/FramerMotionAnimationLayout`
- `FramerMotionPropagation` → `blog/core/components/MDX/Widgets/AdvancedFramerMotion/FramerMotionPropagation`

## Everything about Framer Motion layout animations

Slug: `framer-motion-layout-animations`

[Article source](corpus/articles/framer-motion-layout-animations.mdx) · [Original article](https://blog.maximeheckel.com/posts/framer-motion-layout-animations/)

- L1–48: Introduction
- L49–52: Layout animations fundamentals
- L53–104: A brief refresher on layout animations
- L105–119: Fixing distortions
- L120–150: More about the layout prop
- L151–167: Shared layout animations and LayoutGroup
- L168–206: Shared layout animations
- L207–239: LayoutGroup: the namespacing use case
- L240–273: LayoutGroup: the grouping use case
- L274–359: Reorder
- L360–437: Combining everything
- L438–447: Conclusion

Demo selectors: 

- `FramerMotionAdvanceReorderExample` → `blog/core/components/MDX/Widgets/FramerMotionLayoutAnimations/AdvanceReorderExample`
- `FramerMotionArrowListSandpack` → `blog/core/components/MDX/Widgets/FramerMotionLayoutAnimations/SandpackArrowList`
- `FramerMotionDistortions` → `blog/core/components/MDX/Widgets/FramerMotionLayoutAnimations/Distortions`
- `FramerMotionLayoutAnimationListLayoutGroup` → `blog/core/components/MDX/Widgets/FramerMotionLayoutAnimations/ListLayoutGroup`
- `FramerMotionLayoutAnimationsBasic` → `blog/core/components/MDX/Widgets/FramerMotionLayoutAnimations/Basic`
- `FramerMotionLayoutAnimationsLayoutPosition` → `blog/core/components/MDX/Widgets/FramerMotionLayoutAnimations/LayoutPosition`
- `FramerMotionLayoutAnimationsLayoutProp` → `blog/core/components/MDX/Widgets/FramerMotionLayoutAnimations/LayoutProp`
- `FramerMotionLayoutAnimationsSharedLayoutAnimationDetails` → `blog/core/components/MDX/Widgets/FramerMotionLayoutAnimations/SharedLayoutAnimationDetails`
- `FramerMotionLayoutAnimationsTabsLayoutGroup` → `blog/core/components/MDX/Widgets/FramerMotionLayoutAnimations/TabsLayoutGroup`
- `FramerMotionTabsSandpack` → `blog/core/components/MDX/Widgets/FramerMotionLayoutAnimations/SandpackTabs`
- `FramerMotionToastNotificationSandpack` → `blog/core/components/MDX/Widgets/FramerMotionLayoutAnimations/SandpackNotification`

## The Power of Composition with CSS Variables

Slug: `the-power-of-composition-with-css-variables`

[Article source](corpus/articles/the-power-of-composition-with-css-variables.mdx) · [Original article](https://blog.maximeheckel.com/posts/the-power-of-composition-with-css-variables/)

- L1–31: Introduction
- L32–33: Building good CSS habits by using CSS variables and HSLA colors
- L34–61: Overreliance on ThemeProviders to manage my themes and colors
- L62–128: A mess of HEX and RGBA
- L129–160: Defining meaningful colors through composition
- L161–200: Color scale
- L201–266: Organizing variables: giving meaning to colors
- L267–336: Advanced composition patterns
- L337–343: Conclusion

Demo selectors: 

- `CSSCompositionSandpack` → `blog/core/components/MDX/Widgets/CSSComposition/Sandpack`
- `HSLAShowcase` → `blog/core/components/MDX/Widgets/CSSComposition/HSLAShowcase`
- `PaletteGenerator` → `blog/core/components/MDX/Widgets/CSSComposition/PaletteGenerator`
- `ThemePicker` → `blog/core/components/MDX/Widgets/CSSComposition/ThemePicker`
