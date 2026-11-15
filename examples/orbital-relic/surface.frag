uniform vec4 uShape; // blend radius, rotation, step budget, analytic sphere fixture
uniform vec4 uView;  // stage
uniform vec4 uClock;
layout(location=0) out vec4 fragColor;
const float EPSILON=0.001;
mat2 rotate2(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
// @begin scene
float joinDistance(float a,float b,float k){
    if(k<0.00001) return min(a,b);
    float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0);
    return mix(b,a,h)-k*h*(1.0-h);
}
float scene(vec3 p){
    if(uShape.w>0.5) return length(p)-0.7;
    p.xz=rotate2(uShape.y+0.16*uClock.x)*p.xz;
    vec3 q=p; q.yz=rotate2(0.7)*q.yz;
    float ring=length(vec2(length(q.xz)-0.67,q.y))-0.16;
    float a=length(p-vec3(0.56,0.27,0.0))-0.34;
    float b=length(p-vec3(-0.51,-0.25,0.18))-0.28;
    return joinDistance(joinDistance(ring,a,uShape.x),b,uShape.x);
}
// @end scene
// @begin march
bool trace(vec3 ro,vec3 rd,out float distanceTravelled,out int steps){
    distanceTravelled=0.0; steps=0;
    int budget=int(clamp(uShape.z,8.0,192.0));
    for(int i=0;i<192;i++){
        if(i>=budget) break;
        float d=scene(ro+rd*distanceTravelled);
        steps=i+1;
        if(d<EPSILON) return true;
        distanceTravelled+=max(d*0.85,0.0001);
        if(distanceTravelled>8.0) break;
    }
    return false;
}
// @end march
// @begin normal
vec3 normalAt(vec3 p){
    vec2 e=vec2(0.001,0.0);
    return normalize(vec3(scene(p+e.xyy)-scene(p-e.xyy),
                          scene(p+e.yxy)-scene(p-e.yxy),
                          scene(p+e.yyx)-scene(p-e.yyx)));
}
// @end normal
void main(){
    vec2 uv=(vUV.st-0.5)*2.0;
    uv.x*=uTDOutputInfo.res.z/uTDOutputInfo.res.w;
    vec3 ro=vec3(0.0,0.0,3.1),rd=normalize(vec3(uv,-2.25));
    float t; int steps; bool hit=trace(ro,rd,t,steps);
    int stage=int(uView.x+0.5);
    vec3 color=mix(vec3(0.012,0.025,0.045),vec3(0.085,0.12,0.15),0.5+0.5*uv.y);
    if(stage==2){float f=float(steps)/max(uShape.z,1.0);color=vec3(f,f*f,hit?0.12:0.5);}
    else if(stage==3) color=vec3(hit?1.0:0.0);
    else if(hit){
        vec3 p=ro+t*rd,n=normalAt(p);
        if(stage==1) color=0.5+0.5*n;
        else{
            // @begin shade
            vec3 light=normalize(vec3(-0.7,0.9,1.3));
            float diffuse=max(dot(n,light),0.0);
            float rim=pow(1.0-max(dot(n,-rd),0.0),3.0);
            float pigment=0.5+0.5*sin(5.0*p.y+2.0*p.x);
            vec3 base=mix(vec3(0.055,0.29,0.36),vec3(0.79,0.39,0.15),smoothstep(0.25,0.8,pigment));
            color=base*(0.18+0.82*diffuse)+vec3(0.18,0.3,0.38)*rim;
            // @end shade
        }
    }
    fragColor=TDOutputSwizzle(vec4(color,1.0));
}
