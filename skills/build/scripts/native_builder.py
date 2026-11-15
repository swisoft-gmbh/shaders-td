"""Build a declarative study inside TouchDesigner. No application outside TD.

study.json lists controls, nodes, wires and references. add_controls() lists
the control types. A node may carry:

  parameters   {name: value}        values set on the operator
  expressions  {name: expression}   parameters put in expression mode
  sequences    {sequence: blocks}   size a parameter sequence before its
                                    parameters are set, e.g. {"const": 3}
  uniforms     [{name, values, kind}]
               kind "vector" (default) binds on the Vectors page,
               kind "color" on the Colors page (values r, g, b and optional alpha),
               kind "sampler" on the Samplers page (values[0] is an expression
               that evaluates to the TOP)
  lenient      true: a parameter or sequence this build does not have becomes
               a stored warning instead of stopping the build. Use it for demo
               nodes and for names known only from documentation. Leave core
               nodes strict, so a broken shader stops the build and names the
               parameter.

The Colors and Samplers bindings follow Derivative's parameter names
(color0name, color0rgbr, color0alpha, sampler0name, sampler0top). They are
unit-tested against a fake td module; run the build once in your TouchDesigner
build before relying on them.
"""
from pathlib import Path
import json
from td import *

GLSL_TYPES = ("glslTOP", "glslmultiTOP", "glslMAT")
EMBEDDED = [("study_spec", "study.json"), ("study_experiments", "experiments.json"),
            ("study_tools", "native.py"), ("study_article", "article.md")]


def parameter(node, name):
    value = getattr(node.par, name, None)
    if value is None:
        raise RuntimeError(f"{node.path}: parameter {name!r} unavailable in build {app.build}")
    return value


def sequence(node, name):
    found = getattr(node.seq, name, None)
    if found is None:
        raise RuntimeError(f"{node.path}: parameter sequence {name!r} unavailable in build {app.build}")
    return found


def set_value(node, name, value):
    par = parameter(node, name)
    if par.isMenu and isinstance(value, str) and value not in par.menuNames:
        raise RuntimeError(f"{node.path}.{name}: {value!r} not in {list(par.menuNames)}")
    par.val = value


def set_expression(node, name, expression):
    parameter(node, name).expr = expression


def set_any(node, name, value):
    """A string is an expression, anything else a constant."""
    (set_expression if isinstance(value, str) else set_value)(node, name, value)


def set_blocks(node, name, count):
    sequence(node, name).numBlocks = count


def bind_uniforms(node, uniforms, write):
    """Bind each uniform on the page its kind belongs to."""
    by_kind = {"vector": [], "color": [], "sampler": []}
    for uniform in uniforms:
        by_kind[uniform.get("kind", "vector")].append(uniform)
    if by_kind["vector"]:
        write(set_blocks, node, "vec", len(by_kind["vector"]))
    for i, uniform in enumerate(by_kind["vector"]):
        write(set_value, node, f"vec{i}name", uniform["name"])
        for axis, value in zip("xyzw", uniform["values"]):
            write(set_any, node, f"vec{i}value{axis}", value)
    if by_kind["color"]:
        write(set_blocks, node, "color", len(by_kind["color"]))
    for i, uniform in enumerate(by_kind["color"]):
        write(set_value, node, f"color{i}name", uniform["name"])
        for field, value in zip(("rgbr", "rgbg", "rgbb", "alpha"), list(uniform["values"]) + [1]):
            write(set_any, node, f"color{i}{field}", value)
    if by_kind["sampler"]:
        write(set_blocks, node, "sampler", len(by_kind["sampler"]))
    for i, uniform in enumerate(by_kind["sampler"]):
        write(set_value, node, f"sampler{i}name", uniform["name"])
        write(set_any, node, f"sampler{i}top", uniform["values"][0])


