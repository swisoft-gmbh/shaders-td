#!/usr/bin/env python3
"""Check a dossier-format study's recipe without TouchDesigner.

Reads study.json, experiments.json and the shader sources a study names, and
reports contradictions between them: unknown nodes, wire cycles, uniforms that
are declared but not bound (or bound but not declared), a missing output
swizzle, a #version line. It does not compile GLSL or run TouchDesigner.

Exit codes: 0 passed, 1 errors found, 2 the folder is not a dossier-format
study (no study.json), so this checker does not apply.
"""
import argparse
import ast
import json
from pathlib import Path
import re
import sys

SHADER_PARAMETERS = ("pixeldat", "vertexdat", "vdat", "pdat")
COMMENT = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)
UNIFORM = re.compile(r"\buniform\s+([^;{}]+);")
OPAQUE_TYPE = re.compile(r"[iu]?(sampler|image|texture)")
NODE_ID = re.compile(r"[A-Za-z][A-Za-z0-9_]*(/[A-Za-z][A-Za-z0-9_]*)*")


def strip_comments(source):
    """Blank out comments and keep every newline, so line numbers still match."""
    return COMMENT.sub(lambda m: re.sub(r"[^\n]", " ", m.group()), source)


def split_top_level(text):
    """Split on commas that are not inside parentheses or brackets."""
    parts, depth, start = [], 0, 0
    for i, char in enumerate(text):
        depth += char in "(["
        depth -= char in ")]"
        if char == "," and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    return parts + [text[start:]]


def declared_uniforms(source):
    """Map each uniform the shader declares to 'sampler' or 'vector'.

    Handles `uniform float uA, uB;`, arrays, precision qualifiers and
    initialisers. Names TouchDesigner declares itself (uTD..., sTD...) are
    left out, because the study never binds them.
    """
    found = {}
    for body in UNIFORM.findall(strip_comments(source)):
        declarators = [d.split("=")[0].strip() for d in split_top_level(body)]
        head = declarators[0].split()
        if len(head) < 2:
            continue
        kind = "sampler" if OPAQUE_TYPE.match(head[-2]) else "vector"
        for declarator in [head[-1]] + declarators[1:]:
            name = re.match(r"\w+", declarator)
            if name and not name.group().startswith(("uTD", "sTD")):
                found[name.group()] = kind
    return found


