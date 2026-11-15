#!/usr/bin/env python3
"""Write checks/capture-jobs.json: every WebGL preview image the study ships.

  python3 checks/capture_jobs.py && bash checks/capture_all.sh

One job per experiment (captures/preview-<id>.png, same parameters as
experiments.json), one per preset on each demo backdrop
(captures/preset-<name>.png, captures/type/preset-<name>.png), the motion
strip frames (captures/motion/) and one instancing illustration. The preview
reads Demo object, Demo detail, Faces, Pause and Time from the parameters, like
the TouchDesigner demo network.
"""
import json
from pathlib import Path

STUDY = Path(__file__).resolve().parent.parent
experiments = json.loads((STUDY / "experiments.json").read_text())
presets = json.loads((STUDY / "presets.json").read_text())

jobs = []
for e in experiments:
    params = dict(e["parameters"])
    preset = params.pop("Preset")
    jobs.append({"name": Path(e["preview"]).stem, "draw": {"preset": preset, "overrides": params}})
for name in presets["order"]:
    jobs.append({"name": "preset-" + name, "draw": {"preset": name, "overrides": {"Pause": True, "Time": 2.0}}})
# The same twelve over the bold-type backdrop (Study > Backdrop: Type), for the family's comparable sheets.
for name in presets["order"]:
    jobs.append({"name": "type/preset-" + name, "draw": {"preset": name, "overrides": {"Pause": True, "Time": 2.0, "Backdrop": "type"}}})
for name in ("prism_chrome", "sapphire_drop", "chrome_type", "aqua_jelly"):
    for t in (0.0, 2.0, 4.0, 6.0):
        jobs.append({"name": f"motion/{name}-t{int(t)}", "draw": {"preset": name, "spin": 0,
                     "overrides": {"Pause": True, "Time": t}}})
# Instancing illustration: three instances with their own TDInstanceID and Instance variation 1.
# In the preview each instance is a separate draw; in TouchDesigner use Geometry COMP instancing.
jobs.append({"name": "preview-instances", "draw": {"preset": "sapphire_drop", "spin": 0,
             "overrides": {"Pause": True, "Time": 2.0, "Instancevary": 1.0},
             "instances": [{"t": [0, 0, 0], "s": 1, "id": 0}, {"t": [1.45, 0.75, -0.3], "s": 0.22, "id": 1},
                           {"t": [-1.35, -0.8, 0.2], "s": 0.28, "id": 2}]}})
(STUDY / "checks" / "capture-jobs.json").write_text(json.dumps(jobs, indent=1) + "\n")
print(len(jobs), "jobs")
