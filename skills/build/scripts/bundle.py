#!/usr/bin/env python3
"""Create a downloadable source ZIP using Python's standard library only."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

SKIP = {".git", "node_modules", "__pycache__", ".DS_Store"}


def create_bundle(study_directory, destination):
    source = Path(study_directory).resolve()
    target = Path(destination).resolve()
    if not source.is_dir():
        raise NotADirectoryError(source)
    if target == source or source in target.parents:
        raise ValueError("Put the ZIP outside the study folder")
    if target.exists():
        raise FileExistsError("Choose a new ZIP filename")
    entries = []
    for path in sorted(source.rglob("*")):
        rel = path.relative_to(source)
        if any(part in SKIP for part in rel.parts):
            continue
        if path.is_symlink():
            raise ValueError("Do not bundle symlinks: " + str(rel))
        if path.is_file():
            if path.name == ".env" or path.name.startswith(".env."):
                raise ValueError("Remove environment credentials before bundling")
            entries.append((path, rel.as_posix()))
    if not entries:
        raise ValueError("Study folder is empty")
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED) as archive:
        for path, relative in entries:
            archive.write(path, relative)
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise ValueError("ZIP integrity failed")
    return {"file": str(target), "files": [rel for _, rel in entries],
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            "validation": "archive integrity only; no shader or host execution"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("study_directory", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    print(json.dumps(create_bundle(args.study_directory, args.destination), indent=2))


if __name__ == "__main__":
    main()
