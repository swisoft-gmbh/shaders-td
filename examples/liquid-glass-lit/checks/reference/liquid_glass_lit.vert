// Liquid Glass Lit: GLSL MAT vertex shader for TouchDesigner (GLSL 4.60).
// Pair it with liquid_glass_lit.frag. It only moves data to the pixel stage;
// lighting and glass happen per pixel. Same as the core study's vertex shader.

out vec3 vWorldPos;     // surface position in world space (TouchDesigner lights work here)
out vec3 vWorldNormal;  // surface normal in world space (zero if the SOP has none)
out vec3 vObjPos;       // position in the object's own space, so liquid ripples stick to it
flat out int vCamIndex; // which camera of this render pass (pixel stage cannot ask)

void main()
{
    // @begin transforms
    vObjPos = TDPos();
    vec4 world = TDDeform(vObjPos);
    vWorldPos = world.xyz;
    vWorldNormal = TDDeformNorm(TDNormal());
    vCamIndex = TDCameraIndex();
    gl_Position = TDWorldToProj(world);
    // @end transforms
}
