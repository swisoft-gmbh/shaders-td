#!/usr/bin/env python3
"""Start a new study from a bundled example; never overwrite.

The copy is a seed for a new brief, not a finished study, so everything that
is evidence about the example is left behind or reset:

- native/ (the example's .tox) and captures/ are not copied;
- experiments lose their captures and observations, validation.json goes back
  to pending, decisions.json and co-design.json are emptied;
- builder.py and native.py are replaced by the current bundled scripts (the
  examples keep the older copies their .tox was built with);
- every code file gets a licence header and the folder a NOTICE.md;
- the tutorial is rendered again, so it no longer shows the example's images.

brief.md, sources.json, README.md, article.source.md and figures/ still
describe the example. Rewrite them for the new brief.
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

SCRIPTS = Path(__file__).resolve().parent
PLUGIN = SCRIPTS.parents[2]
SEEDS = ["contour-loom", "phosphor-memory", "contour-material", "orbital-relic",
         "lantern-fog", "pigment-census", "resonant-foil", "tidal-ink"]
HEADER = [
    "shaders-td seed, Copyright (c) 2026 Swisoft GmbH. Licensed CC BY-NC 4.0:",
    "non-commercial use only, credit required. See NOTICE.md in this folder.",
    "Techniques after Maxime Heckel's articles, https://blog.maximeheckel.com",
]
NOTICE = """# Licence and credit for this study

This study was started from a seed of Shaders for TouchDesigner (shaders-td).

**Terms.** The seed is licensed CC BY-NC 4.0
(https://creativecommons.org/licenses/by-nc/4.0/). Files that still contain
seed code are an adaptation of it and stay under these terms: non-commercial
use only. Paid shows, commissions and client work are not covered.

**Credit.** Keep this line with the study and with anything you publish from
it:

> Built with Shaders for TouchDesigner by Swisoft GmbH (CC BY-NC 4.0).
> Techniques after Maxime Heckel's shader articles, blog.maximeheckel.com.
> Not affiliated with or endorsed by Maxime Heckel or Derivative.

Maxime Heckel is the original author of the techniques this toolkit teaches.
His articles are CC BY-NC 4.0 and his blog code is MIT; if you copy from
either, their terms and his name travel with the copy.

A file you write from scratch for your own brief is yours.
"""
COMMENT = {".py": "# ", ".frag": "// ", ".vert": "// ", ".glsl": "// "}


def add_header(path):
    lines = path.read_text().splitlines(keepends=True)
    header = [COMMENT[path.suffix] + line + "\n" for line in HEADER]
    keep = 1 if lines and lines[0].startswith("#!") else 0
    path.write_text("".join(lines[:keep] + header + lines[keep:]))


def reset_records(study):
    """Reset what recorded the example's results; the new study has none yet."""
    experiments = study / "experiments.json"
    items = json.loads(experiments.read_text())
    for item in items:
        for key in ("capture", "observation", "preview"):
            item.pop(key, None)
    experiments.write_text(json.dumps(items, indent=2) + "\n")
    validation = study / "validation.json"
    if validation.is_file():
        pending = {key: {"status": "pending", "evidence": None} for key in json.loads(validation.read_text())}
        validation.write_text(json.dumps(pending, indent=2) + "\n")
    if (study / "decisions.json").is_file():
        (study / "decisions.json").write_text("[]\n")
    if (study / "co-design.json").is_file():
        (study / "co-design.json").write_text(json.dumps({
            "purpose": "", "shader_acceptance": "pending", "article_acceptance": "pending",
            "user_feedback": []}, indent=2) + "\n")


def drop_capture_references(study):
    """The example's hero image and its 'Captured in TouchDesigner' line go with captures/."""
    source = study / "article.source.md"
    if not source.is_file():
        return
    kept = [line for line in source.read_text().splitlines(keepends=True)
            if "](captures/" not in line and not line.startswith("Captured in TouchDesigner")]
    source.write_text(re.sub(r"\n{3,}", "\n\n", "".join(kept)))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("destination", type=Path)
    p.add_argument("--example", choices=SEEDS, default="contour-loom")
    a = p.parse_args()
    if a.destination.exists():
        p.error("Destination already exists")
    source = PLUGIN / "examples" / a.example
    if not source.is_dir():
        p.error(f"examples/{a.example} is not in this copy of the plugin ({PLUGIN}). "
                "Without the examples, start by hand: copy native_builder.py as builder.py and "
                f"native_tools.py as native.py from {SCRIPTS}, then write study.json, "
                "experiments.json and the shader as references/dossier.md describes.")
    shutil.copytree(source, a.destination, ignore=shutil.ignore_patterns("native", "captures", "__pycache__"))
    shutil.copyfile(SCRIPTS / "native_builder.py", a.destination / "builder.py")
    shutil.copyfile(SCRIPTS / "native_tools.py", a.destination / "native.py")
    reset_records(a.destination)
    drop_capture_references(a.destination)
    for path in sorted(a.destination.rglob("*")):
        if path.is_file() and path.suffix in COMMENT:
            add_header(path)
    (a.destination / "NOTICE.md").write_text(NOTICE)
    article = PLUGIN / "skills/explain/scripts/article.py"
    rendered = article.is_file() and subprocess.run(
        [sys.executable, "-B", str(article), "render", str(a.destination)]).returncode == 0
    print(f"Started {a.destination.resolve()} from the {a.example} seed.")
    print("Left behind or reset: native/, captures/, experiment observations, validation.json, "
          "decisions.json, co-design.json.")
    print("Still about the example, rewrite for your brief: brief.md, sources.json, README.md, "
          "article.source.md, figures/.")
    if not rendered:
        print("The tutorial was not rendered again; run article.py render before you rely on article.md.")
    print("Licence: CC BY-NC 4.0, non-commercial, credit required (NOTICE.md). "
          "Run build.py inside TouchDesigner to build the network.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
