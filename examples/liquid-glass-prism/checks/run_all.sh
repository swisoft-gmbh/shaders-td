#!/usr/bin/env bash
# Rerun every check that works outside TouchDesigner and save the results.
#   PORT=<free port> bash checks/run_all.sh
# Needs: python3, glslangValidator, node with Playwright + Chromium (for the preview tests).
# Every check runs even if an earlier one fails; the script exits non-zero if any failed.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p checks/results
PORT=${PORT:-8765}
REPO=../..
FAILED=()

run() {  # run <name> <output file> <command...>
    local name=$1 out=$2; shift 2
    if "$@" > "$out" 2>&1; then echo "passed  $name"; else echo "FAILED  $name (see $out)"; FAILED+=("$name"); fi
}

run "GLSL compile (stand-ins) + negative test" checks/results/compile.json python3 checks/compile_glsl.py
run "unit tests" checks/results/unit-tests.txt python3 checks/test_study.py
run "check_study.py" checks/results/check_study.json python3 "$REPO/skills/review/scripts/check_study.py" .
run "article.py check" checks/results/article-check.json python3 "$REPO/skills/explain/scripts/article.py" check .

python3 -m http.server "$PORT" --bind 127.0.0.1 > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1
run "preview property tests (WebGL2)" checks/results/preview-tests.json \
    env NODE_PATH="${NODE_PATH:-$(npm root -g)}" node checks/preview_tests.cjs "$PORT"

if [ ${#FAILED[@]} -eq 0 ]; then
    echo "All checks passed; results in checks/results/"
else
    echo "Failed: ${FAILED[*]}"
    exit 1
fi
