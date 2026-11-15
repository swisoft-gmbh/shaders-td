"""Build a declarative study inside TouchDesigner. No application outside TD."""
from pathlib import Path
import json
from td import *


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


def build(source_dir, parent_path="/project1"):
    source = Path(source_dir).resolve()
    spec = json.loads((source / "study.json").read_text())
    parent_op = op(parent_path)
    if parent_op is None:
        raise RuntimeError(f"Parent {parent_path} does not exist; pass an inspected parent path")
    component = parent_op.create(baseCOMP, spec["id"].replace("-", "_"))
    component.comment = spec["title"] + " — original archive-grounded native study"
    component.store("study_build", str(app.build))
    page = component.appendCustomPage("Study")
    for c in spec["controls"]:
        if c["type"] == "menu":
            par = page.appendMenu(c["name"], label=c["label"])[0]
            par.menuNames = c["names"]
            par.menuLabels = c["labels"]
        elif c["type"] == "toggle":
            par = page.appendToggle(c["name"], label=c["label"])[0]
        else:
            par = page.appendFloat(c["name"], label=c["label"])[0]
            par.min, par.max = c.get("min", 0), c.get("max", 1)
            par.normMin, par.normMax = par.min, par.max
            par.clampMin, par.clampMax = True, True
        par.default = c["default"]
        par.val = c["default"]
    nodes = {}
    for item in spec["nodes"]:
        owner = component if "/" not in item["id"] else nodes[item["id"].rsplit("/", 1)[0]]
        n = owner.create(item["type"], item["id"].split("/")[-1], initialize=False)
        nodes[item["id"]] = n
        n.nodeX, n.nodeY = item.get("position", [0, 0])
        n.comment = item.get("purpose", "")
        if "source" in item:
            n.text = (source / item["source"]).read_text()
        for name, value in item.get("parameters", {}).items():
            set_value(n, name, value)
        for name, expression in item.get("expressions", {}).items():
            parameter(n, name).expr = expression
        if "flags" in item:
            for key, value in item["flags"].items():
                setattr(n, key, value)
        if "uniforms" in item:
            uniforms = item["uniforms"]
            n.seq.vec.numBlocks = len(uniforms)
            for i, uniform in enumerate(uniforms):
                set_value(n, f"vec{i}name", uniform["name"])
                for axis, value in zip("xyzw", uniform["values"]):
                    if isinstance(value, str):
                        parameter(n, f"vec{i}value{axis}").expr = value
                    else:
                        set_value(n, f"vec{i}value{axis}", value)
    for edge in spec["wires"]:
        nodes[edge["to"]].inputConnectors[edge.get("input", 0)].connect(nodes[edge["from"]])
    for ref in spec.get("references", []):
        # Relative references survive loading the component under a new parent.
        set_value(nodes[ref["node"]], ref["parameter"], nodes[ref["node"]].relativePath(nodes[ref["target"]]))
    for name, filename in [("study_spec", "study.json"), ("study_experiments", "experiments.json"),
                           ("study_tools", "native.py"), ("study_article", "article.md")]:
        dat = component.create(textDAT, name)
        dat.text = (source / filename).read_text()
        dat.nodeX, dat.nodeY = -450, -200 - 120 * ["study_spec", "study_experiments", "study_tools", "study_article"].index(name)
    # GLSL compilation diagnostics remain directly inspectable.
    for key, n in list(nodes.items()):
        if n.OPType in ("glslTOP", "glslMAT"):
            info = component.create(infoDAT, "info_" + key.replace("/", "_"))
            info.par.op = info.relativePath(n)
            info.nodeX, info.nodeY = n.nodeX, n.nodeY - 160
    for ref in spec.get("references", []):
        if ref.get("previous_frame"):
            parameter(nodes[ref["node"]], "resetpulse").pulse()
    output = nodes[spec["output"]]
    output.viewer = True
    component.viewer = True
    if getattr(component.par, "opviewer", None):
        component.par.opviewer = component.relativePath(output)
    output.cook(force=True)
    component.store("study_spec_id", spec["id"])
    return component
