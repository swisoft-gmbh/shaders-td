#!/usr/bin/env bash
# Build the release files from the committed tree: bash .github/package.sh VERSION OUTPUT_DIR
# Produces shaders-td-VERSION.zip (the plugin), one ZIP per liquid-glass study, shader.zip with
# all five, and SHA256SUMS.txt. Reads HEAD, so uncommitted changes are not packaged.
set -euo pipefail
version="$1"
out="$2"
studies="liquid-glass liquid-glass-blobs liquid-glass-flow liquid-glass-lit liquid-glass-prism"

# zip_folder FOLDER TARGET writes TARGET.zip with FOLDER's contents at its root.
zip_folder() {
  python3 -c "import shutil, sys; shutil.make_archive(sys.argv[2], 'zip', sys.argv[1])" "$1" "$2"
}

test "$(jq -r .version plugin.json)" = "$version"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

git archive --format=zip --prefix=shaders-td/ -o "$out/shaders-td-$version.zip" HEAD -- . ':(exclude).github'

# Each study ZIP has the study at its root plus the licence files.
for study in $studies; do
  mkdir -p "$stage/$study"
  git archive HEAD "examples/$study" | tar -x -C "$stage/$study" --strip-components=2
  cp LICENSE NOTICE.md ATTRIBUTION.md THIRD-PARTY.md "$stage/$study/"
  zip_folder "$stage/$study" "$out/$study"
done

# shader.zip holds all five studies and the family overview as its README.
mkdir -p "$stage/all"
for study in $studies; do
  mkdir -p "$stage/all/$study"
  git archive HEAD "examples/$study" | tar -x -C "$stage/all/$study" --strip-components=2
done
git show HEAD:examples/LIQUID-GLASS.md > "$stage/all/README.md"
cp LICENSE NOTICE.md ATTRIBUTION.md THIRD-PARTY.md "$stage/all/"
zip_folder "$stage/all" "$out/shader"

(cd "$out" && sha256sum ./*.zip > SHA256SUMS.txt)
ls -la "$out"
