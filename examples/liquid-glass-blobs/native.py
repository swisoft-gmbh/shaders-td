"""Embedded helper module: explicit native actions, never implicit export.

Use from the Textport after building:
    helpers = component.op('study_tools').module
    helpers.apply(component, 'merge_soft')
    helpers.inspect(component)
    helpers.fit_glass(component)       # same as the Inputs > Fit to Glass geometry pulse
    helpers.capture(component, '/new/folder/merge_soft.png')
    helpers.export(component, '/new/folder/liquid_glass_blobs.tox')

Adapted from the liquid-glass study's native.py (commits a6f95c6 and 6a58487),
with render_diagnostics from the liquid-glass study (core audit round 3) and
the fit from the liquid-glass-flow study (commit 6a58487). fit_glass() has the
core's name; fit_object_size is its old name, kept one round as an alias.
"""
from pathlib import Path
import json
import platform
import time
from td import *

# Controls that apply() never resets. Writing Preset would fire the preset
# callback over the experiment's values; it is set to 'custom' instead.
# Controls marked "setup" in study.json are never reset either: they describe
# your scene, not a look (Refraction TOP, Reflection TOP and the Reflection map
# that says how to read it, Layout TOP, Object size, Flip screen V, Colour
# parameters). Demo backdrop is reset, as everywhere in the family: the
# experiments' captures use the Checker.
KEEP = ("Preset",)
# Nodes whose errors stop capture() and export(); others are only reported.
CORE_NODES = ("material", "render", "over", "out")
# Operator types render_diagnostics() looks for in the whole project.
RENDER_TYPES = (renderTOP, renderpassTOP) if "renderTOP" in globals() else ()  # noqa: F405 (td)


def spec(component):
    return json.loads(component.op("study_spec").text)


def look_defaults(s):
    """Default value of every control an experiment resets: the preset values,
    Morph and its target, Seed, Blob layout, Samples, March steps, Energy
    conserving, Panorama rotation, Flat image warp, Light direction and the
    Study page (Pause, Fixed time, Teaching stage, Demo ring spin, Demo
    backdrop); not Preset or "setup" controls."""
    return {c["name"]: c["default"] for c in s["controls"]
            if c.get("default") is not None and c["type"] != "pulse"
            and not c.get("setup") and c["name"] not in KEEP}


def apply(component, experiment_id):
    """Set one named teaching experiment from experiments.json.

    Every control in look_defaults() first returns to its default, so the
    result never depends on earlier experiments or edits; apply(component,
    'final') gets the default look back, paused at Fixed time with the Preset
    menu on Custom. Setup controls (scene inputs, Object size, Reflection map,
    Flip screen V, Colour parameters) stay as they are. It changes the component's shared
    material, so blobs in your own scene that use it change too.
    """
    experiments = json.loads(component.op("study_experiments").text)
    item = next((x for x in experiments if x["id"] == experiment_id), None)
    if item is None:
        raise ValueError("Unknown experiment: " + experiment_id)
    for name, value in look_defaults(spec(component)).items():
        getattr(component.par, name).val = value
    parameters = dict(item["parameters"])
    preset = parameters.pop("Preset", None)
    if preset is not None:
        # Load the preset's values directly; the menu says 'custom' so the
        # Preset callback cannot reload them over the experiment's overrides.
        component.op("presets").module.apply(component, preset)
    component.par.Preset.val = "custom"
    for name, value in parameters.items():
        getattr(component.par, name).val = value
    return {"experiment": experiment_id, "preset": preset, "parameters": parameters,
            "expected": item["prediction"], "observed": "pending"}


# The family's reference radius: Object size 1 means an object this big, the
# core study's demo torus (Liquid Glass Lit decisions.json, family_rule).
REFERENCE_RADIUS = 1.45
# Half a side of the box the blobs live in, in its own units: blobs.frag
# marches -1..1 (BOX), the Box SOP of size 2 in blobs_geo.
BOX_HALF_SIDE = 1.0


def fit_glass(component, geometry=None):
    """Set Inputs > Object size from the Geometry COMP that holds the blobs.

    The family rule: Object size = the object's radius in scene units over
    REFERENCE_RADIUS (1.45, the core's demo torus). The blobs live in
    blobs_geo's 2 x 2 x 2 box, so their radius is BOX_HALF_SIDE (1) times the
    Geometry COMP's scale (with its parents'): the cube root of the volume
    change of its world transform, the geometric mean of a non-uniform scale.
    The unscaled demo box fits to 1 / 1.45, the control's default. The radius
    comes from the box blobs.frag marches, not from the Box SOP's bounds: the
    shader's box is fixed, so the SOP could only disagree with it. If the
    transform cannot be read, half the largest side of the COMP's bounds
    stands in for the radius. Object size then scales Backdrop distance,
    Frost, Tint density and the film swirl; the blob shape follows the box by
    itself. Instances are not included: copies scaled differently need their
    own component. From the liquid-glass-flow study's Fit (commit 6a58487).
    """
    geo = geometry if geometry is not None else component.op("blobs_geo")
    if geo is None:
        raise ValueError("No blobs_geo inside the component, and no Geometry COMP given")
    try:
        scale = abs(geo.worldTransform.determinant()) ** (1.0 / 3.0)
        radius, source = BOX_HALF_SIDE * scale, geo.path + " world transform"
    except Exception:
        bounds = geo.bounds()
        radius, source = max(bounds.size.x, bounds.size.y, bounds.size.z) / 2.0, geo.path + " bounds"
    if not radius > 0.0:
        raise ValueError(source + ": zero size, nothing to fit")
    size = radius / REFERENCE_RADIUS
    component.par.Objectsize.val = size
    return {"source": source, "object_size": size, "radius": radius, "reference_radius": REFERENCE_RADIUS}


