#!/usr/bin/env python3
"""Write the WebGL preview capture jobs (JSON on stdout) for checks/capture.cjs.

One job per experiment (captures/preview-<id>.png) and three per preset, all
labelled WebGL previews: captures/preset-<name>.png on the demo torus over the
checkerboard (the core study's demo scene, so the family's sheets compare) and
captures/preset-<name>-type.png over bold type on black (this study's default
scene), both without the back-face pass (the least-wiring default); and
captures/preset-<name>-backpass.png on the preview's knot with the back-face
pass, where light-backdrop looks use the checkerboard.
"""
import json
from pathlib import Path

STUDY = Path(__file__).resolve().parent.parent
LIGHT_BACKDROP = {"lavender_prism", "violet_gel", "sapphire_drop", "frosted_ice"}


def jobs():
    out = []
    for e in json.loads((STUDY / "experiments.json").read_text()):
        params = dict(e["parameters"])
        preset = params.pop("Preset")
        out.append({"name": Path(e["preview"]).stem, "draw": {"preset": preset, "time": params.get("Time", 2.0),
                                                            "overrides": params}})
    presets = json.loads((STUDY / "presets.json").read_text())
    for name in presets["order"]:
        style = {"Backdrop": "checker"} if name in LIGHT_BACKDROP else {"Backdrop": "type"}
        out.append({"name": f"preset-{name}", "draw": {"preset": name, "time": 2.0, "overrides": {"Backdrop": "checker"}}})
        out.append({"name": f"preset-{name}-type", "draw": {"preset": name, "time": 2.0, "overrides": {"Backdrop": "type"}}})
        out.append({"name": f"preset-{name}-backpass", "draw": {"preset": name, "time": 2.0, "mesh": "knot",
                    "scale": [1, 1, 1], "overrides": {**style, "Backface": True}}})
    return out


if __name__ == "__main__":
    print(json.dumps(jobs(), indent=1))
