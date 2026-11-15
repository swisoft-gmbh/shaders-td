from pathlib import Path
import json,math,numpy as np,traceback
OUT=Path(REPORT_DIR)
c=op(GROUP_PATH+'/tidal_ink');tick=-1;checks=[];snapshots={}
def setp(**values):
 for k,v in values.items():getattr(c.par,k).val=v

def record(name,passed,**data):checks.append(dict(name=name,passed=bool(passed),**data))
def runframe():
 global tick
 tick+=1
 if tick==0:setp(Reset=True,Pause=False,Seed='flat',Speed=.12,Decay=0,Inject=0,Step=1/60,Stage='state')
 if tick==1:setp(Reset=False)
 if tick==21:setp(Reset=True,Decay=.7)
 if tick==22:setp(Reset=False)
 if tick==82:setp(Reset=True,Step=1/30)
 if tick==83:setp(Reset=False)
 if tick==113:setp(Pause=True)
 if tick==121:setp(Reset=True,Pause=False,Seed='empty',Decay=0,Inject=0)
 if tick==122:setp(Reset=False)
 if tick==143:setp(Reset=True,Seed='pattern',Speed=0,Step=1/60)
 if tick==144:setp(Reset=False)
 if tick==164:setp(Reset=True,Speed=.12)
 if tick==165:setp(Reset=False)
 if tick==286:setp(Reset=True,Pause=False,Seed='pattern',Speed=.12,Decay=.15,Inject=.5,Step=1/60,Stage='final')
 if tick==287:setp(Reset=False)
 for name in ['seed','history','state','display','out']:c.op(name).cook(force=True)
 if tick in [0,20,81,112,113,120,121,142,143,163,164,284,406]:
  a=c.op('state').numpyArray(delayed=False).copy();snapshots[tick]=a
  if tick==0:record('Initialized state has valid alpha and deterministic flat pigment',np.max(np.abs(a[:,:,:2]-np.array([.25,.6])))<1e-6 and np.all(a[:,:,3]==1))
  if tick==20:
   err=float(np.max(np.abs(a-snapshots[0])));record('Periodic advection preserves a uniform field',err<2e-6,max_error=err,steps=20)
  if tick in [81,112]:
   expected=np.array([.25,.6])*math.exp(-.7);error=float(np.max(np.abs(a[:,:,:2]-expected)))
   record('One simulated second of decay at '+('60' if tick==81 else '30')+' steps',error<1e-5,max_error=error,observed=a[:,:,:2].mean(axis=(0,1),dtype=np.float64).tolist(),expected=expected.tolist())
  if tick==120:
   err=float(np.max(np.abs(a-snapshots[113])));record('Pause holds the state exactly',err==0,max_error=err)
  if tick==121:record('Reset replaces the previous history with the selected seed',np.max(a[:,:,:2])==0,pigment_max=float(np.max(a[:,:,:2])))
  if tick==142:record('No injection creates no pigment from an empty field',np.max(a[:,:,:2])==0,pigment_max=float(np.max(a[:,:,:2])))
  if tick==163:
   err=float(np.max(np.abs(a-snapshots[143])));record('Zero velocity/decay/source preserves the pattern',err<2e-5,max_error=err,steps=20)
  if tick==284:
   mad=float(np.mean(np.abs(a-snapshots[164])));record('Nonzero flow transports the seeded pattern',mad>.01,mean_absolute_difference=mad,steps=120)
   relative=np.abs(a[:,:,:2].sum(axis=(0,1))-snapshots[164][:,:,:2].sum(axis=(0,1)))/snapshots[164][:,:,:2].sum(axis=(0,1))
   record('Finite bounded pigment with approximate mass retention',np.isfinite(a).all() and a[:,:,:2].min()>=0 and a[:,:,:2].max()<=1 and np.max(relative)<.06,relative_mass_change=relative.tolist(),tolerance=.06,limitation='Semi-Lagrangian interpolation is diffusive and not exactly conservative.')
  if tick==406:
   record('Final source/decay run remains finite and bounded',np.isfinite(a).all() and a[:,:,:2].min()>=0 and a[:,:,:2].max()<=1)
   c.op('out').save(str(OUT/'tidal-ink-evolved.png'),asynchronous=False)
   result={'checks':checks,'passed':all(x['passed'] for x in checks),'frames':tick+1,'build':str(app.build),'method':'One explicit source/history/state/display cook chain per frame; readback only at checkpoints; dt is simulated seconds per cook.','limits':'Prescribed velocity, no pressure solve. CPU/GPU costs and wall-clock frame-rate independence are not certified.'}
   (OUT/'tidal-tests.json').write_text(json.dumps(result,indent=2));me.par.active=False

def onFrameEnd(frame):
 try:runframe()
 except Exception:
  (OUT/'tidal-tests.json').write_text(json.dumps({'passed':False,'checks':checks,'tick':tick,'error':traceback.format_exc()},indent=2));me.par.active=False
 return
