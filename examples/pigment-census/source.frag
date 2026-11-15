uniform vec4 uSource; // grain amplitude, fixture selector
uniform vec4 uClock;
layout(location=0) out vec4 fragColor;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
    vec2 uv=vUV.st;int mode=int(uSource.y+0.5);
    vec3 color;
    // @begin fixture
    if(mode==1) color=vec3(step(0.5,uv.x));
    else if(mode==2) color=vec3(0.23,0.46,0.69);
    else{
        float t=uClock.x*0.08;
        color=mix(vec3(0.12,0.24,0.42),vec3(0.98,0.72,0.45),uv.y);
        float sun=1.0-smoothstep(0.12,0.125,length(uv-vec2(0.7,0.72)));
        color=mix(color,vec3(1.0,0.84,0.54),sun);
        for(int i=4;i>=0;i--){
            float k=float(i),height=0.19+k*0.1+0.07*sin(uv.x*(5.0+k)+k+t)+0.025*cos(uv.x*19.0-k);
            float mask=1.0-smoothstep(height-0.002,height+0.002,uv.y);
            vec3 pigment=mix(vec3(0.04,0.19,0.24),vec3(0.64,0.31,0.2),k/4.0);
            color=mix(color,pigment,mask*0.88);
        }
        vec2 cell=floor(uv*uTDOutputInfo.res.zw);
        color+=uSource.x*(hash(cell)-0.5);
    }
    // @end fixture
    fragColor=TDOutputSwizzle(vec4(clamp(color,0.0,1.0),1.0));
}
