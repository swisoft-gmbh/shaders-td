"""Embedded helper module: explicit native actions, never implicit export.

Use from the Textport after building:
    helpers = component.op('study_tools').module
    helpers.apply(component, 'scene_lights')
    helpers.fit_glass(component)        # Object size from the objects that wear the material
    helpers.inspect(component)
    helpers.capture(component, '/new/folder/scene_lights.png')
    helpers.export(component, '/new/folder/liquid_glass_lit.tox')
"""
from pathlib import Path
import json
import platform
import time
from td import *

# Controls that apply() never resets. Writing Preset would fire the preset
# callback over the experiment's values; it is set to 'custom' instead.
# Controls marked "setup" in study.json are never reset either: they describe
# your scene, not a look (Refraction TOP, Faces, Object size, Flip screen V,
# Colour parameters). Neither is anything you drive with an expression, an
# export or a bind: someone wired those on purpose.
KEEP = ("Preset",)
# Nodes whose shaders compile or whose renders draw the glass.
COOKED = ("glslMAT", "glslTOP", "renderTOP", "renderpassTOP")
# Nodes whose errors stop capture() and export(); others are only reported.
CORE_NODES = ("material", "demo_scene", "render", "out")
# Operator types searched for renders that draw the glass and for glass objects.
RENDER_TYPES = (renderTOP, renderpassTOP) if "renderTOP" in globals() else ()  # noqa: F405 (td)
GEOMETRY_TYPE = geometryCOMP if "geometryCOMP" in globals() else None  # noqa: F405 (td)


def spec(component):
    return json.loads(component.op("study_spec").text)


def look_defaults(s):
    """Default value of every control an experiment resets: the preset values,
    Morph and its target, Samples, Energy conserving, the Lighting and
    Built-in pages, and the Study page (Pause, Fixed time, Teaching stage, the
    demo lights, Demo occluder, Backdrop); not Preset or "setup" controls."""
    return {c["name"]: c["default"] for c in s["controls"]
            if c.get("default") is not None and c["type"] != "pulse"
            and not c.get("setup") and c["name"] not in KEEP}


def reset(component):
    """Put every look control back to its default, so experiments do not
    inherit values from the previous one. Skips Preset, setup controls, pulses
    and parameters driven by an expression, export or bind."""
    names = []
    for name, value in look_defaults(spec(component)).items():
        par = getattr(component.par, name)
        if par.mode != ParMode.CONSTANT:
            continue
        par.val = value
        names.append(name)
    return names


def apply(component, experiment_id):
    """Set one named teaching experiment from experiments.json.

    Every control in look_defaults() first returns to its default, so the
    result never depends on earlier experiments or edits; apply(component,
    'final') gets the default look back, paused at Fixed time with the Preset
    menu on Custom. Setup controls (Refraction TOP, Faces, Object size, Flip
    screen V, Colour parameters) stay as they are. It changes the component's
    shared material, so glass in your own scene that uses it changes too.
    """
    experiments = json.loads(component.op("study_experiments").text)
    item = next((x for x in experiments if x["id"] == experiment_id), None)
    if item is None:
        raise ValueError("Unknown experiment: " + experiment_id)
    parameters = dict(item["parameters"])
    preset = parameters.pop("Preset", None)
    restored = reset(component)
    if preset is not None:
        # Load the preset's values directly; the menu says 'custom' so the
        # Preset callback cannot reload them over the experiment's overrides.
        component.op("presets").module.apply(component, preset)
    component.par.Preset.val = "custom"
    for name, value in parameters.items():
        getattr(component.par, name).val = value
    return {"experiment": experiment_id, "preset": preset, "parameters": parameters,
            "reset_to_default": len(restored), "expected": item["prediction"], "observed": "pending"}


