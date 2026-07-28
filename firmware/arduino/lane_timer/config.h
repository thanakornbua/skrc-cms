#pragma once

// Bench-rig config for the Arduino IDE sketch: M5Stack Fire, front-panel
// buttons standing in for the lane sensors.
//
// This is a test harness, NOT a competition config. Button presses are
// hand-timed, so the elapsed times mean nothing. The rig exists to exercise
// arming, START/STOP transitions, event IDs, the retry queue, deduplication,
// and the laptop bridge on real hardware before sensors exist.

// ---------------------------------------------------------------------------
// Transport. The Arduino IDE has no build flags, so pick one here.
// Commented out  -> serial transport (no WiFi; the laptop bridge ACKs events).
// Uncommented    -> HTTPS POST directly to the API.
// ---------------------------------------------------------------------------
// #define TRANSPORT_HTTP 1

// Required only when TRANSPORT_HTTP is enabled above.
#define WIFI_SSID "<venue-wifi>"
#define WIFI_PASS "<venue-password>"
#define API_BASE_URL "https://api.example.com"
// PEM root CA that signs the API certificate. Use adjacent quoted lines with \n.
#define API_ROOT_CA "-----BEGIN CERTIFICATE-----\n" \
                    "<api-root-ca-pem>\n" \
                    "-----END CERTIFICATE-----\n"

// Kept as esp32-lane1 so the existing backend LANES and DEVICE_KEYS entries
// work unchanged. Using a distinct ID means adding it to both on the server.
#define DEVICE_ID "esp32-lane1"
// Required only when TRANSPORT_HTTP is enabled. For serial, the key stays on
// the laptop and never reaches the device.
#define DEVICE_KEY "<random-device-key>"
#define LANE_ID "1"

// The Fire's ten status LEDs are SK6812 addressable parts on G15 and cannot be
// driven by digitalWrite. Disabled; watch the Serial Monitor for status.
#define STATUS_LED_PIN -1
#define STATUS_LED_ACTIVE_HIGH true

// The buttons pull to ground and the Fire carries external pull-ups.
// GPIO 37/38/39 are input-only and have NO internal pull-up, so this must stay
// INPUT — INPUT_PULLUP would compile and silently do nothing on these pins.
#define GATE_ACTIVE_LEVEL LOW
#define GATE_INPUT_MODE INPUT

#define START_GATE_PIN 39  // Btn A, left
#define STOP_GATE_PIN 37   // Btn C, right

// Btn B (G38) is deliberately left free: it sits between the two gate buttons,
// so an accidental press cannot be mistaken for a START or a STOP.
// No checkpoints — the course has no space for them.
#define CHECKPOINT_GATE_COUNT 0
#define CHECKPOINT_GATE_PINS { -1, -1, -1, -1 }
#define CHECKPOINT_GATE_IDS { "cp1", "cp2", "cp3", "cp4" }
