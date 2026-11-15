uniform vec4 uFlow; // speed UV/s, decay /s, source rate /s, reset
uniform vec4 uView; // stage, seed fixture
uniform vec4 uClock; // time, dt, pause
layout(location=0) out vec4 fragColor;
const float TAU=6.28318530718;
// @begin velocity
vec2 velocity(vec2 p){
    return uFlow.x*vec2(sin(TAU*p.x)*cos(TAU*p.y),-cos(TAU*p.x)*sin(TAU*p.y));
}
// @end velocity
// @begin sample
ivec2 wrapCell(ivec2 p,ivec2 size){return (p%size+size)%size;}
vec2 periodicSample(vec2 uv){
    ivec2 size=textureSize(sTD2DInputs[0],0);
    vec2 pixel=fract(uv)*vec2(size)-0.5;
    ivec2 base=ivec2(floor(pixel));vec2 w=fract(pixel);
    vec2 a=texelFetch(sTD2DInputs[0],wrapCell(base,size),0).rg;
    vec2 b=texelFetch(sTD2DInputs[0],wrapCell(base+ivec2(1,0),size),0).rg;
    vec2 c=texelFetch(sTD2DInputs[0],wrapCell(base+ivec2(0,1),size),0).rg;
    vec2 d=texelFetch(sTD2DInputs[0],wrapCell(base+ivec2(1,1),size),0).rg;
    return mix(mix(a,b,w.x),mix(c,d,w.x),w.y);
}
// @end sample
vec2 seedAt(vec2 p){
    if(uView.y>1.5)return vec2(0.0);
    if(uView.y>0.5)return vec2(0.25,0.6);
    return vec2(exp(-pow((p.x-0.3)/0.055,2.0))*smoothstep(0.1,0.2,p.y)*(1.0-smoothstep(0.8,0.9,p.y)),
                exp(-pow((p.y-0.65)/0.045,2.0))*smoothstep(0.1,0.2,p.x)*(1.0-smoothstep(0.8,0.9,p.x)));
}
void main(){
    vec2 p=vUV.st;
    ivec2 pixel=ivec2(p*vec2(textureSize(sTD2DInputs[0],0)));
    vec4 previous=texelFetch(sTD2DInputs[0],pixel,0);
    // @begin lifecycle
    if(uFlow.w>0.5 || previous.a<0.5){fragColor=TDOutputSwizzle(vec4(seedAt(p),0.0,1.0));return;}
    if(uClock.z>0.5){fragColor=TDOutputSwizzle(previous);return;}
    // @end lifecycle
    // @begin transport
    float dt=clamp(uClock.y,0.001,0.1);
    vec2 midpoint=p-0.5*dt*velocity(p);
    vec2 departure=p-dt*velocity(midpoint);
    vec2 transported=uFlow.x<1e-8 ? previous.rg : periodicSample(departure);
    vec2 ink=transported*exp(-uFlow.y*dt);
    vec2 source=vec2(exp(-dot(p-vec2(0.25,0.26),p-vec2(0.25,0.26))*1200.0),
                     exp(-dot(p-vec2(0.72,0.7),p-vec2(0.72,0.7))*1200.0));
    ink=clamp(ink+source*uFlow.z*dt,0.0,1.0);
    fragColor=TDOutputSwizzle(vec4(ink,0.0,1.0));
    // @end transport
}
