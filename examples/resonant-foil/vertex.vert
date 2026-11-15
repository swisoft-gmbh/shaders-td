uniform vec4 uSurface; // amplitude, frequency, corrected normals, stage
uniform vec4 uClock;
out vec3 vWorldPosition;
out vec3 vWorldNormal;
out vec3 vCorrectNormal;
out vec3 vOldNormal;
out float vWave;
void main(){
    vec3 p=TDPos();vec3 n=normalize(TDNormal());
    // @begin displacement
    float a=uSurface.x,f=uSurface.y,t=uClock.x;
    float sx=sin(f*p.x+t),cx=cos(f*p.x+t);
    float sz=sin(f*p.z-0.7*t),cz=cos(f*p.z-0.7*t);
    float wave=a*sx*cz;
    vec3 displaced=p+vec3(0.0,wave,0.0);
    // @end displacement
    // @begin jacobian
    float gx=a*f*cx*cz;
    float gz=-a*f*sx*sz;
    vec3 corrected=abs(a)<1e-8 ? n : normalize(vec3(n.x-gx*n.y,n.y,n.z-gz*n.y));
    // @end jacobian
    // @begin transforms
    vec4 world=TDDeform(vec4(displaced,1.0));
    vWorldPosition=world.xyz;
    vCorrectNormal=normalize(TDDeformNorm(corrected));
    vOldNormal=normalize(TDDeformNorm(n));
    vWorldNormal=uSurface.z>0.5?vCorrectNormal:vOldNormal;
    vWave=wave;
    gl_Position=TDWorldToProj(world);
    // @end transforms
}
