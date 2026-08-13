#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

FAILED=0
check() { if "$@"; then echo "PASS  $*"; else echo "FAIL  $*"; FAILED=1; fi; }

check test -r "${UNO_SERIAL_PORT:?UNO_SERIAL_PORT is required}"
check test -w "$UNO_SERIAL_PORT"
check node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'
check test -f "$SCRIPT_DIR/../backend/dist/index.js"
check test -f "$SCRIPT_DIR/../ops/dist/uno-bridge.js"

if (( FAILED )); then
  echo "Readiness checks failed. Do not begin live timing." >&2
  exit 1
fi
echo "Local prerequisites are ready. Start the service and verify /admin/hardware in the console."