def add_controls(component, controls):
    """Create the custom parameters and set their defaults.

    Types: float, int, toggle, menu, string, pulse; rgb and xyz, written as one
    entry per channel (Inkr, Inkg, Inkb) that share a "group" (Ink); and top,
    comp and object for fields that point at another operator. "page" names
    the custom page (default Study). "expression" sets an expression instead
    of a default. A pulse has no value.
    """
    pages, groups = {}, set()
    for c in controls:
        name, kind, label = c["name"], c["type"], c["label"]
        page_name = c.get("page", "Study")
        if page_name not in pages:
            pages[page_name] = component.appendCustomPage(page_name)
        page = pages[page_name]
        if kind == "pulse":
            page.appendPulse(name, label=label)
            continue
        if kind in ("rgb", "xyz"):
            group = c.get("group", name[:-1])
            if group not in groups:
                groups.add(group)
                (page.appendRGB if kind == "rgb" else page.appendXYZ)(group, label=label)
            par = parameter(component, name)
        elif kind == "menu":
            par = page.appendMenu(name, label=label)[0]
            par.menuNames = c["names"]
            par.menuLabels = c["labels"]
        elif kind in ("toggle", "string", "top", "comp", "object"):
            maker = {"toggle": page.appendToggle, "string": page.appendStr, "top": page.appendTOP,
                     "comp": page.appendCOMP, "object": page.appendObject}[kind]
            par = maker(name, label=label)[0]
        elif kind in ("float", "int"):
            par = (page.appendInt if kind == "int" else page.appendFloat)(name, label=label)[0]
            par.min, par.max = c.get("min", 0), c.get("max", 1)
            par.normMin, par.normMax = par.min, par.max
            par.clampMin, par.clampMax = True, True
        else:
            raise RuntimeError(f"Unknown control type {kind!r} for {name}")
        if c.get("expression"):
            par.expr = c["expression"]
        elif c.get("default") is not None:
            par.default = c["default"]
            par.val = c["default"]


def build(source_dir, parent_path="/project1"):
    source = Path(source_dir).resolve()
    spec = json.loads((source / "study.json").read_text())
    parent_op = op(parent_path)
    if parent_op is None:
        raise RuntimeError(f"Parent {parent_path} does not exist; pass an inspected parent path")
    component = parent_op.create(baseCOMP, spec["id"].replace("-", "_"))
    component.comment = spec["title"] + " — original archive-grounded native study"
    component.store("study_build", str(app.build))
    warnings = []
    add_controls(component, spec["controls"])
    nodes = {}
    for item in spec["nodes"]:
        owner = component if "/" not in item["id"] else nodes[item["id"].rsplit("/", 1)[0]]
        n = owner.create(item["type"], item["id"].split("/")[-1], initialize=False)
        nodes[item["id"]] = n
        n.nodeX, n.nodeY = item.get("position", [0, 0])
        n.comment = item.get("purpose", "")
        if "source" in item:
            n.text = (source / item["source"]).read_text()
        lenient = bool(item.get("lenient"))

        def write(action, *args):
            """One parameter write. On a lenient node a failure is recorded, not raised."""
            try:
                action(*args)
            except (RuntimeError, AttributeError) as error:
                if not lenient:
                    raise
                warnings.append(str(error))

        for name, count in item.get("sequences", {}).items():
            write(set_blocks, n, name, count)
        for name, value in item.get("parameters", {}).items():
            write(set_value, n, name, value)
        for name, expression in item.get("expressions", {}).items():
            write(set_expression, n, name, expression)
        for key, value in item.get("flags", {}).items():
            setattr(n, key, value)
        if "uniforms" in item:
            bind_uniforms(n, item["uniforms"], write)
    for edge in spec["wires"]:
        nodes[edge["to"]].inputConnectors[edge.get("input", 0)].connect(nodes[edge["from"]])
    for ref in spec.get("references", []):
        # Relative references survive loading the component under a new parent.
        set_value(nodes[ref["node"]], ref["parameter"], nodes[ref["node"]].relativePath(nodes[ref["target"]]))
    for index, (name, filename) in enumerate(EMBEDDED):
        if not (source / filename).is_file() and filename == "article.md":
            warnings.append("article.md is not written yet; study_article was not embedded")
            continue
        dat = component.create(textDAT, name)
        dat.text = (source / filename).read_text()
        dat.nodeX, dat.nodeY = -450, -200 - 120 * index
    # GLSL compilation diagnostics remain directly inspectable.
    for key, n in list(nodes.items()):
        if n.OPType in GLSL_TYPES:
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
    component.store("study_warnings", warnings)
    if warnings:
        print(f"{len(warnings)} build warning(s); the study was built without these settings:")
        for warning in warnings:
            print("  " + warning)
    return component
