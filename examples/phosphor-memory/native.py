"""Embedded helper module: explicit native actions, never implicit export."""
from pathlib import Path
import json
import platform
import time
from td import *


def spec(component):
    return json.loads(component.op("study_spec").text)


def apply(component, experiment_id):
    experiments = json.loads(component.op("study_experiments").text)
    item = next((x for x in experiments if x["id"] == experiment_id), None)
    if item is None:
        raise ValueError("Unknown experiment: " + experiment_id)
    for name, value in item["parameters"].items():
        getattr(component.par, name).val = value
    if item.get("reset"):
        reset(component)
    return {"experiment": experiment_id, "parameters": item["parameters"],
            "expected": item["prediction"], "observed": "pending"}


def reset(component):
    for r in spec(component).get("references", []):
        if r.get("previous_frame"):
            component.op(r["node"]).par.resetpulse.pulse()


def inspect(component):
    s = spec(component)
    output = component.op(s["output"])
    # A forced Out TOP alone can reuse a cached Render TOP in the same frame.
    for node in s["nodes"]:
        if node["type"] == "glslMAT":
            component.op(node["id"]).cook(force=True)
    for edge in s["wires"]:
        if edge["to"] == s["output"]:
            component.op(edge["from"]).cook(force=True)
    output.cook(force=True)
    return {
        "time_unix": time.time(), "build": str(app.build), "version": str(app.version),
        "platform": platform.platform(), "component": component.path,
        "resolution": [output.width, output.height],
        "parameters": {p.name: p.eval() for p in component.customPars},
        "errors": component.errors(recurse=True),
        "warnings": component.warnings(recurse=True),
        "compile_reports": {n.name: n.text for n in component.children
                            if n.OPType == "infoDAT" and n.name.startswith("info_")},
        "scope": "Current cook and compile diagnostics; not visual acceptance or performance."
    }


def capture(component, filename):
    path = Path(filename).resolve()
    receipt = path.with_suffix(path.suffix + ".json")
    if path.exists() or receipt.exists():
        raise FileExistsError("Capture or receipt already exists")
    path.parent.mkdir(parents=True, exist_ok=True)
    report = inspect(component)
    if report["errors"]:
        raise RuntimeError(report["errors"])
    component.op(spec(component)["output"]).save(str(path), asynchronous=False)
    report["capture"] = path.name
    receipt.write_text(json.dumps(report, default=str, indent=2) + "\n")
    return report


def export(component, filename):
    path = Path(filename).resolve()
    if path.suffix.lower() != ".tox":
        raise ValueError("Component export needs .tox")
    if path.exists():
        raise FileExistsError(path)
    report = inspect(component)
    if report["errors"]:
        raise RuntimeError(report["errors"])
    path.parent.mkdir(parents=True, exist_ok=True)
    return str(component.save(str(path)))
