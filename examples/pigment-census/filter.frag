uniform vec4 uFilter; // radius, stage
layout(location=0) out vec4 fragColor;
vec3 fetchColor(ivec2 p){ivec2 size=textureSize(sTD2DInputs[0],0);return texelFetch(sTD2DInputs[0],clamp(p,ivec2(0),size-1),0).rgb;}
// @begin moments
void quadrant(ivec2 p,ivec2 direction,int radius,out vec3 mean,out float variance){
    vec3 sum=vec3(0.0),squared=vec3(0.0);float count=0.0;
    for(int y=0;y<=8;y++) for(int x=0;x<=8;x++){
        if(x>radius || y>radius) continue;
        vec3 c=fetchColor(p+direction*ivec2(x,y));
        sum+=c;squared+=c*c;count+=1.0;
    }
    mean=sum/count;
    vec3 channelVariance=max(squared/count-mean*mean,vec3(0.0));
    variance=dot(channelVariance,vec3(0.2126,0.7152,0.0722));
}
// @end moments
void main(){
    ivec2 p=ivec2(vUV.st*vec2(textureSize(sTD2DInputs[0],0)));
    int radius=int(clamp(round(uFilter.x),0.0,8.0)),stage=int(uFilter.y+0.5);
    // @begin select
    const ivec2 directions[4]=ivec2[4](ivec2(-1,-1),ivec2(1,-1),ivec2(-1,1),ivec2(1,1));
    vec3 selected=fetchColor(p);float minimumVariance=1e20;
    for(int i=0;i<4;i++){
        vec3 mean;float variance;quadrant(p,directions[i],radius,mean,variance);
        if(variance<minimumVariance){minimumVariance=variance;selected=mean;}
    }
    // @end select
    vec3 color=selected;
    if(stage==1) color=fetchColor(p);
    if(stage==2) color=vec3(minimumVariance*40.0);
    if(stage==3){
        // @begin comparison
        vec3 sum=vec3(0.0);float count=0.0;
        for(int y=-8;y<=8;y++) for(int x=-8;x<=8;x++){
            if(abs(x)>radius || abs(y)>radius) continue;
            sum+=fetchColor(p+ivec2(x,y));count+=1.0;
        }
        color=sum/count;
        // @end comparison
    }
    fragColor=TDOutputSwizzle(vec4(color,1.0));
}
