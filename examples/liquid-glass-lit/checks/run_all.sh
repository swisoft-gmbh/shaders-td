#!/usr/bin/env bash
# Rerun every check that works outside TouchDesigner and save the results.
#   PORT=8765 bash checks/run_all.sh          # PORT optional: a free port is picked if unset
#   CAPTURE=1 PORT=8765 bash checks/run_all.sh  # also re-render captures/ (WebGL previews)
# Needs: python3, glslangValidator, node with Playwright + Chromium (for the preview tests).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p checks/results
REPO=../..
PORT=${PORT:-$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1', 0)); print(s.getsockname()[1])")}
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"

python3 checks/compile_glsl.py > checks/results/compile.json
echo "compile: ok"
python3 -m http.server "$PORT" --bind 127.0.0.1 > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1
if [ "${CAPTURE:-0}" = "1" ]; then
  python3 checks/make_captures.py jobs checks/capture-jobs.json
  rm -f captures/preview-*.png captures/preview-*.png.json captures/preset-*.png captures/preset-*.png.json \
        captures/type-*.png captures/type-*.png.json captures/setup-*.png captures/setup-*.png.json
  node checks/capture.cjs "$PORT" checks/capture-jobs.json captures
  python3 checks/make_captures.py sheet
  python3 checks/make_captures.py strip
  python3 "$REPO/skills/explain/scripts/article.py" render .
fi
python3 checks/test_study.py > checks/results/unit-tests.txt 2>&1
echo "unit tests: ok"
python3 "$REPO/skills/review/scripts/check_study.py" . > checks/results/check_study.json
echo "check_study: ok"
python3 "$REPO/skills/explain/scripts/article.py" check . > checks/results/article-check.json
echo "article check: ok"
node checks/preview_tests.cjs "$PORT" > checks/results/preview-tests.json
echo "preview property tests: ok"
echo "All checks passed; results in checks/results/"
