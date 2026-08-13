#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Run ./setup-ubuntu.sh and edit the generated file." >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

if [[ "${SERIAL_SPOOL_DIR:-.uno-spool}" != /* ]]; then
  export SERIAL_SPOOL_DIR="$SCRIPT_DIR/${SERIAL_SPOOL_DIR:-.uno-spool}"
fi

API_PID=""
BRIDGE_PID=""
cleanup() {
  [[ -n "$BRIDGE_PID" ]] && kill "$BRIDGE_PID" 2>/dev/null || true
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

node "$REPO_DIR/backend/dist/index.js" &
API_PID=$!

for _attempt in {1..40}; do
  if curl --silent --fail "${COMPETITION_API_URL:-http://127.0.0.1:3000}/health" >/dev/null; then
    break
  fi
  sleep 0.25
done

if ! curl --silent --fail "${COMPETITION_API_URL:-http://127.0.0.1:3000}/health" >/dev/null; then
  echo "Competition API did not become healthy." >&2
  exit 1
fi

(cd "$REPO_DIR/ops" && npm run uno-bridge -- "$@") &
BRIDGE_PID=$!

echo "Competition-day service is running. Press Ctrl+C to stop both processes."
wait -n "$API_PID" "$BRIDGE_PID"
