// Liquid Glass Prism: GLSL MAT vertex shader for TouchDesigner (GLSL 4.60).
// Pair it with liquid_prism.frag. Both materials (the glass and the optional
// back-face pass) use this same file. It only moves data to the pixel stage.
// Render Pick DAT and CHOP passes use the picking form printed on Derivative's
// Write a GLSL MAT page: while picking, the point is still placed, and of the
// branch only the #else block runs.

out vec3 vWorldPos;     // surface position in world space
out vec3 vWorldNormal;  // surface normal in world space, or zero when the geometry has none
out vec3 vObjPos;       // position in the object's own space, so liquid ripples stick to it
flat out int vCamIndex; // which camera of this render pass (the pixel stage cannot ask)

void main()
{
    // @begin transforms
    // Every render places the point, a pick render too.
    vec3 objPos = TDPos();
    vec4 world = TDDeform(objPos);
    gl_Position = TDWorldToProj(world);
#ifndef TD_PICKING_ACTIVE
    vObjPos = objPos;
    vWorldPos = world.xyz;
    // Decide before transforming: a missing normal stays exactly zero (the pixel
    // stage then builds faceted normals) instead of risking a NaN.
    vec3 objNormal = TDNormal();
    vWorldNormal = dot(objNormal, objNormal) > 1e-12 ? TDDeformNorm(objNormal) : vec3(0.0);
    vCamIndex = TDCameraIndex();
#else
    // A Render Pick DAT or CHOP is drawing: TouchDesigner sets
    // TD_PICKING_ACTIVE, so of the branch only this block runs. Its default
    // pick values are right, because the points move only through TDDeform.
    TDWritePickingValues();
#endif
    // @end transforms
}