def lights(component):
    """What the glass pass lights the glass with: its Lights parameter, resolved.

    Lights is an operator parameter, so eval() returns one OP, a list or None;
    evalOPs() always returns a list. A diagnostic never raises: whatever goes
    wrong here is reported, and capture() or export() still run."""
    render = component.op("render")
    if render is None or getattr(render.par, "lights", None) is None:
        return {"render": None}
    try:
        found = render.par.lights.evalOPs()
        return {"render": render.path, "expression": render.par.lights.expr,
                "lights": [n.name for n in found], "types": [[n.name, n.OPType] for n in found]}
    except Exception as error:
        return {"render": render.path, "error": repr(error)}


def blocking_errors(component):
    """Errors in the material and the demo's output chain."""
    found = {}
    for name in CORE_NODES:
        node = component.op(name)
        if node is not None and node.errors():
            found[name] = node.errors()
    return found


def inputs_report(component):
    """Errors and warnings of the Refraction TOP when it lives outside the
    component (your own scene render)."""
    report = {}
    par = getattr(component.par, "Refractiontop", None)
    if par is None:
        return report
    for node in par.evalOPs():
        if not node.path.startswith(component.path + "/"):
            report[node.path] = {"parameter": "Refractiontop", "errors": node.errors(),
                                 "warnings": node.warnings()}
    return report


def _draws_material(render, material):
    """True if this Render or Render Pass TOP draws `material`: through its
    Override Material, or through a Geometry COMP whose Material it is."""
    try:
        if render.par.overridemat.eval() == material:
            return True
    except Exception:
        pass
    try:
        geometry = render.par.geometry.evalOPs()
    except Exception:
        return False
    return any(_wears(geo, material) for geo in geometry)


def _wears(geo, material):
    par = getattr(geo.par, "material", None)
    try:
        return par is not None and par.eval() == material
    except Exception:
        return False


def _find(kinds):
    found = []
    for kind in kinds:
        try:
            found += list(op("/").findChildren(type=kind))  # noqa: F405 (td)
        except Exception:
            continue
    return found


def render_diagnostics(component, renders=None):
    """Errors and warnings of every Render and Render Pass TOP that draws the
    glass: the component's own renders and, in your scene, any render whose
    Override Material (or one of whose Geometry COMPs' Material) is the
    component's material. Each light setup compiles its own copy of the
    material inside the render that draws it, so compile errors can show there
    and not in info_material."""
    material = component.op("material")
    if renders is None:
        renders = _find(RENDER_TYPES)
        renders += [n for n in (component.op("demo_scene"), component.op("render"))
                    if n is not None and n not in renders]
    report = {}
    for r in renders:
        own = r.path.startswith(component.path + "/")
        if own or _draws_material(r, material):
            # The component's own renders by name (demo_scene, render), others by path.
            report[r.name if own else r.path] = {"errors": r.errors(), "warnings": r.warnings()}
    return report


def glass_objects(component, geometry=None, renders=None):
    """The Geometry COMPs that wear the material: those whose Material is it,
    and the Geometry of any render whose Override Material is it. Objects
    outside the component win; the demo torus counts only when there are none."""
    material = component.op("material")
    if geometry is None:
        geometry = _find((GEOMETRY_TYPE,)) if GEOMETRY_TYPE is not None else []
    if renders is None:
        renders = _find(RENDER_TYPES)
    found = [g for g in geometry if _wears(g, material)]
    for r in renders:
        try:
            if r.par.overridemat.eval() == material:
                found += list(r.par.geometry.evalOPs())
        except Exception:
            continue
    unique = list({g.path: g for g in found}.values())
    outside = [g for g in unique if not g.path.startswith(component.path + "/")]
    return outside or unique


def _world_scale(geo):
    """Uniform scale of a Geometry COMP's world transform (worldTransform, so
    parent transforms should count; native check pending): the cube root of the
    volume change, the same number as the shader's worldScale(), which sizes
    the ripple and film patterns."""
    try:
        return abs(geo.worldTransform.determinant()) ** (1.0 / 3.0)
    except Exception:
        return None


def demo_radius(s):
    """Half the largest side of the demo torus (Torus SOP, orient Z: radx + rady,
    1.45; its Geometry COMP is unscaled), the object the presets were tuned on:
    Object size 1 means this size. 1.45 is the family's reference radius
    (decisions.json, family_rule)."""
    torus = next(n for n in s["nodes"] if n["id"] == "demo_geo/torus")["parameters"]
    return float(torus["radx"]) + float(torus["rady"])


