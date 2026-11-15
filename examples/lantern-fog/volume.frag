uniform vec4 uVolume; // extinction, steps, light visibility strength, slab fixture
uniform vec4 uView;
uniform vec4 uClock;
layout(location=0) out vec4 fragColor;
// @begin density
float density(vec3 p){
    if(any(greaterThan(abs(p),vec3(1.5)))) return 0.0;
    if(uVolume.w>0.5) return 0.4;
    float t=uClock.x*0.24;
    vec2 center=0.48*vec2(cos(2.1*p.y+t),sin(2.1*p.y+t));
    float r1=length(p.xz-center);
    float r2=length(p.xz+center*0.85);
    float envelope=1.0-smoothstep(0.85,1.4,abs(p.y));
    float detail=0.65+0.35*sin(8.0*p.x+3.0*sin(4.0*p.z)+3.0*p.y-t);
    return (exp(-r1*r1*19.0)+0.7*exp(-r2*r2*28.0))*envelope*detail;
}
// @end density
// @begin light
float lightVisibility(vec3 p){
    vec3 direction=normalize(vec3(-0.8,0.55,0.7));
    float opticalDepth=0.0;
    const float stepLength=0.25;
    for(int j=0;j<12;j++){
        opticalDepth+=density(p+direction*(float(j)+0.5)*stepLength)*stepLength;
    }
    return exp(-uVolume.x*opticalDepth);
}
// @end light
void main(){
    vec2 p=(vUV.st-0.5)*3.1;
    p.x*=uTDOutputInfo.res.z/uTDOutputInfo.res.w;
    int stage=int(uView.x+0.5);
    vec3 color;
    if(stage==1) color=vec3(density(vec3(p,0.0)));
    else if(stage==3) color=vec3(lightVisibility(vec3(p,0.0)));
    else{
        // @begin integrate
        int count=int(clamp(uVolume.y,16.0,128.0));
        float ds=3.0/float(count);
        float transmission=1.0;
        vec3 radiance=vec3(0.0);
        for(int i=0;i<128;i++){
            if(i>=count) break;
            vec3 samplePoint=vec3(p,1.5-(float(i)+0.5)*ds);
            float rho=density(samplePoint);
            float segmentT=exp(-uVolume.x*rho*ds);
            if(rho>0.001 && stage!=2){
                float visibility=mix(1.0,lightVisibility(samplePoint),uVolume.z);
                vec3 source=vec3(0.055,0.09,0.2)+vec3(1.3,0.69,0.27)*visibility;
                radiance+=transmission*(1.0-segmentT)*source;
            }
            transmission*=segmentT;
        }
        // @end integrate
        // @begin composite
        vec3 background=mix(vec3(0.012,0.02,0.055),vec3(0.09,0.025,0.1),vUV.y);
        color=stage==2 ? vec3(transmission) : radiance+transmission*background;
        // @end composite
    }
    fragColor=TDOutputSwizzle(vec4(color,1.0));
}
