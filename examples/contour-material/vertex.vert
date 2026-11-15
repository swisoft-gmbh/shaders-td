out vec3 objectPosition;
out vec3 worldPosition;
// @begin transforms
void main() {
    objectPosition = TDPos();
    vec4 world = TDDeform(objectPosition);
    worldPosition = world.xyz;
    gl_Position = TDWorldToProj(world);
}
// @end transforms
