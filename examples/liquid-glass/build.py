"""Run inside TouchDesigner with runpy.run_path, then call build()."""
from pathlib import Path
import runpy
HERE = Path(__file__).resolve().parent
def build(parent_path="/project1"):
    builder = runpy.run_path(str(HERE / "builder.py"))
    return builder["build"](HERE, parent_path)
