#!/usr/bin/env bash
# Rerun every check that works outside TouchDesigner and save the results.
#   PORT=<free port> bash checks/run_all.sh
# Needs: python3, glslangValidator, node with Playwright + Chromium (for the preview tests).
# Previews in captures/ are made separately: bash checks/capture_all.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p checks/results
PORT=${PORT:-8765}
REPO=../..

python3 checks/compile_glsl.py > checks/results/compile.json
python3 checks/test_study.py > checks/results/unit-tests.txt 2>&1
python3 "$REPO/skills/review/scripts/check_study.py" . > checks/results/check_study.json
python3 "$REPO/skills/explain/scripts/article.py" check . > checks/results/article-check.json

python3 -m http.server "$PORT" --bind 127.0.0.1 > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1
NODE_PATH="${NODE_PATH:-$(npm root -g)}" node checks/preview_tests.cjs "$PORT" > checks/results/preview-tests.json 2> checks/results/preview-tests.log
echo "All checks passed; results in checks/results/"
