/*
 * SKRC gate sensor — Arduino UNO / UNO R4 WiFi
 * E18-D80NK infrared sensor
 *
 * Wiring:
 *   Brown -> 5V
 *   Blue  -> GND
 *   Black -> D2
 *
 * The sensor output is active LOW. The sketch uses Arduino's internal pull-up
 * and emits one line per stable edge at 115200 baud:
 *   TRIGGER <millis>  - an object is detected
 *   CLEAR <millis>    - the beam is clear again
 */

#include <Arduino.h>

const uint8_t SENSOR_PIN = 2;
const uint8_t STATUS_LED = LED_BUILTIN;
const unsigned long DEBOUNCE_MS = 20;

bool lastStableState = HIGH;
bool lastReading = HIGH;
unsigned long lastChangeTime = 0;

void setup() {
  pinMode(SENSOR_PIN, INPUT_PULLUP);
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);

  Serial.begin(115200);
  // Do not wait for Serial: the gate must work even when the desktop app opens
  // the port after the Arduino has booted.
  Serial.println("Gate Timer Ready");
}

void loop() {
  const bool reading = digitalRead(SENSOR_PIN);

  if (reading != lastReading) {
    lastChangeTime = millis();
    lastReading = reading;
  }

  if ((millis() - lastChangeTime) >= DEBOUNCE_MS && reading != lastStableState) {
    lastStableState = reading;

    if (lastStableState == LOW) {
      digitalWrite(STATUS_LED, HIGH);
      Serial.print("TRIGGER ");
      Serial.println(millis());
    } else {
      digitalWrite(STATUS_LED, LOW);
      Serial.print("CLEAR ");
      Serial.println(millis());
    }
  }
}
