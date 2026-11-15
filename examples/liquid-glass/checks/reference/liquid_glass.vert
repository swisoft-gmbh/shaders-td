// Liquid Glass: GLSL MAT vertex shader for TouchDesigner (GLSL 4.60).
// Pair it with liquid_glass.frag. It only moves data to the pixel stage;
// all the glass work happens per pixel.

out vec3 vWorldPos;     // surface position in world space
out vec3 vWorldNormal;  // surface normal in world space, or zero when the geometry has none
out vec3 vObjPos;       // position in the object's own space, so liquid ripples stick to it
flat out int vCamIndex; // which camera of this render pass (pixel stage cannot ask)

void main()
{
    // @begin transforms
    vObjPos = TDPos();
    vec4 world = TDDeform(vObjPos);
    vWorldPos = world.xyz;
    // Decide before transforming: a missing normal stays exactly zero (the pixel
    // stage then builds faceted normals) instead of risking a NaN.
    vec3 objNormal = TDNormal();
    vWorldNormal = dot(objNormal, objNormal) > 1e-12 ? TDDeformNorm(objNormal) : vec3(0.0);
    vCamIndex = TDCameraIndex();
    gl_Position = TDWorldToProj(world);
    // @end transforms
}
