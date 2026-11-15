#!/usr/bin/env bash
# Re-render every WebGL preview in captures/ (experiments and presets) and the
# three contact sheets (checker, type, back-face pass). Slow with SwiftShader (a few minutes).
#   PORT=<free port> bash checks/render_previews.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8765}
JOBS=$(mktemp)
python3 checks/capture_jobs.py > "$JOBS"
python3 -m http.server "$PORT" --bind 127.0.0.1 > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true; rm -f "$JOBS"' EXIT
sleep 1
NODE_PATH="${NODE_PATH:-$(npm root -g)}" node checks/capture.cjs "$PORT" "$JOBS" captures
python3 checks/contact_sheet.py
python3 checks/contact_sheet.py -type
python3 checks/contact_sheet.py -backpass
