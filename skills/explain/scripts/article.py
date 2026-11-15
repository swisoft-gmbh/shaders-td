#!/usr/bin/env python3
"""Render/check Markdown tutorials against real source regions and experiments."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

CODE = re.compile(r"\{\{code:([^:{}]+):([a-zA-Z0-9_-]+)\}\}")
EXPERIMENT = re.compile(r"\{\{experiment:([a-zA-Z0-9_-]+)\}\}")


def contained(root, value):
    p = root / value
    if p.is_symlink() or not p.resolve().is_relative_to(root.resolve()):
        raise ValueError("Path escapes study: " + value)
    return p


def region(root, file, name):
    p = contained(root, file)
    raw = p.read_bytes()
    lines = raw.decode().splitlines()
    # GLSL files mark a region with // @begin NAME, Python files with # @begin NAME.
    starts = [i for i, x in enumerate(lines) if x.strip() in ("// @begin " + name, "# @begin " + name)]
    ends = [i for i, x in enumerate(lines) if x.strip() in ("// @end " + name, "# @end " + name)]
    if len(starts) != 1 or len(ends) != 1 or ends[0] <= starts[0] + 1:
        raise ValueError(f"Invalid unique region {file}:{name}")
    a, b = starts[0] + 1, ends[0]
    return "\n".join(lines[a:b]), {"file":file,"region":name,"lines":[a+1,b],
                                  "sha256":hashlib.sha256(raw).hexdigest()}


def evidence(item):
    """How an experiment's picture was made: native, preview, port or pending.

    A picture is only called native when TouchDesigner rendered it. A preview
    ran the GLSL somewhere else (a browser); a port is a picture computed by a
    script that re-implements the shader's maths. Without an explicit
    "evidence" field, a capture counts as native (the bundled native
    examples), a "preview" entry as preview, and nothing as pending.
    """
    stated = item.get("evidence") or ("native" if item.get("capture") else
                                      "preview" if item.get("preview") else "pending")
    if stated not in ("native", "preview", "port", "pending"):
        raise ValueError(f"Unknown evidence label {stated!r} in experiment {item['id']}; "
                         "use native, preview, port or pending")
    return stated


def render(root):
    source = (root/"article.source.md").read_text()
    experiments = {x["id"]:x for x in json.loads((root/"experiments.json").read_text())}
    excerpts = []
    def code(match):
        file, name = match.groups()
        text, record = region(root, file, name)
        excerpts.append(record)
        fence = "python" if file.endswith(".py") else "glsl"
        return f"From [{file}]({file}), lines {record['lines'][0]}–{record['lines'][1]}:\n\n```{fence}\n{text}\n```"
    def experiment(match):
        id = match[1]
        item = experiments[id]
        kind = evidence(item)
        label = "Native experiment" if kind == "native" else "Experiment"
        text = (f"**{label} `{id}`:** {item['question']}\n\n"
                f"On the built component, run `component.op('study_tools').module.apply(component, '{id}')`.\n\n"
                f"Prediction: {item['prediction']}\n\n"
                f"Parameters: {', '.join(f'{k}={v}' for k,v in item['parameters'].items())}. "
                f"{item.get('note') or ('Reset history before observing.' if item.get('reset') else 'Time and unrelated controls are fixed by this preset.')}")
        if item.get("capture"):
            contained(root, item["capture"])
            if kind == "native":
                text += f"\n\n![Native {id} stage]({item['capture']})\n\n"
                text += f"Captured native stage; [capture conditions]({item['capture']}.json). "
            elif kind == "port":
                text += f"\n\n![Port of {id}: computed from the shader's maths, not rendered]({item['capture']})\n\n"
                text += "Picture from a script port of the shader's maths, not rendered by GLSL or TouchDesigner. "
            else:
                text += f"\n\n![Preview of {id}, not rendered in TouchDesigner]({item['capture']})\n\n"
                text += "Preview image, not rendered in TouchDesigner. "
            if item.get("observation"):
                text += item["observation"]
        return text
    result = EXPERIMENT.sub(experiment, CODE.sub(code, source))
    if "{{" in result:
        raise ValueError("Unresolved tutorial marker")
    return result, excerpts


def check(root):
    errors = []
    expected, excerpts = render(root)
    if (root/"article.md").read_text() != expected:
        errors.append("article.md differs from current source/experiments; render again")
    if json.loads((root/"article-snippets.json").read_text()) != excerpts:
        errors.append("Excerpt hashes or line ranges differ")
    source = (root/"article.source.md").read_text()
    # Split actual Markdown sections, not global marker occurrence.
    headings = list(re.finditer(r"^## (.+)$", source, re.M))
    titles = [m[1] for m in headings]
    if len(set(titles)) != len(titles):
        errors.append("Duplicate semantic section headings")
    sections = {m[1]: source[m.end():headings[i+1].start() if i+1<len(headings) else len(source)]
                for i,m in enumerate(headings)}
    plan = json.loads((root/"article-plan.json").read_text())
    if len({s["heading"] for s in plan}) != len(plan):
        errors.append("Duplicate plan section")
    teaching_sections = {heading for heading, body in sections.items()
                         if CODE.search(body) or EXPERIMENT.search(body)}
    if {s["heading"] for s in plan} != teaching_sections:
        errors.append("Plan does not cover exactly the sections containing teaching markers")
    exps = {x["id"] for x in json.loads((root/"experiments.json").read_text())}
    for s in plan:
        body = sections.get(s["heading"])
        if body is None:
            errors.append("Missing section: "+s["heading"])
            continue
        if not s.get("question") or not s.get("snippets") or not s.get("experiments"):
            errors.append("Section needs question, code and experiment: "+s["heading"])
        for file, name in s["snippets"]:
            if "{{code:"+file+":"+name+"}}" not in body:
                errors.append(f"Code not local to {s['heading']}: {file}:{name}")
        for id in s["experiments"]:
            if id not in exps or "{{experiment:"+id+"}}" not in body:
                errors.append(f"Experiment not local to {s['heading']}: {id}")
        for file in s.get("figures", []):
            if "]("+file+")" not in body or not contained(root,file).is_file():
                errors.append("Missing local figure: "+file)
    for file in re.findall(r"!\\?\[[^\]]*\]\(([^)]+)\)", expected):
        if not file.startswith(("https://","http://")) and not contained(root,file).is_file():
            errors.append("Missing image: "+file)
    return {"ok":not errors,"sections":len(plan),"excerpts":len(excerpts),"errors":errors,
            "scope":"Source integrity, semantic section placement and local figure presence; no visual or native certification."}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=["render","check"])
    p.add_argument("study",type=Path)
    a=p.parse_args()
    if not (a.study/"article.source.md").is_file():
        # Exit code 2: not a dossier-format study, so neither command applies. Nothing is written.
        print(f"No article.source.md in {a.study}: this script renders and checks tutorials in the "
              "plugin's own study format only. For any other tutorial, read the tutorial against "
              "the delivered source instead; lacking this file is not a defect.", file=sys.stderr)
        return 2
    if a.command=="render":
        text,excerpts=render(a.study)
        (a.study/"article.md").write_text(text)
        (a.study/"article-snippets.json").write_text(json.dumps(excerpts,indent=2)+"\n")
        return 0
    result=check(a.study)
    print(json.dumps(result,indent=2))
    return 0 if result["ok"] else 1


if __name__=="__main__":
    try:
        sys.exit(main())
    except (ValueError,KeyError,OSError) as e:
        print(str(e),file=sys.stderr)
        sys.exit(1)