def check(folder):
    errors = []
    root = folder.resolve()

    def file(name):
        path = root / name
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError("Unsafe source path: " + name)
        if not path.is_file():
            raise ValueError("Missing source file: " + name)
        return path

    spec = json.loads(file("study.json").read_text())
    for key in ("nodes", "controls", "output", "wires"):
        if key not in spec:
            raise ValueError(f"study.json has no {key!r}")
    references = spec.get("references", [])
    nodes = {n["id"]: n for n in spec["nodes"]}
    if len(nodes) != len(spec["nodes"]):
        errors.append("Duplicate node IDs")
    controls = {c["name"]: c for c in spec["controls"]}
    if len(controls) != len(spec["controls"]):
        errors.append("Duplicate controls")
    if spec["output"] not in nodes:
        errors.append("Missing output")
    for name in ("build.py", "builder.py", "native.py"):
        ast.parse(file(name).read_text(), filename=name)

    for node in nodes.values():
        if not NODE_ID.fullmatch(node["id"]):
            errors.append("Invalid node path")
        if "/" in node["id"] and node["id"].rsplit("/", 1)[0] not in nodes:
            errors.append("Missing parent node")
        if "source" in node and node["source"].endswith(".py"):
            try:
                ast.parse(file(node["source"]).read_text(), filename=node["source"])
            except SyntaxError as error:
                errors.append(f"{node['source']}: {error.msg} (line {error.lineno})")
        if "source" in node and node["source"].endswith((".frag", ".vert")):
            code = strip_comments(file(node["source"]).read_text())
            if re.search(r"^\s*#version", code, re.M):
                errors.append("TouchDesigner supplies #version")
            if node["source"].endswith(".frag") and "TDOutputSwizzle" not in code:
                errors.append("Fragment output has no native swizzle")

    adjacency = {node_id: [] for node_id in nodes}
    slots = set()
    for edge in spec["wires"]:
        if edge["from"] not in nodes or edge["to"] not in nodes:
            errors.append("Wire references missing node")
            continue
        slot = (edge["to"], edge.get("input", 0))
        if slot in slots:
            errors.append("Two wires occupy one input")
        slots.add(slot)
        adjacency[edge["from"]].append(edge["to"])
    seen, active = set(), set()

    def visit(node_id):
        if node_id in active:
            raise ValueError("Same-frame wire cycle; use explicit history reference")
        if node_id in seen:
            return
        active.add(node_id)
        for target in adjacency[node_id]:
            visit(target)
        active.remove(node_id)
        seen.add(node_id)

    for node_id in nodes:
        visit(node_id)

    for ref in references:
        if ref["node"] not in nodes or ref["target"] not in nodes:
            errors.append("Parameter reference targets missing node")
        elif ref.get("previous_frame") and (nodes[ref["node"]]["type"] != "feedbackTOP" or ref["parameter"] != "top"):
            errors.append("History reference must originate at Feedback TOP target")

    for node in nodes.values():
        declared = {}
        for ref in references:
            target = nodes.get(ref["target"], {})
            if ref["node"] == node["id"] and ref["parameter"] in SHADER_PARAMETERS and "source" in target:
                declared.update(declared_uniforms(file(target["source"]).read_text()))
        bound = {"vector": set(), "sampler": set()}
        for uniform in node.get("uniforms", []):
            kind = uniform.get("kind", "vector")
            if kind not in ("vector", "color", "sampler"):
                errors.append(f"{node['id']}: unknown uniform kind {kind!r} for {uniform['name']}")
                continue
            bound["sampler" if kind == "sampler" else "vector"].add(uniform["name"])
            sizes = {"vector": (1, 4), "color": (3, 4), "sampler": (1, 1)}[kind]
            if not sizes[0] <= len(uniform["values"]) <= sizes[1]:
                errors.append("Invalid vector size")
            for expression in uniform["values"]:
                if isinstance(expression, str):
                    for name in re.findall(r"parent\(\)\.par\.(\w+)", expression):
                        if name not in controls:
                            errors.append("Unknown control: " + name)
        for kind, label in (("vector", "uniform"), ("sampler", "sampler")):
            difference = {name for name, k in declared.items() if k == kind} ^ bound[kind]
            if difference:
                errors.append(f"{node['id']}: {label} declarations/bindings differ: {sorted(difference)}")

    experiments = json.loads(file("experiments.json").read_text())
    if len({e["id"] for e in experiments}) != len(experiments):
        errors.append("Duplicate experiment IDs")
    for experiment in experiments:
        if not experiment.get("question") or not experiment.get("prediction"):
            errors.append("Incomplete experiment")
        for name, value in experiment["parameters"].items():
            if name not in controls:
                errors.append("Unknown experiment control: " + name)
            elif controls[name]["type"] == "menu" and value not in controls[name]["names"]:
                errors.append("Unknown menu value")
    return {"ok": not errors, "nodes": len(nodes), "wires": len(spec["wires"]),
            "experiments": len(experiments), "errors": errors,
            "scope": "Static recipe contracts; no native compilation or visual certification."}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("study", type=Path)
    args = parser.parse_args()
    if not (args.study / "study.json").is_file():
        print(f"No study.json in {args.study}: this checker reads dossier-format studies only. "
              "For a plain project, read the project's shaders, builder and tutorial instead; "
              "lacking a dossier is not a defect.", file=sys.stderr)
        return 2
    result = check(args.study)
    print(json.dumps(result, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyError as error:
        print(f"Missing key {error} in study.json or experiments.json", file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, SyntaxError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
