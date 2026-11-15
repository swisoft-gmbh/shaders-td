"""Embedded helper module: explicit native actions, never implicit export.

Use from the Textport after building:
    helpers = component.op('study_tools').module
    helpers.apply(component, 'critical_high')
    helpers.fit_glass(component)        # Object size from Inputs > Glass geometry
    helpers.inspect(component)
    helpers.backface_report(component)  # is the optional back-face pass wired right?
    helpers.capture(component, '/new/folder/critical_high.png')
    helpers.export(component, '/new/folder/liquid_glass_prism.tox')

The core Liquid Glass study's helpers (family sync after commit 6a58487),
plus backface_report() for this study's back-face pass. Object size follows
the family rule (Liquid Glass Lit decisions.json, family_rule): the object's
world radius over REFERENCE_RADIUS, the core's demo torus. This study's
flattened demo torus measures less (demo_radius()), so it fits to about 0.873,
the default of Inputs > Object size.
"""
from pathlib import Path
import json
import platform
import time
from td import *

# Controls that apply() never resets. Writing Preset would fire the preset
# callback over the experiment's values; it is set to 'custom' instead.
# Controls marked "setup" in study.json are never reset either: they describe
# your scene and its cost, not a look (Refraction TOP, Reflection TOP and the
# Reflection map that says how to read it, Faces, Camera, Glass geometry,
# Object size, Flip screen V, Colour parameters, Demo render).
KEEP = ("Preset",)
# Nodes that only run while Back-face pass is on.
BACKFACE_NODES = ("render_back",)
# Nodes whose errors stop capture() and export(); others are only reported.
CORE_NODES = ("material", "render", "over", "out")
# Operator types whose errors render_diagnostics() reports when they draw the glass.
RENDER_TYPES = (renderTOP, renderpassTOP) if "renderTOP" in globals() else ()  # noqa: F405 (td)
# Object size 1 means an object of this world radius: the core study's demo
# torus (Torus SOP, radius 1 + 0.45, unscaled). The family rule's number.
REFERENCE_RADIUS = 1.45


def spec(component):
    return json.loads(component.op("study_spec").text)


def look_defaults(s):
    """Default value of every control an experiment resets: the preset values,
    Morph and its target, Samples, Energy conserving, Panorama rotation, Flat
    image warp, Light direction, Back-face pass and the Study page (Pause,
    Fixed time, Teaching stage, Demo spin, Demo backdrop); not Preset or
    "setup" controls."""
    return {c["name"]: c["default"] for c in s["controls"]
            if c.get("default") is not None and c["type"] != "pulse"
            and not c.get("setup") and c["name"] not in KEEP}


def apply(component, experiment_id):
    """Set one named teaching experiment from experiments.json.

    Every control in look_defaults() first returns to its default, so the
    result never depends on earlier experiments or edits; apply(component,
    'final') gets the default look back, paused at Fixed time with the Preset
    menu on Custom. Setup controls (scene inputs, Reflection map, Demo render)
    stay as they are. It changes the component's shared material, so glass in
    your own scene that uses it changes too.
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


def blocking_errors(component):
    """Errors in the material and the output chain (and the back-face pass when on)."""
    names = list(CORE_NODES)
    if component.par.Backface.eval():
        names += ["material_back", *BACKFACE_NODES]
    found = {}
    for name in names:
        node = component.op(name)
        if node is not None and node.errors():
            found[name] = node.errors()
    return found


def inputs_report(component):
    """Errors and warnings of the TOPs and COMPs the Inputs page points at,
    when they live outside the component (your own scene)."""
    report = {}
    for name in ("Refractiontop", "Reflectiontop", "Camera", "Glassgeo"):
        par = getattr(component.par, name, None)
        if par is None:
            continue
        for node in par.evalOPs():
            if not node.path.startswith(component.path + "/"):
                report[node.path] = {"parameter": name, "errors": node.errors(),
                                     "warnings": node.warnings()}
    return report


def _inside(component, node):
    return node is not None and node.path.startswith(component.path + "/")


def backface_report(component, sample=False):
    """Is the optional back-face pass usable? Lists what is missing, if anything.

    sample=True also reads render_back back to the CPU once (numpyArray, a
    validation step that can stall; never call it every frame) and reports
    how many texels hold glass. The pass stores minus the eye distance in
    alpha, so glass is alpha < 0 and any background reads as empty.
    """
    on = bool(component.par.Backface.eval())
    problems, warnings = [], []
    back = component.op("render_back")
    report = {"enabled": on, "resolution": [back.width, back.height] if on else None,
              "glass_objects": [o.path for o in component.par.Glassgeo.evalOPs()]}
    if on:
        camera = component.par.Camera.eval()
        if not camera:
            problems.append("Inputs > Camera is empty")
        if not report["glass_objects"]:
            problems.append("Inputs > Glass geometry is empty")
        refraction = component.par.Refractiontop.eval()
        if refraction and (back.width, back.height) != (refraction.width, refraction.height):
            problems.append("render_back resolution differs from the Refraction TOP")
        # The demo defaults point inside the component. With your own scene
        # wired to the Refraction TOP, they would measure the demo torus.
        if refraction is not None and not _inside(component, refraction):
            if _inside(component, camera):
                warnings.append("Inputs > Camera still points at the demo camera; use the camera of your scene render")
            if any(_inside(component, op(path)) for path in report["glass_objects"]):
                warnings.append("Inputs > Glass geometry still lists the demo object; list your glass objects")
        if sample:
            pixels = back.numpyArray()
            glass = int((pixels[:, :, 3] < 0.0).sum())
            report["glass_texels"] = glass
            if glass == 0:
                warnings.append("render_back holds no glass: check Camera, Glass geometry and that material_back renders")
    report.update({"ready": on and not problems, "problems": problems, "warnings": warnings})
    return report


def _world_scale(geo):
    """Uniform scale of a Geometry COMP's world transform (parents included):
    the cube root of the volume change, as the shader's worldScale() computes
    it for the ripple and film patterns."""
    try:
        return abs(geo.worldTransform.determinant()) ** (1.0 / 3.0)
    except Exception:
        return None


def demo_radius(s):
    """The demo torus's size as fit_glass() measures an object: half the
    largest side of its SOP (Torus SOP, orient Z: radx + rady = 1.5) times the
    cube root of the demo Geometry COMP's scale (sz 0.6 flattens it), about
    1.265. Over REFERENCE_RADIUS that is about 0.873: the demo's Object size,
    and the control's default, so pressing Fit on the demo changes nothing."""
    nodes = {n["id"]: n for n in s["nodes"]}
    torus = nodes["demo_geo/torus"]["parameters"]
    geo = nodes["demo_geo"].get("parameters", {})
    volume = float(geo.get("sx", 1.0)) * float(geo.get("sy", 1.0)) * float(geo.get("sz", 1.0))
    return (float(torus["radx"]) + float(torus["rady"])) * abs(volume) ** (1.0 / 3.0)


