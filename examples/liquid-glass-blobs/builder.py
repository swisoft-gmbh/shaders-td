"""Build the Liquid Glass Blobs component inside TouchDesigner. No application outside TD.

Core nodes (the material, the blobs_geo proxy box, the preset system) are built
strictly: a missing parameter stops the build and names it. Demo nodes (the
backdrop, panorama, ring, camera, renders and the example layout chain), nodes
marked "lenient" (the blank stand-in TOP), sampler filter and extend settings
and a node's "lenient_parameters" (hints that may not exist in every build,
such as blobs_geo's Draw Priority) are built leniently. Each lenient failure
is recorded in the component's 'build_warnings' storage under a category that
says what it affects (see WARNING_NOTES), and printed grouped by category.
Adapted from the liquid-glass study's builder.py (commits a6f95c6 and 6a58487).
"""
from pathlib import Path
import json
from td import *

EMBEDDED = [("study_spec", "study.json"), ("study_experiments", "experiments.json"),
            ("study_tools", "native.py"), ("study_article", "article.md")]

WARNING_NOTES = {
    "material": "the blobs work, but frost, dispersion and reflection blur may look stepped "
                "or a blurred panorama may show a seam (sampler settings)",
    "inputs": "an Inputs field stayed in expression mode; see README > Use it on your own scene",
    "optional": "an optional diagnostic is missing (an Info DAT); the blobs are fine",
    "setup": "a helper setting failed (for example Draw Priority); the blobs should still work",
    "demo": "cosmetic, demo only; the blobs themselves are fine",
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
        return None


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


def link_demo_inputs(component, controls, nodes, warnings):
    """Point the input fields (Refraction TOP, Reflection TOP, Layout TOP) at
    the demo nodes, in constant mode.

    Constant mode keeps ordinary editing: drop a TOP on the field, type a path,
    clear it, or right-click > Reset to Default to bring the demo back. The path
    is checked here: it must resolve to the demo node and stay inside the
    component (so a renamed copy points at its own demo). Otherwise the field
    falls back to an expression and an 'inputs' warning says so. A demo node
    that was not built leaves its field empty, with an 'inputs' warning.
    From the liquid-glass study's builder.py (commit 6a58487).
    """
    for c in controls:
        target_id = c.get("demo_target")
        if not target_id:
            continue
        par = parameter(component, c["name"])
        target = nodes.get(target_id)
        if target is None:
            warnings.append(f"inputs: {c['name']} left empty, its demo node {target_id!r} was not built")
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
    node.seq.vec.numBlocks = len(vectors)
    for i, uniform in enumerate(vectors):
        set_value(node, f"vec{i}name", uniform["name"])
        for axis, value in zip("xyzw", uniform["values"]):
            if isinstance(value, str):
                set_expr(node, f"vec{i}value{axis}", value)
            else:
                set_value(node, f"vec{i}value{axis}", value)
    if not samplers:
        return
    node.seq.sampler.numBlocks = len(samplers)
    for i, sampler in enumerate(samplers):
        set_value(node, f"sampler{i}name", sampler["name"])
        set_expr(node, f"sampler{i}top", sampler["values"][0])
        # Lenient, but reported as material warnings: without Mipmap Linear,
        # frost and dispersion fall back to stepped copies; without the extend
        # modes, blurred panoramas can show a seam or bleed at the poles. The
        # layout TOP is read with texelFetch, so its settings do not matter.
        for key in ("filter", "extendu", "extendv"):
            if key in sampler:
                attempt(False, warnings, "material", set_value, node, f"sampler{i}{key}", sampler[key])


def make_node(component, nodes, item, source):
    owner = component if "/" not in item["id"] else nodes[item["id"].rsplit("/", 1)[0]]
    n = owner.create(item["type"], item["id"].split("/")[-1], initialize=False)
    n.nodeX, n.nodeY = item.get("position", [0, 0])
    n.comment = item.get("purpose", "")
    if "source" in item:
        n.text = (source / item["source"]).read_text()  # a Table DAT reads tab-separated text
    return n


def build(source_dir, parent_path="/project1"):
    source = Path(source_dir).resolve()
    spec = json.loads((source / "study.json").read_text())
    parent_op = op(parent_path) or op("/")
    component = parent_op.create(baseCOMP, spec["id"].replace("-", "_"))
    component.comment = (spec["title"] + ": raymarched liquid-glass blobs. Add ./blobs_geo to your Render TOP "
                         "and set Inputs > Refraction TOP to a render of your scene without it.")
    component.store("study_build", str(app.build))
    warnings = []
    add_controls(component, spec["controls"])

    nodes = {}
    for item in spec["nodes"]:
        strict = not (item.get("demo") or item.get("lenient"))
        category = "demo" if item.get("demo") else "setup"
        if "/" in item["id"] and item["id"].rsplit("/", 1)[0] not in nodes:
            warnings.append(f"{category}: {item['id']} skipped, its parent was not built")
            continue
        n = attempt(strict, warnings, category, make_node, component, nodes, item, source)
        if n is None:
            continue
        nodes[item["id"]] = n
        for name, value in item.get("parameters", {}).items():
            attempt(strict, warnings, category, set_value, n, name, value)
        for name, value in item.get("lenient_parameters", {}).items():
            attempt(False, warnings, category if item.get("demo") else "setup", set_value, n, name, value)
        for name, expression in item.get("expressions", {}).items():
            attempt(strict, warnings, category, set_expr, n, name, expression)
        for key, value in item.get("flags", {}).items():
            attempt(strict, warnings, category, setattr, n, key, value)
        if "uniforms" in item:
            attempt(strict, warnings, category, bind_uniforms, n, item["uniforms"], warnings)

    demo = {n["id"] for n in spec["nodes"] if n.get("demo") or n.get("lenient")}
    for edge in spec["wires"]:
        if edge["from"] not in nodes or edge["to"] not in nodes:
            warnings.append(f"demo: wire {edge['from']} -> {edge['to']} skipped, a node is missing")
            continue
        attempt(not ({edge["from"], edge["to"]} & demo), warnings, "demo",
                lambda e: nodes[e["to"]].inputConnectors[e.get("input", 0)].connect(nodes[e["from"]]), edge)
    for ref in spec.get("references", []):
        # Relative references survive loading the component under a new parent.
        if ref["node"] not in nodes or ref["target"] not in nodes:
            warnings.append(f"demo: {ref['node']}.{ref['parameter']} skipped, a node is missing")
            continue
        node = nodes[ref["node"]]
        attempt(not ({ref["node"], ref["target"]} & demo), warnings, "demo",
                set_value, node, ref["parameter"], node.relativePath(nodes[ref["target"]]))
    link_demo_inputs(component, spec["controls"], nodes, warnings)

    for i, (name, filename) in enumerate(EMBEDDED):
        dat = component.create(textDAT, name)
        dat.text = (source / filename).read_text()
        dat.nodeX, dat.nodeY = -700, 350 - 150 * i
    # Compile diagnostics stay directly inspectable: one Info DAT per GLSL node,
    # and per Render TOP (a render that draws the material compiles its own
    # copy of it, and its errors can show there rather than in info_material).
    for key, n in list(nodes.items()):
        if n.OPType in ("glslTOP", "glslMAT", "renderTOP", "renderpassTOP"):
            def add_info(key=key, n=n):
                info = component.create(infoDAT, "info_" + key.replace("/", "_"))
                info.par.op = info.relativePath(n)
                info.nodeX, info.nodeY = n.nodeX, n.nodeY - 120
            attempt(n.OPType == "glslMAT", warnings, "optional", add_info)

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
            print(f"{spec['title']} built with {category} warnings ({note}):\n  " + "\n  ".join(found))
    return component
