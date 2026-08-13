#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this script as your normal desktop user, not root." >&2
  exit 1
fi

echo "Installing Ubuntu packages for Arduino and the desktop timer…"
sudo apt-get update
sudo apt-get install -y arduino-cli python3 python3-venv python3-tk

echo "Installing Arduino UNO board platforms…"
arduino-cli config init >/dev/null 2>&1 || true
arduino-cli core update-index
arduino-cli core install arduino:avr
arduino-cli core install arduino:renesas_uno

echo "Creating the isolated Python environment…"
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r "$SCRIPT_DIR/requirements.txt"

if ! id -nG "$USER" | tr ' ' '\n' | grep -qx dialout; then
  sudo usermod -aG dialout "$USER"
  echo "Added $USER to dialout. Log out and back in before connecting the Arduino."
fi

cp -n "$SCRIPT_DIR/rounds.example.json" "$SCRIPT_DIR/rounds.json"
echo
echo "Setup complete. Start with: $SCRIPT_DIR/run-timer.sh"
echo "Upload UNO R4 WiFi firmware with: $SCRIPT_DIR/upload-arduino.sh uno-r4-wifi"
echo "Upload classic UNO firmware with: $SCRIPT_DIR/upload-arduino.sh uno"
