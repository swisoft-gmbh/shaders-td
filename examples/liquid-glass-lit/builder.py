"""Build the Liquid Glass Lit component inside TouchDesigner. No application outside TD.

Core nodes (the material, its shader DATs, the preset system) are built
strictly: a missing parameter stops the build and names it. Demo nodes (the
backdrop and its card, environment map, Environment Light, Light COMPs, torus,
occluder, camera, scene render and glass pass), nodes marked "lenient" (the
blank stand-in TOP), sampler filter and extend settings and a node's
"lenient_parameters" (the renders' Dither switch) are built leniently: a demo
node or setting that this build does not offer is skipped. Each lenient
failure is recorded in the component's 'build_warnings' storage under a
category that says what it affects (see WARNING_NOTES), and printed grouped by
category. The material never depends on the demo: it takes its light from
whichever render draws it.
"""
from pathlib import Path
import json
from td import *

# Nodes that get an Info DAT (info_<node>) for compile and render messages:
# each light setup compiles its own copy of the material inside the render.
INFO_TYPES = ("glslTOP", "glslMAT", "renderTOP", "renderpassTOP")

EMBEDDED = [("study_spec", "study.json"), ("study_experiments", "experiments.json"),
            ("study_tools", "native.py"), ("study_article", "article.md")]

WARNING_NOTES = {
    "material": "the material works, but frost may look stepped or strong refraction "
                "may smear at the frame edge (sampler settings)",
    "inputs": "an Inputs field stayed in expression mode; see README > Use it in your own lit scene",
    "dither": "a render's Dither could not be switched off; turn it off by hand "
              "(Advanced page) so the output stays continuous",
    "setup": "a helper setting failed; the material should still work",
    "demo": "cosmetic, demo only; the material itself is fine",
}


def parameter(node, name):
    value = getattr(node.par, name, None)
    if value is None:
        raise RuntimeError(f"{node.path}: parameter {name!r} unavailable in build {app.build}")
    return value


def set_value(node, name, value):
    par = parameter(node, name)
    if par.isMenu and isinstance(value, str) and value not in par.menuNames:
        raise RuntimeError(f"{node.path}.{name}: {value!r} not in {list(par.menuNames)}")
    par.val = value


def set_expr(node, name, expression):
    parameter(node, name).expr = expression


def attempt(strict, warnings, category, action, *args):
    if strict:
        return action(*args)
    try:
        return action(*args)
    except Exception as error:  # reported under its category, never hidden
        warnings.append(f"{category}: {error}")


def add_controls(component, controls):
    pages, groups = {}, set()
    for c in controls:
        if c["page"] not in pages:
            pages[c["page"]] = component.appendCustomPage(c["page"])
        page, kind = pages[c["page"]], c["type"]
        if kind in ("rgb", "xyz"):
            if c["group"] not in groups:
                groups.add(c["group"])
                (page.appendRGB if kind == "rgb" else page.appendXYZ)(c["group"], label=c["label"])
            par = parameter(component, c["name"])
            par.normMin, par.normMax = c["min"], c["max"]
            if kind == "rgb":
                par.min, par.clampMin = 0.0, True
        elif kind == "menu":
            par = page.appendMenu(c["name"], label=c["label"])[0]
            par.menuNames = c["names"]
            par.menuLabels = c["labels"]
        elif kind == "toggle":
            par = page.appendToggle(c["name"], label=c["label"])[0]
        elif kind == "pulse":
            page.appendPulse(c["name"], label=c["label"])
            continue
        elif kind in ("float", "int"):
            maker = page.appendFloat if kind == "float" else page.appendInt
            par = maker(c["name"], label=c["label"])[0]
            par.min, par.max = c["min"], c["max"]
            par.normMin, par.normMax = c["min"], c["max"]
            par.clampMin = c["min"] >= 0
            par.clampMax = kind == "int" or (c["min"] == 0 and c["max"] == 1)
        elif kind in ("top", "comp", "object"):
            maker = {"top": page.appendTOP, "comp": page.appendCOMP, "object": page.appendObject}[kind]
            par = maker(c["name"], label=c["label"])[0]
        else:
            raise RuntimeError("Unknown control type " + kind)
        if c.get("expression"):
            par.expr = c["expression"]
        elif c.get("default") is not None:
            par.default = c["default"]
            par.val = c["default"]
        # Controls with "demo_target" are linked by link_demo_inputs() once the
        # demo nodes exist.


def link_demo_inputs(component, controls, warnings):
    """Point the Inputs-page fields at the demo nodes, in constant mode.

    Constant mode keeps ordinary editing: drop a TOP on the field, type a path,
    clear it, or right-click > Reset to Default to bring the demo back. The path
    is checked here: it must resolve to the demo node and stay inside the
    component (so a renamed copy points at its own demo). Otherwise the field
    falls back to an expression and an 'inputs' warning says so.
    """
    for c in controls:
        target_id = c.get("demo_target")
        if not target_id:
            continue
        par = parameter(component, c["name"])
        target = component.op(target_id)
        if target is None:
            warnings.append(f"inputs: {c['name']} left empty: demo node {target_id} was not built")
            continue
        path = component.relativePath(target)
        try:
            par.val = path
            resolved = par.eval()
            portable = not path.startswith(("/", "..")) and component.name not in path.split("/")
            if getattr(resolved, "path", None) == target.path and portable:
                par.default = path
                continue
            reason = f"{path!r} resolved to {resolved!r}"
        except Exception as error:
            reason = str(error)
        expression = f"me.op('{target_id}')"
        par.expr = expression
        try:
            par.defaultExpr = expression
            par.defaultMode = ParMode.EXPRESSION
        except Exception as error:
            reason += f"; Reset to Default will not restore it ({error})"
        warnings.append(f"inputs: {c['name']} uses the expression {expression} ({reason})")


