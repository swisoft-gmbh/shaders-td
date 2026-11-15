"""Embedded helper module: explicit native actions, never implicit export.

Use from the Textport after building:
    helpers = component.op('study_tools').module
    helpers.apply(component, 'swell')
    helpers.fit_glass(component)  # same as the Flow fit > Fit to Glass geometry pulse
    helpers.inspect(component)
    helpers.capture(component, '/new/folder/swell.png')
    helpers.export(component, '/new/folder/liquid_glass_flow.tox')

The Liquid Glass helpers (examples/liquid-glass). fit_glass() has the core's
name and sets Object size as the core's does (the family rule); here it also
sets Flow centre and Flow size, in the SOP's own units, because the liquid
field lives there. fit_flow is its old name, kept one round as an alias.
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
# Reflection map that says how to read it, Camera, Glass geometry, Flip screen
# V, Colour parameters, Demo render, and on the Flow fit page Flow centre,
# Flow size, Object size, Gravity direction, Wave direction and Instance
# variation).
# Faces, Displace along and Correct normals are reset: the demo experiments
# vary them (open sheet, cracks, wrong normals).
KEEP = ("Preset",)
# Nodes that only run while Back-face pass is on.
BACKFACE_NODES = ("render_back",)
# Nodes whose errors stop capture() and export(); others are only reported.
CORE_NODES = ("material", "render", "over", "out")
# Operator types whose errors render_diagnostics() reports when they draw the glass.
RENDER_TYPES = (renderTOP, renderpassTOP) if "renderTOP" in globals() else ()  # noqa: F405 (td)


def spec(component):
    return json.loads(component.op("study_spec").text)


def look_defaults(s):
    """Default value of every control an experiment resets: the preset values
    (look and motion), Morph and its target, Samples, Energy conserving,
    Panorama rotation, Flat image warp, Light direction, Back-face pass, Faces,
    Displace along, Correct normals and the Study page (Pause, Fixed time,
    Teaching stage, Demo spin, Backdrop, Demo object, Demo detail); not Preset
    or "setup" controls."""
    return {c["name"]: c["default"] for c in s["controls"]
            if c.get("default") is not None and c["type"] != "pulse"
            and not c.get("setup") and c["name"] not in KEEP}


def apply(component, experiment_id):
    """Set one named teaching experiment from experiments.json.

    Every control in look_defaults() first returns to its default, so the
    result never depends on earlier experiments or edits; apply(component,
    'final') gets the default look back, paused at Fixed time with the Preset
    menu on Custom. Setup controls (scene inputs, Reflection map, Demo render,
    the flow fit of your object) stay as they are. It changes the component's shared material, so glass in
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


def _world_scale(geo):
    """Uniform scale of a Geometry COMP's world transform (parents included):
    the cube root of the volume change, as the shader's worldScale() computes
    it for the ripple and film patterns."""
    try:
        return abs(geo.worldTransform.determinant()) ** (1.0 / 3.0)
    except Exception:
        return None


def torus_radius(s):
    """Half the largest side of the demo torus (Torus SOP, orient Z: radx + rady,
    1.45): the family's reference radius. Object size 1 means this size, here
    as in the core and Liquid Glass Lit (Liquid Glass Lit decisions.json, family_rule)."""
    torus = next(n for n in s["nodes"] if n["id"] == "demo_geo/torus")["parameters"]
    return float(torus["radx"]) + float(torus["rady"])


def fit_glass(component, geometry=None):
    """Set Flow centre, Flow size and Object size from a Geometry COMP's geometry.

    Reads the bounds of the SOP whose render flag is on inside the Geometry
    COMP (Inputs > Glass geometry unless one is given; with several, the
    first: the motion has one centre). SOP bounds are in the SOP's own space,
    before the Geometry COMP's transform.

    Flow centre = the bounds' centre, Flow size = half the largest side (the
    demo sphere measures exactly 1). Both are in SOP units, because the
    motion happens before TDDeform; the Geometry COMP's transform then moves
    and scales the moved surface.

    Object size follows the Liquid Glass family rule (Liquid Glass Lit
    decisions.json, family_rule): half the largest side times the COMP's world
    scale (cube root of |det| of its worldTransform, parents included), over
    the reference radius 1.45, the demo torus. The demo sphere fits to
    1 / 1.45. Object size multiplies Thickness and Frost and divides Tint
    density, Wobble scale and the film swirl; the shader also counts the COMP's
    scale in the ripple and film lookups. So a preset looks the same on a
    small and a large object, sized in its SOP or by its Geometry COMP, and
    the same as in Liquid Glass on the same object. A non-uniform scale counts
    as its average; per-instance scale is not seen.
    One component fits one object. Returns what it measured.
    """
    geos = [geometry] if geometry is not None else list(component.par.Glassgeo.evalOPs())
    if not geos:
        raise ValueError("Set Inputs > Glass geometry to the Geometry COMP first")
    geo = geos[0]
    sops = [c for c in getattr(geo, "children", []) if getattr(c, "isSOP", False) and c.render]
    if sops:
        bounds, source = sops[0].bounds(), sops[0].path
    else:  # no rendered SOP (POPs, for example): ask the Geometry COMP itself
        bounds, source = geo.bounds(render=True, recurse=False), geo.path + " (Geometry COMP bounds)"
    size = max(bounds.size.x, bounds.size.y, bounds.size.z) / 2.0
    if not size > 0.0:
        raise ValueError(source + ": empty geometry, nothing to fit")
    notes = []
    scale = _world_scale(geo)
    if scale is None or not scale > 0.0:
        scale = 1.0
        notes.append(f"{geo.path}: world scale unreadable; Object size uses 1")
    elif abs(scale - 1.0) > 1e-3:
        notes.append(f"{geo.path} is scaled {scale:.3g}x by its transform: Object size counts it, "
                     "Flow size (SOP units) does not need to")
    if len(geos) > 1:
        notes.insert(0, f"fitted to {geo.path} only: one component fits one object")
    reference = torus_radius(spec(component))
    object_size = size * scale / reference
    component.par.Flowcentrex.val = bounds.center.x
    component.par.Flowcentrey.val = bounds.center.y
    component.par.Flowcentrez.val = bounds.center.z
    component.par.Flowsize.val = size
    component.par.Objectsize.val = object_size
    return {"source": source, "centre": [bounds.center.x, bounds.center.y, bounds.center.z],
            "flow_size": size, "object_size": object_size, "world_scale": scale,
            "reference_radius": reference, "notes": notes}


# The old name, kept for one round: fit_flow() was this helper's name until the
# family critic's one-name fix (review.md, Family critic: one Fit name). The
# core's tests still call it. Remove it once nothing calls it.
fit_flow = fit_glass  # alias


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
            print(f"Liquid Glass Flow: {key.replace('_', ' ')} outside the material and output chain:\n{report[key]}")


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
