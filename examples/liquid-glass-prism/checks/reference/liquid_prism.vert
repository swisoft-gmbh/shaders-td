// Liquid Glass Prism: GLSL MAT vertex shader for TouchDesigner (GLSL 4.60).
// Pair it with liquid_prism.frag. Both materials (the glass and the optional
// back-face pass) use this same file. It only moves data to the pixel stage,
// and supports Render Pick DAT/CHOP picking (TouchDesigner's documented pattern).

out vec3 vWorldPos;     // surface position in world space
out vec3 vWorldNormal;  // surface normal in world space (zero if the SOP has none)
out vec3 vObjPos;       // position in the object's own space, so liquid ripples stick to it
flat out int vCamIndex; // which camera of this render pass (the pixel stage cannot ask)

void main()
{
    // @begin transforms
    vObjPos = TDPos();
    vec4 world = TDDeform(vObjPos);
    gl_Position = TDWorldToProj(world);
#ifndef TD_PICKING_ACTIVE
    vWorldPos = world.xyz;
    vWorldNormal = TDDeformNorm(TDNormal());
    vCamIndex = TDCameraIndex();
#else
    // A Render Pick DAT or CHOP is rendering: TouchDesigner writes what it needs.
    TDWritePickingValues();
#endif
    // @end transforms
}