def bind_uniforms(node, uniforms, warnings):
    vectors = [u for u in uniforms if u.get("kind") != "sampler"]
    samplers = [u for u in uniforms if u.get("kind") == "sampler"]
    if vectors:
        node.seq.vec.numBlocks = len(vectors)
    for i, uniform in enumerate(vectors):
        set_value(node, f"vec{i}name", uniform["name"])
        for axis, value in zip("xyzw", uniform["values"]):
            if isinstance(value, str):
                set_expr(node, f"vec{i}value{axis}", value)
            else:
                set_value(node, f"vec{i}value{axis}", value)
    node.seq.sampler.numBlocks = len(samplers)
    for i, sampler in enumerate(samplers):
        set_value(node, f"sampler{i}name", sampler["name"])
        set_expr(node, f"sampler{i}top", sampler["values"][0])
        # Lenient, but reported as material warnings: without Mipmap Linear,
        # frost falls back to stepped copies; without the extend mode, strong
        # refraction near the frame edge depends on the build's default.
        for key in ("filter", "extendu", "extendv"):
            if key in sampler:
                attempt(False, warnings, "material", set_value, node, f"sampler{i}{key}", sampler[key])


def build(source_dir, parent_path="/project1"):
    source = Path(source_dir).resolve()
    spec = json.loads((source / "study.json").read_text())
    parent_op = op(parent_path) or op("/")
    component = parent_op.create(baseCOMP, spec["id"].replace("-", "_"))
    component.comment = (spec["title"] + ": liquid glass lit by the scene's Light and Environment Light COMPs "
                         "(assign ./material to any Geometry COMP)")
    component.store("study_build", str(app.build))
    warnings = []
    add_controls(component, spec["controls"])

    nodes = {}
    for item in spec["nodes"]:
        strict = not (item.get("demo") or item.get("lenient"))
        category = "demo" if item.get("demo") else "setup"
        parent_id = item["id"].rsplit("/", 1)[0] if "/" in item["id"] else None
        if parent_id is not None and parent_id not in nodes:
            warnings.append(f"demo: skipped {item['id']}: parent {parent_id} was not built")
            continue
        owner = component if parent_id is None else nodes[parent_id]
        # initialize=False, as in the core study: no default children (a new Geometry COMP
        # would otherwise bring its own torus).
        n = attempt(strict, warnings, category, lambda: owner.create(item["type"], item["id"].split("/")[-1],
                                                                     initialize=False))
        if n is None:
            warnings.append(f"{category}: skipped node {item['id']} ({item['type']})")
            continue
        nodes[item["id"]] = n
        n.nodeX, n.nodeY = item.get("position", [0, 0])
        n.comment = item.get("purpose", "")
        if "source" in item:
            n.text = (source / item["source"]).read_text()
        for name, value in item.get("parameters", {}).items():
            attempt(strict, warnings, category, set_value, n, name, value)
        for name, value in item.get("lenient_parameters", {}).items():
            attempt(False, warnings, "dither" if name == "dither" else category, set_value, n, name, value)
        for name, expression in item.get("expressions", {}).items():
            attempt(strict, warnings, category, set_expr, n, name, expression)
        for key, value in item.get("flags", {}).items():
            setattr(n, key, value)
        if "uniforms" in item:
            attempt(strict, warnings, category, bind_uniforms, n, item["uniforms"], warnings)

    for edge in spec["wires"]:
        if edge["to"] in nodes and edge["from"] in nodes:
            nodes[edge["to"]].inputConnectors[edge.get("input", 0)].connect(nodes[edge["from"]])
        else:
            warnings.append(f"demo: skipped wire {edge['from']} -> {edge['to']}")
    for ref in spec.get("references", []):
        # Relative references survive loading the component under a new parent.
        if ref["node"] not in nodes or ref["target"] not in nodes:
            warnings.append(f"demo: skipped reference {ref['node']}.{ref['parameter']}")
            continue
        node = nodes[ref["node"]]
        attempt(not spec_node(spec, ref["node"]).get("demo"), warnings, "demo",
                set_value, node, ref["parameter"], node.relativePath(nodes[ref["target"]]))
    link_demo_inputs(component, spec["controls"], warnings)

    for i, (name, filename) in enumerate(EMBEDDED):
        dat = component.create(textDAT, name)
        dat.text = (source / filename).read_text()
        dat.nodeX, dat.nodeY = -700, 350 - 150 * i
    # GLSL compile diagnostics stay directly inspectable. Renders get one too:
    # each light setup compiles its own copy of the material inside the render.
    for key, n in list(nodes.items()):
        if n.OPType in INFO_TYPES:
            info = component.create(infoDAT, "info_" + key.replace("/", "_"))
            info.par.op = info.relativePath(n)
            info.nodeX, info.nodeY = n.nodeX, n.nodeY - 120

    output = nodes.get(spec["output"])
    if output is not None:
        output.viewer = True
        component.viewer = True
        if getattr(component.par, "opviewer", None) is not None:
            component.par.opviewer = component.relativePath(output)
        output.cook(force=True)
    component.store("study_spec_id", spec["id"])
    component.store("build_warnings", warnings)
    for category, note in WARNING_NOTES.items():
        found = [w for w in warnings if w.startswith(category + ":")]
        if found:
            print(f"Liquid Glass Lit built with {category} warnings ({note}):\n  " + "\n  ".join(found))
    return component


def spec_node(spec, node_id):
    return next(n for n in spec["nodes"] if n["id"] == node_id)
