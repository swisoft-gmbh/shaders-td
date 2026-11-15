// Demo backdrop card: GLSL MAT pixel shader for TouchDesigner (GLSL 4.60).
// Demo only. Shows the backdrop TOP unchanged across the demo scene render.

uniform sampler2D sBackdrop;

in vec2 vCardUV;

layout(location = 0) out vec4 fragColor;

void main()
{
    TDCheckDiscard();
    fragColor = TDOutputSwizzle(vec4(texture(sBackdrop, vCardUV).rgb, 1.0));
}
