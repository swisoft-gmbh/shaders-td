from pathlib import Path
import runpy
SOURCE = Path(__file__).resolve().parent
def build(parent_path='/project1'):
    return runpy.run_path(str(SOURCE/'builder.py'))['build'](SOURCE,parent_path)
