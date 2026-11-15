uniform vec4 uFlow;
uniform vec4 uView;
uniform vec4 uClock;
layout(location=0) out vec4 fragColor;
const float TAU=6.28318530718;
vec2 velocity(vec2 p){return uFlow.x*vec2(sin(TAU*p.x)*cos(TAU*p.y),-cos(TAU*p.x)*sin(TAU*p.y));}
void main(){
    vec2 p=vUV.st;vec2 pigments=texture(sTD2DInputs[0],p).rg;
    int stage=int(uView.x+0.5);vec3 color;
    if(stage==1)color=vec3(pigments,0.0);
    else if(stage==2)color=vec3(0.5+velocity(p)*1.5,0.25);
    else if(stage==3){vec2 mid=p-0.5*uClock.y*velocity(p);color=vec3(fract(p-uClock.y*velocity(mid)),0.2);}
    else{
        // @begin pigment
        vec3 paper=vec3(0.93,0.88,0.76);
        vec3 opticalDepth=pigments.x*vec3(3.0,0.7,0.25)+pigments.y*vec3(0.25,1.7,2.6);
        color=paper*exp(-opticalDepth*2.5);
        // @end pigment
    }
    fragColor=TDOutputSwizzle(vec4(color,1.0));
}