def fit_glass(component, geometry=None):
    """Set Inputs > Object size from the glass objects' own geometry.

    The objects are found for you (glass_objects()): every Geometry COMP that
    wears the material, or pass `geometry`, a list of Geometry COMPs. For
    each, reads the bounds of the SOP whose render flag is on inside it (the
    Geometry COMP's own bounds when there is none, for example with POPs),
    takes half the largest side and multiplies it by the COMP's world scale:
    about the object's radius in scene units. Several objects: the largest.
    Object size is that radius over the demo torus's (1.45), so the demo
    itself fits to 1. Object size then scales Thickness, Frost, Tint density
    and the ripple and film patterns, so a preset looks the same on a small
    and a large object, whether it was sized in its SOP or by its Geometry
    COMP's Scale. This is the family rule (decisions.json, family_rule).
    Returns what it measured; nothing else changes.
    """
    geos = list(geometry) if geometry is not None else glass_objects(component)
    if not geos:
        raise ValueError("No Geometry COMP wears this material: set a glass object's Material first")
    measured = []
    for geo in geos:
        sops = [c for c in getattr(geo, "children", []) if getattr(c, "isSOP", False) and c.render]
        if sops:
            bounds, source = sops[0].bounds(), sops[0].path
        else:
            bounds, source = geo.bounds(render=True), geo.path + " (Geometry COMP bounds)"
        half = max(bounds.size.x, bounds.size.y, bounds.size.z) / 2.0
        scale = _world_scale(geo)
        note = None
        if scale is None or not scale > 0.0:
            scale, note = 1.0, "world scale unreadable; used 1"
        measured.append({"source": source, "half_size": half, "world_scale": scale,
                         "radius": half * scale, "note": note})
    radius = max(m["radius"] for m in measured)
    if not radius > 0.0:
        raise ValueError("The glass objects are empty: nothing to fit")
    size = radius / demo_radius(spec(component))
    component.par.Objectsize.val = size
    return {"object_size": size, "radius": radius, "demo_radius": demo_radius(spec(component)),
            "measured": measured}


def inspect(component):
    s = spec(component)
    output = component.op(s["output"])
    # A forced Out TOP alone can reuse a cached Render TOP in the same frame, so
    # shaders and renders are cooked first. Deleted demo nodes are skipped.
    for node in s["nodes"]:
        child = component.op(node["id"])
        if child is not None and node["type"] in COOKED:
            child.cook(force=True)
    output.cook(force=True)
    return {
        "time_unix": time.time(), "build": str(app.build), "version": str(app.version),
        "platform": platform.platform(), "component": component.path,
        "resolution": [output.width, output.height],
        "parameters": {p.name: p.eval() for p in component.customPars if not p.isPulse},
        "demo_lights": lights(component),
        "errors": component.errors(recurse=True),
        "warnings": component.warnings(recurse=True),
        # Python exceptions in the preset callback or module land here, not in errors().
        "script_errors": component.scriptErrors(recurse=True) if hasattr(component, "scriptErrors") else "",
        "blocking_errors": blocking_errors(component),
        "inputs": inputs_report(component),
        "render_diagnostics": render_diagnostics(component),
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
            print(f"Liquid Glass Lit: {key.replace('_', ' ')} outside the material and output chain:\n{report[key]}")


def capture(component, filename):
    path = Path(filename).resolve()
    receipt = path.with_suffix(path.suffix + ".json")
    if path.exists() or receipt.exists():
        raise FileExistsError("Capture or receipt already exists")
    report = inspect(component)
    _refuse_or_report(report)
    # Create the folder only once the capture is allowed, so a refusal leaves nothing behind.
    path.parent.mkdir(parents=True, exist_ok=True)
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
    _refuse_or_report(report)
    path.parent.mkdir(parents=True, exist_ok=True)
    return str(component.save(str(path)))
