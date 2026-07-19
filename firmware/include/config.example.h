#pragma once

// Copy to include/config.h and replace every placeholder before flashing.
// GPIO values are deliberately not selected by the project; use your wiring.
#define WIFI_SSID "<venue-wifi>"
#define WIFI_PASS "<venue-password>"
#define API_BASE_URL "https://api.example.com"
// PEM root CA that signs the API certificate. Use adjacent quoted lines with \n.
#define API_ROOT_CA "-----BEGIN CERTIFICATE-----\n" \
                    "<api-root-ca-pem>\n" \
                    "-----END CERTIFICATE-----\n"
#define DEVICE_ID "esp32-lane1"
#define DEVICE_KEY "<random-device-key>"
#define LANE_ID "1"

#define STATUS_LED_PIN -1
#define STATUS_LED_ACTIVE_HIGH true

// Sensor input level when the beam is broken / gate triggers.
#define GATE_ACTIVE_LEVEL LOW
#define GATE_INPUT_MODE INPUT_PULLUP

#define START_GATE_PIN -1
#define STOP_GATE_PIN -1

// Optional checkpoints. Keep unused pins at -1. Gate IDs must be unique.
#define CHECKPOINT_GATE_COUNT 0
#define CHECKPOINT_GATE_PINS { -1, -1, -1, -1 }
#define CHECKPOINT_GATE_IDS { "cp1", "cp2", "cp3", "cp4" }
