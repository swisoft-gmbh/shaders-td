#!/usr/bin/env python3
"""Inspect or export archived Sandpack source. Never install or execute it."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import sys

REF = Path(__file__).resolve().parent.parent / "references"
PLUGIN = REF.parent.parent.parent

def load(name):
    return json.loads((REF / name).read_text())

def safe_path(value):
    if not value.startswith("/") or value.startswith("//") or "\\" in value:
        raise ValueError("Invalid virtual path: " + value)
    parts = value[1:].split("/")
    if any(x in ("", ".", "..") for x in parts) or ":" in value or "\0" in value:
        raise ValueError("Unsafe virtual path: " + value)
    return PurePosixPath(*parts)

def validate(scene, payloads, sources):
    for source_id, expected in scene["source_sha256"].items():
        record = sources[source_id]
        path = (PLUGIN / record["path"]).resolve()
        if not path.is_relative_to((REF / "corpus").resolve()):
            raise ValueError("Out-of-corpus source")
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected or actual != record["sha256"]:
            raise ValueError("Source hash mismatch: " + source_id)
    for virtual_path, meta in scene["files"].items():
        safe_path(virtual_path)
        actual = hashlib.sha256(payloads[meta["sha256"]].encode()).hexdigest()
        if actual != meta["sha256"]:
            raise ValueError("Payload hash mismatch: " + virtual_path)
        if not set(meta["source_ids"]).issubset(scene["source_sha256"]):
            raise ValueError("Missing literal source provenance")

def export(scene, payloads, sources, destination):
    if not scene["exportable"]:
        raise ValueError("Scene requires manual adaptation; inspect extraction_issues.")
    validate(scene, payloads, sources)
    destination = Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError("Destination already exists; choose a new directory.")
    # Validate every name and collision before any write.
    reserved = {"demo-manifest.json", "DEPENDENCIES.json", "README-REFERENCE.md", "SOURCE-LICENSE.txt"}
    paths = [safe_path(p) for p in scene["files"]]
    if any(str(p) in reserved for p in paths):
        raise ValueError("Virtual file conflicts with export metadata.")
    destination.mkdir(parents=True, exist_ok=False)
    for name, meta in scene["files"].items():
        path = destination / safe_path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(payloads[meta["sha256"]], encoding="utf-8")
    (destination / "demo-manifest.json").write_text(json.dumps(scene, indent=2) + "\n")
    recipe = {key: scene[key] for key in
              ("template", "dependencies", "template_inherited_packages", "external_urls", "runtime_status")}
    (destination / "DEPENDENCIES.json").write_text(json.dumps(recipe, indent=2) + "\n")
    license_record = sources["licenses/BLOG-CODE-MIT.txt"]
    shutil.copyfile(PLUGIN / license_record["path"], destination / "SOURCE-LICENSE.txt")
    (destination / "README-REFERENCE.md").write_text(
        "# Archived source export\n\n"
        f"Original work: Maxime Heckel. Article: {scene['article_url']}\n\n"
        f"Scene: `{scene['id']}`. Template: `{scene['template']}`.\n\n"
        "This is a decoded reference, not a tested standalone application. "
        "No dependencies were installed and no archived JavaScript was executed. "
        "The original Sandpack host supplied bundling, loaders and template defaults. "
        "Read DEPENDENCIES.json, resolve template-inherited packages, inspect raw-loader "
        "imports and remote assets, and choose a current compatible project setup "
        "before running. Version ranges are preserved, not a dependency lockfile.\n\n"
        "demo-manifest.json records original source hashes and literal locations. "
        "Preserve source notices and article attribution when adapting. Consult the "
        "plugin's source-formats.md for known discrepancies and adaptation cautions.\n")
    return {"destination": str(destination), "files": len(paths), "runtime_status": "not-run"}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("list")
    p.add_argument("--article", default="")
    p = sub.add_parser("show"); p.add_argument("id")
    p = sub.add_parser("export"); p.add_argument("id"); p.add_argument("destination")
    sub.add_parser("verify")
    args = parser.parse_args()
    catalog = load("demo-catalog.json")
    scenes = {r["id"]: r for r in catalog["scenes"]}
    if args.command == "list":
        result = [{"id": r["id"], "files": len(r["files"]),
                   "template": r["template"], "exportable": r["exportable"],
                   "external_url_count": len(r["external_urls"])}
                  for r in scenes.values() if args.article in r["article"]]
    elif args.command == "show":
        result = scenes[args.id]
    else:
        payloads = load("demo-payloads.json")
        sources = {r["id"]: r for r in load("corpus/manifest.json")["files"]}
        if args.command == "export":
            result = export(scenes[args.id], payloads, sources, args.destination)
        else:
            for scene in scenes.values(): validate(scene, payloads, sources)
            if len(scenes) != len(catalog["scenes"]): raise ValueError("Duplicate scene ID")
            result = {"ok": True, "scenes": len(scenes), "payloads": len(payloads),
                      "runtime_status": "not-run"}
    print(json.dumps(result, indent=2))
    return 0

if __name__ == "__main__":
    try: sys.exit(main())
    except (KeyError, ValueError, OSError) as e:
        print("Error: " + str(e), file=sys.stderr); sys.exit(1)
