uniform vec4 uSurface;
uniform vec4 uClock;
in vec3 vWorldPosition;
in vec3 vWorldNormal;
in vec3 vCorrectNormal;
in vec3 vOldNormal;
in float vWave;
layout(location=0) out vec4 fragColor;
void main(){
    vec3 n=normalize(vWorldNormal);
    if(!gl_FrontFacing)n=-n;
    int stage=int(uSurface.w+0.5);vec3 color;
    if(stage==1)color=0.5+0.5*n;
    else if(stage==2)color=mix(vec3(0.04,0.22,0.55),vec3(0.98,0.52,0.12),0.5+vWave/(2.0*max(uSurface.x,0.0001)));
    else if(stage==3)color=vec3(0.5*(1.0-dot(normalize(vCorrectNormal),normalize(vOldNormal))),0.0,0.0);
    else{
        // @begin lighting
        vec3 view=normalize(vec3(0.0,0.0,4.2)-vWorldPosition);
        vec3 light=normalize(vec3(-0.5,0.85,1.2));
        float diffuse=max(dot(n,light),0.0);
        float specular=pow(max(dot(n,normalize(light+view)),0.0),48.0);
        float rim=pow(1.0-max(dot(n,view),0.0),3.0);
        float stripe=0.5+0.5*sin(9.0*vWorldPosition.y+3.0*n.x);
        vec3 pigment=mix(vec3(0.045,0.21,0.39),vec3(0.7,0.3,0.11),smoothstep(0.25,0.8,stripe));
        color=pigment*(0.16+0.84*diffuse)+vec3(0.9,0.75,0.45)*specular+vec3(0.1,0.22,0.38)*rim;
        // @end lighting
    }
    fragColor=TDOutputSwizzle(vec4(color,1.0));
}
