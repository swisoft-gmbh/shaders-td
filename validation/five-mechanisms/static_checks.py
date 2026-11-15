from pathlib import Path
import json, numpy as np, time, traceback
from td import *
OUT=Path(REPORT_DIR)
g=op(GROUP_PATH);results=json.loads((OUT/'mechanism-tests.json').read_text()) if (OUT/'mechanism-tests.json').exists() else {}
def setp(c,**values):
 for k,v in values.items():getattr(c.par,k).val=v

def pixels(c):
 for node in c.children:
  if node.OPType=='glslMAT':node.cook(force=True)
 order={'pigment_census':['source','filter','out'],'resonant_foil':['render','out'],'orbital_relic':['surface','out'],'lantern_fog':['volume','out']}[c.name]
 start=time.perf_counter()
 for name in order:c.op(name).cook(force=True)
 wall=(time.perf_counter()-start)*1000
 a=c.op('out').numpyArray(delayed=False).copy()
 if not np.isfinite(a).all():raise ValueError('Non-finite output')
 return a,wall

def record(checks,name,passed,**data):checks.append({'name':name,'passed':bool(passed),**data})
for name in globals().get('STUDY_FILTER',['orbital-relic','lantern-fog','pigment-census','resonant-foil']):
 c=g.op(name.replace('-','_'));checks=[];times=[]
 try:
  if name=='orbital-relic':
   setp(c,Pause=True,Time=2,Single=True,Budget=192,Stage='hit');a,t=pixels(c);times.append(t)
   h,w=a.shape[:2];x,y=np.meshgrid((np.arange(w)+.5)/w*2-1,(np.arange(h)+.5)/h*2-1);x*=w/h
   rd=np.stack([x,y,np.full_like(x,-2.25)],axis=-1);rd/=np.linalg.norm(rd,axis=-1,keepdims=True)
   b=rd[:,:,2]*3.1;disc=b*b-(3.1**2-.7**2);expected=disc>=0;mask=a[:,:,0]>.5
   iou=np.count_nonzero(mask&expected)/np.count_nonzero(mask|expected)
   record(checks,'SDF sphere silhouette agrees with analytic ray intersection',iou>.995,iou=float(iou),threshold=.995)
   setp(c,Stage='normals');norm,_=pixels(c);tnear=-b-np.sqrt(np.maximum(disc,0));points=rd*tnear[:,:,None]+np.array([0,0,3.1]);normals=points/.7
   native=norm[:,:,:3]*2-1;inner=expected&(disc>.08);dots=np.sum(native*normals,axis=-1)[inner]
   record(checks,'SDF normals agree with analytic sphere interior',dots.mean()>.999,mean_dot=float(dots.mean()))
   setp(c,Single=False,Stage='hit',Budget=16);low,_=pixels(c);setp(c,Budget=192);high,_=pixels(c)
   record(checks,'A limited step budget does not invent hits',np.count_nonzero((low[:,:,0]>.5)&(high[:,:,0]<.5))==0,low_hits=int((low[:,:,0]>.5).sum()),high_hits=int((high[:,:,0]>.5).sum()))
   setp(c,Stage='final',Blend=0);hard,_=pixels(c);setp(c,Blend=.3);smooth,_=pixels(c);mad=float(np.mean(np.abs(hard-smooth)))
   record(checks,'Smooth union changes the actual shape/shading',mad>.002,mean_absolute_difference=mad)
   setp(c,Time=5);later,_=pixels(c);mad=float(np.mean(np.abs(later-smooth)));record(checks,'Fixed time changes rigid scene rotation',mad>.002,mean_absolute_difference=mad)
   c.op('surface').par.resolutionw=640;c.op('surface').par.resolutionh=320
   setp(c,Single=True,Stage='hit',Budget=192);a,_=pixels(c);h,w=a.shape[:2]
   ys,xs=np.nonzero(a[:,:,0]>.5);aspect=(xs.max()-xs.min()+1)/(ys.max()-ys.min()+1)
   record(checks,'Wide render preserves a round sphere silhouette',abs(aspect-1)<.02,pixel_aspect=float(aspect),output=[w,h])
   c.op('surface').par.resolutionw=512;c.op('surface').par.resolutionh=512
  elif name=='lantern-fog':
   setp(c,Pause=True,Time=2,Slab=True,Stage='transmittance',Extinction=2,Light=0)
   expected=float(np.exp(-2*.4*3));slabs=[]
   for count in [16,64,128]:
    setp(c,Steps=count);a,t=pixels(c);times.append(t);slabs.append(float(a[32:-32,32:-32,0].mean()))
   error=max(abs(x-expected) for x in slabs)
   record(checks,'Homogeneous slab matches Beer-Lambert at three step counts',error<3e-6,expected=expected,observed=slabs,max_error=error)
   setp(c,Extinction=0);a,_=pixels(c);err=float(np.max(np.abs(a[:,:,:3]-1)))
   record(checks,'Zero extinction transmits all background light',err<1e-6,max_error=err)
   setp(c,Slab=False,Stage='final',Extinction=2.2,Light=1);images=[]
   for count in [32,64,128]:setp(c,Steps=count);a,t=pixels(c);images.append(a);times.append(t)
   e32=float(np.mean(np.abs(images[0]-images[2])));e64=float(np.mean(np.abs(images[1]-images[2])))
   record(checks,'View integration converges toward the 128-step reference',e64<e32 and e64<.003,error32=e32,error64=e64)
   setp(c,Light=0);a,_=pixels(c);mad=float(np.mean(np.abs(a-images[-1])));record(checks,'Light-path attenuation changes scattering',mad>.001,mean_absolute_difference=mad)
   setp(c,Stage='transmittance',Extinction=1);low,_=pixels(c);setp(c,Extinction=4);high,_=pixels(c)
   record(checks,'Increasing extinction never raises transmission',float(np.max(high[:,:,:3]-low[:,:,:3]))<1e-6,mean_low=float(low[:,:,0].mean()),mean_high=float(high[:,:,0].mean()))
  elif name=='pigment-census':
   setp(c,Pause=True,Time=2,Input='flat',Radius=8,Stage='final');a,t=pixels(c);times.append(t);err=float(np.max(np.abs(a[:,:,:3]-np.array([.23,.46,.69]))))
   record(checks,'Constant RGB survives a maximum-radius filter',err<2e-5,max_error=err)
   setp(c,Input='painting',Radius=0,Stage='source',Grain=.18);a,_=pixels(c);setp(c,Stage='final');b,_=pixels(c);err=float(np.max(np.abs(a-b)))
   record(checks,'Zero-radius filtering is identity',err<1e-6,max_error=err)
   setp(c,Input='edge',Radius=5,Stage='source',Grain=0);source,_=pixels(c);setp(c,Stage='final');kuw,_=pixels(c);setp(c,Stage='box');box,_=pixels(c)
   ek=float(np.mean(np.abs(kuw-source)));eb=float(np.mean(np.abs(box-source)))
   record(checks,'Variance selection preserves an edge better than box blur',ek<1e-6 and eb>.003,kuwahara_mae=ek,box_mae=eb)
   setp(c,Input='painting',Stage='source',Grain=0);clean,_=pixels(c);setp(c,Grain=.18);noisy,_=pixels(c);setp(c,Stage='final',Radius=5);filtered,t=pixels(c);times.append(t)
   roi=(slice(420,495),slice(20,150),slice(0,3));en=float(np.mean(np.abs(noisy[roi]-clean[roi])));ef=float(np.mean(np.abs(filtered[roi]-clean[roi])))
   record(checks,'Filtering reduces grain in a controlled sky region',ef<en*.6,noisy_mae=en,filtered_mae=ef)
  else:
   setp(c,Pause=True,Time=2,Amplitude=0,Correct=True,Stage='final',Turn=25,Stretch=1);flat,t=pixels(c);times.append(t)
   setp(c,Amplitude=.18);corrected,_=pixels(c);setp(c,Correct=False);wrong,_=pixels(c)
   silhouette_change=float(np.mean(np.abs(flat[:,:,3]-corrected[:,:,3])))
   normal_change=float(np.mean(np.abs(corrected-wrong)))
   record(checks,'Vertex displacement changes coverage',silhouette_change>.005,alpha_mae=silhouette_change)
   record(checks,'Corrected normals change lighting without changing geometry',normal_change>.003 and float(np.max(np.abs(corrected[:,:,3]-wrong[:,:,3])))<1e-6,rgb_mae=normal_change)
   setp(c,Amplitude=0,Correct=True);a,_=pixels(c);setp(c,Correct=False);b,_=pixels(c);err=float(np.max(np.abs(a-b)))
   record(checks,'Normal correction reduces to identity at zero displacement',err<1e-6,max_error=err)
   # Independent finite-difference check of the explicit map, followed by nonuniform scale and object rotation.
   rng=np.random.default_rng(42);p=rng.normal(size=(400,3));p/=np.linalg.norm(p,axis=1,keepdims=True)
   up=np.tile([0.,1.,0.],(400,1));t1=np.cross(p,up);t1/=np.linalg.norm(t1,axis=1,keepdims=True);t2=np.cross(p,t1)
   amp=.18;freq=7;phase=2;gx=amp*freq*np.cos(freq*p[:,0]+phase)*np.cos(freq*p[:,2]-.7*phase);gz=-amp*freq*np.sin(freq*p[:,0]+phase)*np.sin(freq*p[:,2]-.7*phase)
   n=p.copy();n[:,0]-=gx*p[:,1];n[:,2]-=gz*p[:,1];n/=np.linalg.norm(n,axis=1,keepdims=True)
   def deform(q):
    q=q.copy();q[:,1]+=amp*np.sin(freq*q[:,0]+phase)*np.cos(freq*q[:,2]-.7*phase);return q
   eps=1e-5;d1=(deform(p+eps*t1)-deform(p-eps*t1))/(2*eps);d2=(deform(p+eps*t2)-deform(p-eps*t2))/(2*eps)
   scale=np.array([1.5,1.,1.]);numeric=np.cross(d1*scale,d2*scale);numeric/=np.linalg.norm(numeric,axis=1,keepdims=True);analytic=n/scale;analytic/=np.linalg.norm(analytic,axis=1,keepdims=True)
   dot=np.sum(numeric*analytic,axis=1)
   record(checks,'Jacobian normal matches independent finite-difference tangents under scale',dot.min()>.999999,min_dot=float(dot.min()),scope='CPU equation check; native shader control/render checks are separate')
   setp(c,Amplitude=.18,Correct=True,Stage='normals',Stretch=1.5);a,_=pixels(c);setp(c,Turn=-35);b,_=pixels(c);mad=float(np.mean(np.abs(a-b)))
   record(checks,'Native world normal view responds to object rotation/scale',mad>.01,mean_absolute_difference=mad)
  c.op('study_tools').module.apply(c,'final')
  a,_=pixels(c)
  info=c.op('study_tools').module.inspect(c)
  record(checks,'Final native diagnostics have no reported errors',not info['errors'],errors=info['errors'])
  results[name]={'checks':checks,'passed':all(x['passed'] for x in checks),'native':info,'cook_wall_observations_ms':times,'timing_scope':'Wall time forcing this branch, excludes readback. Not isolated GPU execution or steady-state FPS.'}
 except Exception:results[name]={'passed':False,'checks':checks,'error':traceback.format_exc()}
(OUT/'mechanism-tests.json').write_text(json.dumps(results,indent=2));RESULT={n:{'passed':v['passed'],'failed':[c['name'] for c in v['checks'] if not c['passed']],'error':v.get('error')} for n,v in results.items()}
