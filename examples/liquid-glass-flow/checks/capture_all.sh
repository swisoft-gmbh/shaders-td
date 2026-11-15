#!/usr/bin/env bash
# Re-render every WebGL preview in captures/ (slow: about 40 renders in SwiftShader).
#   PORT=<free port> bash checks/capture_all.sh
# Needs: python3 with Pillow, node with Playwright + Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8766}
python3 checks/capture_jobs.py
python3 -m http.server "$PORT" --bind 127.0.0.1 > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1
NODE_PATH="${NODE_PATH:-$(npm root -g)}" node checks/capture.cjs "$PORT" checks/capture-jobs.json captures
python3 checks/contact_sheet.py
