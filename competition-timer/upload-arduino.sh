#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SKETCH_DIR="$(cd -- "$SCRIPT_DIR/../firmware/arduino/uno_gate_sensor" && pwd)"
BOARD="${1:-uno-r4-wifi}"
PORT="${2:-}"

case "$BOARD" in
  uno-r4-wifi) FQBN="arduino:renesas_uno:unor4wifi" ;;
  uno) FQBN="arduino:avr:uno" ;;
  *) echo "Usage: $0 [uno-r4-wifi|uno] [/dev/ttyACM0]" >&2; exit 2 ;;
esac

if [[ -z "$PORT" ]]; then
  PORT="$(arduino-cli board list --format json | python3 -c '
import json,sys
data=json.load(sys.stdin)
ports=data.get("detected_ports", data if isinstance(data,list) else [])
for item in ports:
    port=item.get("port", {})
    address=port.get("address") or item.get("address")
    if address:
        print(address); break
')"
fi

if [[ -z "$PORT" ]]; then
  echo "No Arduino port found. Reconnect it and run: $0 $BOARD /dev/ttyACM0" >&2
  exit 1
fi

echo "Compiling for $FQBN…"
arduino-cli compile --fqbn "$FQBN" "$SKETCH_DIR"
echo "Uploading through $PORT…"
arduino-cli upload -p "$PORT" --fqbn "$FQBN" "$SKETCH_DIR"
echo "Upload complete."
