#pragma once

// Safe compile-time placeholders. Replace these values for hardware use.
// This committed file contains no credentials and selects no GPIO pins.
#define WIFI_SSID "<venue-wifi>"
#define WIFI_PASS "<venue-password>"
#define API_BASE_URL "https://api.example.com"
#define API_ROOT_CA "-----BEGIN CERTIFICATE-----\n" \
                    "<api-root-ca-pem>\n" \
                    "-----END CERTIFICATE-----\n"
#define DEVICE_ID "esp32-lane1"
#define DEVICE_KEY "<random-device-key>"
#define LANE_ID "1"
#define STATUS_LED_PIN -1
#define STATUS_LED_ACTIVE_HIGH true
#define GATE_ACTIVE_LEVEL LOW
#define GATE_INPUT_MODE INPUT_PULLUP
#define START_GATE_PIN -1
#define STOP_GATE_PIN -1
#define CHECKPOINT_GATE_COUNT 0
#define CHECKPOINT_GATE_PINS { -1, -1, -1, -1 }
#define CHECKPOINT_GATE_IDS { "cp1", "cp2", "cp3", "cp4" }
