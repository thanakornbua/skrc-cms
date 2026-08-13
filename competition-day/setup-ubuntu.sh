#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required. Install it, then run this script again." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js 22 or newer is required; found $(node --version)." >&2
  exit 1
fi

echo "Installing locked dependencies…"
npm ci --prefix "$REPO_DIR/backend"
npm ci --prefix "$REPO_DIR/ops"

echo "Building competition API and device bridge…"
npm run build --prefix "$REPO_DIR/backend"
npm run build --prefix "$REPO_DIR/ops"

if ! id -nG "$USER" | tr ' ' '\n' | grep -qx dialout; then
  echo "Your user is not in the dialout group. Run: sudo usermod -aG dialout $USER"
  echo "Then log out and back in before opening the Arduino port."
fi

if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  chmod 600 "$SCRIPT_DIR/.env"
  echo "Created $SCRIPT_DIR/.env. Fill in AWS, Cognito, and device values before starting."
fi

echo "Setup complete. Run $SCRIPT_DIR/check-readiness.sh, then $SCRIPT_DIR/run-ubuntu.sh"