# The old name, kept for one round: fit_object_size() was this helper's name
# until the family critic's one-name fix (review.md, Family critic: one Fit
# name). Liquid Glass Lit's tests still call it. Remove it once nothing calls it.
fit_object_size = fit_glass  # alias


def blocking_errors(component):
    """Errors in the material and the output chain."""
    found = {}
    for name in CORE_NODES:
        node = component.op(name)
        if node is not None and node.errors():
            found[name] = node.errors()
    return found


def inputs_report(component):
    """Errors and warnings of the TOPs the input fields point at, when they
    live outside the component (your own scene)."""
    report = {}
    for name in ("Refractiontop", "Reflectiontop", "Layouttop"):
        par = getattr(component.par, name, None)
        if par is None:
            continue
        for node in par.evalOPs():
            if not node.path.startswith(component.path + "/"):
                report[node.path] = {"parameter": name, "errors": node.errors(),
                                     "warnings": node.warnings()}
    return report


def _draws_blobs(render, component):
    """True if this Render or Render Pass TOP draws the blobs: blobs_geo is
    in its Geometry, or its Override Material (or the Material of one of its
    Geometry COMPs, such as a copy of blobs_geo) is the component's material."""
    material, blobs_geo = component.op("material"), component.op("blobs_geo")
    try:
        if material is not None and render.par.overridemat.eval() == material:
            return True
    except Exception:
        pass
    try:
        geometry = render.par.geometry.evalOPs()
    except Exception:
        return False
    for geo in geometry:
        if blobs_geo is not None and geo == blobs_geo:
            return True
        par = getattr(getattr(geo, "par", None), "material", None)
        try:
            if material is not None and par is not None and par.eval() == material:
                return True
        except Exception:
            continue
    return False


def render_diagnostics(component, renders=None):
    """Errors and warnings of every Render and Render Pass TOP that draws the
    blobs: the component's own renders (by name) and, in your scene, any render
    whose Geometry holds blobs_geo (by path; README step 1 adds it to your own
    Render TOP). Each render compiles its own copy of the material, so compile
    errors can show there and not in info_material. Renders outside the
    component are read as they last cooked; inspect() does not cook them.
    From the liquid-glass study's render_diagnostics()."""
    if renders is None:
        renders = []
        for kind in RENDER_TYPES:
            try:
                renders += list(op("/").findChildren(type=kind))  # noqa: F405 (td)
            except Exception:
                continue
        mine = [component.op(n["id"]) for n in spec(component)["nodes"]
               if n["type"] in ("renderTOP", "renderpassTOP")]
        renders += [n for n in mine if n is not None and n not in renders]
    report = {}
    for r in renders:
        own = r.path.startswith(component.path + "/")
        if own or _draws_blobs(r, component):
            report[r.name if own else r.path] = {"errors": r.errors(), "warnings": r.warnings()}
    return report


def inspect(component):
    s = spec(component)
    output = component.op(s["output"])
    # A forced Out TOP alone can reuse a cached Render TOP in the same frame, so
    # shaders and renders are cooked first. Demo nodes are built leniently and
    # may have been deleted: report them, do not crash.
    missing = []
    for node in s["nodes"]:
        if node["type"] not in ("glslMAT", "glslTOP", "renderTOP", "renderpassTOP"):
            continue
        target = component.op(node["id"])
        if target is None:
            missing.append(node["id"])
            continue
        target.cook(force=True)
    if output is not None:
        output.cook(force=True)
    return {
        "time_unix": time.time(), "build": str(app.build), "version": str(app.version),
        "platform": platform.platform(), "component": component.path,
        "resolution": [output.width, output.height] if output is not None else None,
        "missing_nodes": missing,
        "parameters": {p.name: p.eval() for p in component.customPars if not p.isPulse},
        "errors": component.errors(recurse=True),
        "warnings": component.warnings(recurse=True),
        # Python exceptions in the preset callback or module land here, not in errors().
        "script_errors": component.scriptErrors(recurse=True) if hasattr(component, "scriptErrors") else "",
        "blocking_errors": blocking_errors(component),
        # Every Render TOP that draws blobs_geo, yours included, compiles its own
        # copy of the material; its errors can show there rather than in info_material.
        "render_diagnostics": render_diagnostics(component),
        "inputs": inputs_report(component),
        "build_warnings": component.fetch("build_warnings", []),
        "compile_reports": {n.name: n.text for n in component.children
                            if n.OPType == "infoDAT" and n.name.startswith("info_")},
        "scope": "Current cook and compile diagnostics; not visual acceptance or performance."
    }


def _refuse_or_report(report):
    if report["blocking_errors"]:
        raise RuntimeError(report["blocking_errors"])
    for key in ("errors", "script_errors"):
        if report[key]:
            print(f"Liquid Glass Blobs: {key.replace('_', ' ')} outside the material and output chain:\n{report[key]}")


def capture(component, filename):
    path = Path(filename).resolve()
    receipt = path.with_suffix(path.suffix + ".json")
    if path.exists() or receipt.exists():
        raise FileExistsError("Capture or receipt already exists")
    report = inspect(component)
    _refuse_or_report(report)
    # Create the folder only once the capture is allowed, so a refusal leaves nothing behind.
    path.parent.mkdir(parents=True, exist_ok=True)
    output = component.op(spec(component)["output"])
    if output is None:
        raise RuntimeError("No output TOP to capture: " + spec(component)["output"])
    output.save(str(path), asynchronous=False)
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
    _refuse_or_report(report)
    path.parent.mkdir(parents=True, exist_ok=True)
    return str(component.save(str(path)))
