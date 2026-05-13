#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --dev: run Vite dev server (port 5173) + Python backend (port 8765) together
if [[ "${1:-}" == "--dev" ]]; then
  echo "Starting Python backend on :8765..."
  uv run -m ui --port 8765 &
  BACKEND_PID=$!
  trap "kill $BACKEND_PID 2>/dev/null" EXIT
  echo "Starting Vite dev server on :5173..."
  cd frontend && npm run dev
  exit 0
fi

# Default: build frontend then serve via Python server
echo "Building frontend..."
cd frontend && npm run build
cd "$SCRIPT_DIR"
echo "Starting server on :8765..."
source .venv/bin/activate
uv run -m ui