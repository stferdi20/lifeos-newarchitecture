#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-$SERVICE_DIR/.venv/bin/python}"
WORKER_HOST="${WORKER_HOST:-127.0.0.1}"
WORKER_PORT="${WORKER_PORT:-9001}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Expected Python worker runtime at $PYTHON_BIN" >&2
  echo "Create the virtualenv first: cd \"$SERVICE_DIR\" && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

cd "$SERVICE_DIR"
exec "$PYTHON_BIN" -m uvicorn app.main:app --host "$WORKER_HOST" --port "$WORKER_PORT"
