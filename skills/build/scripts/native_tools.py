"""Embedded helper module: explicit native actions, never implicit export.

Use from the Textport after building:
    helpers = component.op('study_tools').module
    helpers.apply(component, 'final')      # one experiment from experiments.json
    helpers.inspect(component)             # errors, warnings, compile reports
    helpers.capture(component, '/new/folder/final.png')
    helpers.export(component, '/new/folder/study.tox')
"""
from pathlib import Path
import json
import platform
import time
from td import *


def spec(component):
    return json.loads(component.op("study_spec").text)


def look_defaults(s):
    """The default of every control an experiment resets.

    Controls marked "setup": true in study.json describe the user's scene and
    its cost (inputs, sizes, render switches), not the look, so they are kept.
    """
    return {c["name"]: c["default"] for c in s["controls"]
            if c.get("default") is not None and c.get("type") != "pulse"
            and not c.get("setup") and not c.get("expression")}


def is_constant(par):
    """A parameter driven by an expression, export or bind ignores writes to .val."""
    return str(getattr(par, "mode", "CONSTANT")).upper().endswith("CONSTANT")


def apply(component, experiment_id):
    """Set one experiment: look controls back to default, then its parameters.

    The result is the same whatever ran before, so a reader can try the
    tutorial's experiments in any order. apply(component, 'final') is the way
    back to the default look. Controls that are not in constant mode are left
    alone and listed under "not_reset".
    """
    experiments = json.loads(component.op("study_experiments").text)
    item = next((x for x in experiments if x["id"] == experiment_id), None)
    if item is None:
        raise ValueError("Unknown experiment: " + experiment_id)
    not_reset = []
    for name, value in {**look_defaults(spec(component)), **item["parameters"]}.items():
        par = getattr(component.par, name)
        if is_constant(par):
            par.val = value
        else:
            not_reset.append(name)
    if item.get("reset"):
        reset(component)
    return {"experiment": experiment_id, "parameters": item["parameters"], "not_reset": not_reset,
            "expected": item["prediction"], "observed": "pending"}


def reset(component):
    for r in spec(component).get("references", []):
        node = component.op(r["node"])
        if r.get("previous_frame") and node is not None:
            node.par.resetpulse.pulse()


def inspect(component):
    """Cook the output chain and report diagnostics. Survives deleted nodes."""
    s = spec(component)
    missing = [item["id"] for item in s["nodes"] if component.op(item["id"]) is None]
    # A forced Out TOP alone can reuse a cached Render TOP in the same frame.
    upstream = [n["id"] for n in s["nodes"] if n["type"] == "glslMAT"]
    upstream += [edge["from"] for edge in s["wires"] if edge["to"] == s["output"]]
    for name in upstream + [s["output"]]:
        node = component.op(name)
        if node is not None:
            node.cook(force=True)
    output = component.op(s["output"])
    # Python errors (callbacks, extensions) land in scriptErrors(), not errors().
    script_errors = component.scriptErrors(recurse=True) if hasattr(component, "scriptErrors") else ""
    return {
        "time_unix": time.time(), "build": str(app.build), "version": str(app.version),
        "platform": platform.platform(), "component": component.path,
        "resolution": [output.width, output.height] if output is not None else None,
        "parameters": {p.name: p.eval() for p in component.customPars},
        "errors": component.errors(recurse=True),
        "script_errors": script_errors,
        "warnings": component.warnings(recurse=True),
        "build_warnings": component.fetch("study_warnings", []),
        "missing": missing,
        "compile_reports": {n.name: n.text for n in component.children
                            if n.OPType == "infoDAT" and n.name.startswith("info_")},
        "scope": "Current cook and compile diagnostics; not visual acceptance or performance."
    }


def blocking(report, output_name):
    """What stops a capture or export: errors, Python errors, or no output."""
    problems = [report[key] for key in ("errors", "script_errors") if report[key]]
    if output_name in report["missing"]:
        problems.append("Output node is missing: " + output_name)
    return problems


def capture(component, filename):
    path = Path(filename).resolve()
    receipt = path.with_suffix(path.suffix + ".json")
    if path.exists() or receipt.exists():
        raise FileExistsError("Capture or receipt already exists")
    report = inspect(component)
    output_name = spec(component)["output"]
    if blocking(report, output_name):
        raise RuntimeError(blocking(report, output_name))
    path.parent.mkdir(parents=True, exist_ok=True)
    component.op(output_name).save(str(path), asynchronous=False)
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
    if blocking(report, spec(component)["output"]):
        raise RuntimeError(blocking(report, spec(component)["output"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    return str(component.save(str(path)))
