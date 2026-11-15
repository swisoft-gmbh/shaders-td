#!/usr/bin/env python3
"""Write the capture job list for checks/capture.cjs.

  python3 checks/capture_jobs.py > /tmp/jobs.json
  node checks/capture.cjs <port> /tmp/jobs.json captures

Every preview image in captures/ is listed here with the draw options that
made it: one per experiment (experiments.json, Pause and Fixed time as given),
one per preset on each demo backdrop (Checker, and Type for the family-wide
comparison), and the timeline frames. Each tile is a WebGL2 preview of the
delivered GLSL, not a TouchDesigner capture.
"""
import json
from pathlib import Path

STUDY = Path(__file__).resolve().parent.parent

# Experiment parameters the preview takes as draw options rather than overrides.
DRAW_KEYS = {"Preset": "preset", "Time": "time"}
IGNORED = {"Pause"}  # the preview always renders the given time


def jobs():
    presets = json.loads((STUDY / "presets.json").read_text())
    out = []
    for e in json.loads((STUDY / "experiments.json").read_text()):
        draw, overrides = {}, {}
        for key, value in e["parameters"].items():
            if key in DRAW_KEYS:
                draw[DRAW_KEYS[key]] = value
            elif key not in IGNORED:
                overrides[key] = value
        if overrides:
            draw["overrides"] = overrides
        out.append({"name": Path(e["preview"]).stem, "draw": draw})
    for name in presets["order"]:
        out.append({"name": f"preset-{name}", "draw": {"preset": name, "time": 3}})
        out.append({"name": f"preset-{name}-type", "draw": {"preset": name, "time": 3, "overrides": {"Demobackdrop": "type"}}})
    for t in (1, 2.5, 4, 5.5, 7, 8.5):
        out.append({"name": f"timeline-{t:g}", "draw": {"preset": "prism_clear", "time": t}})
    return out


if __name__ == "__main__":
    print(json.dumps(jobs(), indent=1))
