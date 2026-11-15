uniform vec4 uSeed;
layout(location=0) out vec4 fragColor;
// @begin seed
void main(){
    vec2 p=vUV.st;
    vec2 pigments=vec2(0.0);
    if(uSeed.x<0.5){
        pigments.x=exp(-pow((p.x-0.3)/0.055,2.0))*smoothstep(0.1,0.2,p.y)*(1.0-smoothstep(0.8,0.9,p.y));
        pigments.y=exp(-pow((p.y-0.65)/0.045,2.0))*smoothstep(0.1,0.2,p.x)*(1.0-smoothstep(0.8,0.9,p.x));
    }else if(uSeed.x<1.5) pigments=vec2(0.25,0.6);
    fragColor=TDOutputSwizzle(vec4(pigments,0.0,1.0));
}
// @end seed
