// Demo backdrop card: GLSL MAT vertex shader for TouchDesigner (GLSL 4.60).
// Demo only. It stretches a rectangle SOP over the whole demo scene render and
// pushes it to the far plane, so the 2D backdrop sits behind everything. That
// makes demo_scene a real 3D scene render that the glass's Render Pass TOP
// builds on, as in "Use it in your own lit scene". Pair it with card.frag.

out vec2 vCardUV;  // 0..1 across the render, 1 at the top

void main()
{
    // The rectangle is centred on the origin, so sign() turns its four corners
    // into the corners of the render whatever its size. 1.01 reaches just past
    // the edges so no pixel is missed.
    vec2 corner = sign(TDPos().xy) * 1.01;
    vCardUV = corner * 0.5 + 0.5;

    // Place the corner one unit in front of the camera, where it covers that
    // corner of the view (perspective or orthographic), then let TouchDesigner
    // project it like any other geometry.
    int cam = TDCameraIndex();
    mat4 proj = uTDMats[cam].proj;
    vec3 view = vec3(corner / abs(vec2(proj[0][0], proj[1][1])), -1.0);
    gl_Position = TDWorldToProj(uTDMats[cam].camInverse * vec4(view, 1.0));
    gl_Position.z = 0.999 * gl_Position.w;  // at the far plane: everything else draws in front
}
