// Liquid Glass Blobs: GLSL MAT vertex shader for TouchDesigner (GLSL 4.60).
// Pair it with blobs.frag. The geometry is only a proxy box (Box SOP, size 2):
// it marks which pixels might show a blob. The blobs themselves are drawn
// per pixel by blobs.frag. Render Pick DAT and CHOP passes use the picking
// form printed on Derivative's Write a GLSL MAT page.

out vec3 vWorldPos;        // this corner of the proxy box, world space
flat out vec3 vObjOrigin;  // where the object's origin lands in world space
flat out vec3 vObjX;       // where the object's x, y and z axes point in world space
flat out vec3 vObjY;       //   (scaled), so the pixel shader can move rays
flat out vec3 vObjZ;       //   between world space and the box's own space
flat out int vCamIndex;    // which camera of this render pass (pixel stage cannot ask)
flat out int vInstance;    // instance number, so each instance gets its own layout

void main()
{
    // @begin proxy
    vec4 world = TDDeform(vec4(TDPos(), 1.0));
    gl_Position = TDWorldToProj(world);
#ifndef TD_PICKING_ACTIVE
    vWorldPos = world.xyz;

    // Push the object's origin and axes through the same deform. This picks up
    // the Geometry COMP transform, its parents and any instance transform,
    // without the shader having to know which of them apply.
    vObjOrigin = TDDeform(vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vObjX = TDDeform(vec4(1.0, 0.0, 0.0, 1.0)).xyz - vObjOrigin;
    vObjY = TDDeform(vec4(0.0, 1.0, 0.0, 1.0)).xyz - vObjOrigin;
    vObjZ = TDDeform(vec4(0.0, 0.0, 1.0, 1.0)).xyz - vObjOrigin;

    vCamIndex = TDCameraIndex();
    vInstance = TDInstanceID();
#else
    // A Render Pick DAT or CHOP is rendering. TouchDesigner sets
    // TD_PICKING_ACTIVE and runs only this block (Write a GLSL MAT, Picking).
    // Its default pick values describe the proxy box, not the blob inside it.
    TDWritePickingValues();
#endif
    // @end proxy
}