def fit_glass(component, geometry=None):
    """Set Inputs > Object size from the glass objects' own geometry.

    For each Geometry COMP in Inputs > Glass geometry (or `geometry`), reads
    the bounds of the SOP whose render flag is on inside it (the Geometry
    COMP's own bounds when there is none, for example with POPs), takes half
    the largest side and multiplies it by the COMP's world scale: about the
    object's radius in scene units. Several objects: the largest. Object size
    is that radius over REFERENCE_RADIUS (1.45, the core study's demo torus),
    rounded to 6 significant digits; this study's flattened demo torus fits
    to about 0.873, the control's default. Object size then scales Thickness,
    Scene depth, Frost, Tint density and the ripple and film patterns (the
    shader counts the COMP's scale in the pattern lookups too), so a preset
    looks the same on a small and a large object, whether it was sized in its
    SOP or by its Geometry COMP's Scale. This is the family rule (Liquid Glass
    Lit decisions.json, family_rule). A non-uniform scale counts as its
    average (cube root of the determinant); per-instance scale is not seen.
    Returns what it measured; nothing else changes.
    """
    geos = [geometry] if geometry is not None else list(component.par.Glassgeo.evalOPs())
    if not geos:
        raise ValueError("Set Inputs > Glass geometry to your glass Geometry COMP(s) first")
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
        raise ValueError("Glass geometry is empty: nothing to fit")
    size = float(f"{radius / REFERENCE_RADIUS:.6g}")
    component.par.Objectsize.val = size
    return {"object_size": size, "radius": radius, "reference_radius": REFERENCE_RADIUS,
            "measured": measured}


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
    for geo in geometry:
        par = getattr(geo.par, "material", None)
        try:
            if par is not None and par.eval() == material:
                return True
        except Exception:
            continue
    return False


def render_diagnostics(component, renders=None):
    """Errors and warnings of every Render and Render Pass TOP that draws the
    glass: the component's own renders and, in your scene, any render whose
    Override Material (or one of whose Geometry COMPs' Material) is the
    component's material. Each render compiles its own copy of the material,
    so compile errors can show there and not in info_material."""
    material = component.op("material")
    if renders is None:
        renders = []
        for kind in RENDER_TYPES:
            try:
                renders += list(op("/").findChildren(type=kind))  # noqa: F405 (td)
            except Exception:
                continue
    report = {}
    for r in renders:
        own = r.path.startswith(component.path + "/")
        if own and r.name in BACKFACE_NODES and not component.par.Backface.eval():
            continue
        if own or _draws_material(r, material):
            report[r.path] = {"errors": r.errors(), "warnings": r.warnings()}
    return report


def inspect(component):
    s = spec(component)
    backface = bool(component.par.Backface.eval())
    # A forced Out TOP alone can reuse a cached Render TOP in the same frame, so
    # shaders and renders are cooked first. Deleted demo nodes are skipped, and
    # the optional back-face pass only cooks while it is on.
    for node in s["nodes"]:
        if node["type"] not in ("glslMAT", "glslTOP", "renderTOP"):
            continue
        if node["id"] in BACKFACE_NODES and not backface:
            continue
        n = component.op(node["id"])
        if n is not None:
            n.cook(force=True)
    output = component.op(s["output"])
    output.cook(force=True)
    return {
        "time_unix": time.time(), "build": str(app.build), "version": str(app.version),
        "platform": platform.platform(), "component": component.path,
        "resolution": [output.width, output.height],
        "parameters": {p.name: p.eval() for p in component.customPars if not p.isPulse},
        "backface": backface_report(component),
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
            print(f"Liquid Glass Prism: {key.replace('_', ' ')} outside the material and output chain:\n{report[key]}")


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
