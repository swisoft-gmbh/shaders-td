"""Run the five-study mechanism suite in a new native component; never overwrite reports.

Inside TouchDesigner: runpy.run_path('/path/to/reproduce_native.py')['run'](
    parent_path='/project1', report_dir='/new/report/directory')
The temporal part is asynchronous; inspect the returned report paths.
"""
from pathlib import Path
import runpy
from td import *

HERE=Path(__file__).resolve().parent
PLUGIN=HERE.parents[1]
NAMES=['orbital-relic','lantern-fog','pigment-census','resonant-foil','tidal-ink']

def run(parent_path,report_dir):
    destination=Path(report_dir).resolve()
    if destination.exists():raise FileExistsError(destination)
    parent_op=op(parent_path)
    if parent_op is None:raise ValueError('Inspect and supply an existing parent')
    destination.mkdir(parents=True)
    group=parent_op.create(baseCOMP,'mechanism_validation')
    for name in NAMES:
        runpy.run_path(str(PLUGIN/'examples'/name/'build.py'))['build'](group.path)
    runpy.run_path(str(HERE/'static_checks.py'),init_globals={
        'REPORT_DIR':str(destination),'GROUP_PATH':group.path})
    driver=group.create(executeDAT,'temporal_validation')
    driver.text=('REPORT_DIR='+repr(str(destination))+'\nGROUP_PATH='+repr(group.path)+'\n'
                 +(HERE/'temporal_checks.py').read_text())
    driver.par.frameend=True
    driver.par.active=True
    return {'group':group.path,'static_report':str(destination/'mechanism-tests.json'),
            'temporal_report':str(destination/'tidal-tests.json'),
            'temporal_driver':driver.path,'scope':'Mechanism tests only; temporal driver stops after 407 frames. Remove the new group when finished.'}
