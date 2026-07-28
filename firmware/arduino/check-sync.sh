#!/usr/bin/env bash
# Verifies the Arduino IDE sketch has not drifted from the PlatformIO firmware.
#
# The Arduino IDE cannot use ../include or platformio.ini build flags, so the
# sketch folder carries its own copy of gate_logic.h and its own translation of
# main.cpp. Those copies can silently diverge; this catches it.
#
# Usage: firmware/arduino/check-sync.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
firmware="$(dirname "$here")"
status=0

# 1. gate_logic.h must be byte-identical — it holds the debounce, rollover, and
#    backoff arithmetic that the portable tests actually cover.
if diff -q "$firmware/include/gate_logic.h" "$here/lane_timer/gate_logic.h" >/dev/null; then
  echo "OK   gate_logic.h identical"
else
  echo "DRIFT gate_logic.h differs from firmware/include/gate_logic.h:"
  diff -u "$firmware/include/gate_logic.h" "$here/lane_timer/gate_logic.h" || true
  status=1
fi

# 2. The sketch body must match main.cpp once the two known-intentional Arduino
#    adaptations are normalised away: `static` in place of the anonymous
#    namespace, and the reordered config.h include.
normalise() {
  sed -e 's/^static //' \
      -e '/^namespace {$/d' \
      -e '/^} \/\/ namespace$/d' \
      -e '/^#include /d' \
      -e '/^#pragma once$/d' \
      -e '/^\/\//d' \
      -e '/^[[:space:]]*$/d' "$1"
}

if diff -q <(normalise "$firmware/src/main.cpp") \
           <(normalise "$here/lane_timer/lane_timer.ino") >/dev/null; then
  echo "OK   lane_timer.ino matches src/main.cpp"
else
  echo "DRIFT lane_timer.ino differs from firmware/src/main.cpp:"
  diff -u <(normalise "$firmware/src/main.cpp") \
          <(normalise "$here/lane_timer/lane_timer.ino") || true
  status=1
fi

exit "$status"
