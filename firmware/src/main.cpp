#include <Arduino.h>
#include <ArduinoJson.h>
#if defined(TRANSPORT_HTTP)
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#endif
#include <Preferences.h>
#include "config.h"
#include "gate_logic.h"

namespace {
using gate_logic::DEBOUNCE_MS;
using gate_logic::QUEUE_CAPACITY;
using gate_logic::RETRY_MIN_MS;

enum class GateType { START, CHECKPOINT, STOP };

struct Gate {
  int pin;
  const char* id;
  GateType type;
  bool wasActive;
  uint32_t lastTriggerMs;
};

struct Event {
  char eventId[96];
  char gateId[24];
  GateType type;
  uint32_t deviceTs;
  uint32_t retryAtMs;
  uint32_t backoffMs;
};

const int checkpointPins[] = CHECKPOINT_GATE_PINS;
const char* checkpointIds[] = CHECKPOINT_GATE_IDS;
Gate gates[2 + CHECKPOINT_GATE_COUNT];
Event queue[QUEUE_CAPACITY];
volatile size_t queueHead = 0;
volatile size_t queueSize = 0;
uint32_t bootCount = 0;
uint32_t sequenceNumber = 0;
#if defined(TRANSPORT_HTTP)
uint32_t lastWifiAttemptMs = 0;
#endif
uint32_t lastLedToggleMs = 0;
bool ledOn = false;
Preferences preferences;
portMUX_TYPE queueMux = portMUX_INITIALIZER_UNLOCKED;

const char* typeName(GateType type) {
  switch (type) {
    case GateType::START: return "START";
    case GateType::CHECKPOINT: return "CHECKPOINT";
    case GateType::STOP: return "STOP";
  }
  return "UNKNOWN";
}

void setLed(bool on) {
  if (STATUS_LED_PIN < 0) return;
  ledOn = on;
  digitalWrite(STATUS_LED_PIN, on == STATUS_LED_ACTIVE_HIGH ? HIGH : LOW);
}

void updateLed(uint32_t now) {
#if defined(TRANSPORT_HTTP)
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastLedToggleMs >= 125) { lastLedToggleMs = now; setLed(!ledOn); }
  } else
#endif
  if (queueSize > 0) {
    if (now - lastLedToggleMs >= 500) { lastLedToggleMs = now; setLed(!ledOn); }
  } else {
    setLed(true);
  }
}

#if defined(TRANSPORT_HTTP)
void connectWifi(uint32_t now) {
  if (WiFi.status() == WL_CONNECTED || now - lastWifiAttemptMs < 5000) return;
  lastWifiAttemptMs = now;
  Serial.printf("WiFi reconnect attempt to %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}
#endif

bool enqueue(const Gate& gate, uint32_t timestamp) {
  portENTER_CRITICAL(&queueMux);
  if (queueSize == QUEUE_CAPACITY) {
    portEXIT_CRITICAL(&queueMux);
    Serial.println("ERROR queue full; trigger cannot be retained");
    return false;
  }
  Event& event = queue[(queueHead + queueSize) % QUEUE_CAPACITY];
  sequenceNumber += 1;
  if (!gate_logic::formatEventId(event.eventId, sizeof(event.eventId), DEVICE_ID, bootCount,
                                sequenceNumber)) {
    portEXIT_CRITICAL(&queueMux);
    Serial.println("ERROR event ID exceeds buffer; trigger cannot be retained");
    return false;
  }
  strlcpy(event.gateId, gate.id, sizeof(event.gateId));
  event.type = gate.type;
  event.deviceTs = timestamp;
  event.retryAtMs = timestamp;
  event.backoffMs = RETRY_MIN_MS;
  queueSize += 1;
  const size_t queued = queueSize;
  portEXIT_CRITICAL(&queueMux);
  Serial.printf("TRIGGER %s gate=%s ts=%lu id=%s queued=%u\n", typeName(gate.type), gate.id,
                static_cast<unsigned long>(timestamp), event.eventId, static_cast<unsigned>(queued));
  return true;
}

void pollGates(uint32_t now) {
  for (Gate& gate : gates) {
    if (gate.pin < 0) continue;
    const bool active = digitalRead(gate.pin) == GATE_ACTIVE_LEVEL;
    if (active && !gate.wasActive &&
        gate_logic::elapsedAtLeast(now, gate.lastTriggerMs, DEBOUNCE_MS)) {
      gate.lastTriggerMs = now;
      enqueue(gate, now);
    }
    gate.wasActive = active;
  }
}

void discardHead(const char* eventId) {
  portENTER_CRITICAL(&queueMux);
  if (queueSize > 0 && strcmp(queue[queueHead].eventId, eventId) == 0) {
    queueHead = (queueHead + 1) % QUEUE_CAPACITY;
    queueSize -= 1;
  }
  portEXIT_CRITICAL(&queueMux);
}

void scheduleRetry(const Event& attempted, uint32_t now, const char* reason) {
  const uint32_t delayMs = attempted.backoffMs;
  portENTER_CRITICAL(&queueMux);
  if (queueSize > 0 && strcmp(queue[queueHead].eventId, attempted.eventId) == 0) {
    queue[queueHead].retryAtMs = now + delayMs;
    queue[queueHead].backoffMs = gate_logic::nextBackoff(delayMs);
  }
  portEXIT_CRITICAL(&queueMux);
  Serial.printf("POST %s failed (%s); retry in %lu ms\n", attempted.eventId, reason,
                static_cast<unsigned long>(delayMs));
}

#if defined(TRANSPORT_HTTP)
void drainQueue(uint32_t now) {
  if (queueSize == 0 || WiFi.status() != WL_CONNECTED) return;
  Event event;
  portENTER_CRITICAL(&queueMux);
  if (queueSize == 0) { portEXIT_CRITICAL(&queueMux); return; }
  event = queue[queueHead];
  portEXIT_CRITICAL(&queueMux);
  if (!gate_logic::deadlineReached(now, event.retryAtMs)) return;

  JsonDocument document;
  document["eventId"] = event.eventId;
  document["deviceId"] = DEVICE_ID;
  document["laneId"] = LANE_ID;
  document["gateId"] = event.gateId;
  document["type"] = typeName(event.type);
  document["deviceTs"] = event.deviceTs;
  String payload;
  serializeJson(document, payload);

  HTTPClient http;
  WiFiClientSecure client;
  client.setCACert(API_ROOT_CA);
  String url = String(API_BASE_URL) + "/gate-events";
  if (!http.begin(client, url)) { scheduleRetry(event, now, "http begin"); return; }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  const int status = http.POST(payload);
  const String response = status > 0 ? http.getString() : "";
  http.end();

  if (gate_logic::shouldRetryHttpStatus(status)) {
    scheduleRetry(event, now, status <= 0 ? "transport" : "server 5xx");
    return;
  }
  Serial.printf("POST %s HTTP %d %s — final, dropping queue item\n", event.eventId, status,
                response.c_str());
  discardHead(event.eventId); // Any 2xx/4xx is semantic/final; retry only transport/5xx.
}
#else
void emitSerialHead(uint32_t now) {
  if (queueSize == 0) return;
  Event event;
  portENTER_CRITICAL(&queueMux);
  if (queueSize == 0) { portEXIT_CRITICAL(&queueMux); return; }
  event = queue[queueHead];
  portEXIT_CRITICAL(&queueMux);
  if (!gate_logic::deadlineReached(now, event.retryAtMs) || Serial.availableForWrite() < 64) return;

  JsonDocument document;
  document["eventId"] = event.eventId;
  document["deviceId"] = DEVICE_ID;
  document["laneId"] = LANE_ID;
  document["gateId"] = event.gateId;
  document["type"] = typeName(event.type);
  document["deviceTs"] = event.deviceTs;
  Serial.print("EVT ");
  serializeJson(document, Serial);
  Serial.println();
  portENTER_CRITICAL(&queueMux);
  if (queueSize > 0 && strcmp(queue[queueHead].eventId, event.eventId) == 0) {
    queue[queueHead].retryAtMs = now + RETRY_MIN_MS;
  }
  portEXIT_CRITICAL(&queueMux);
}

void readSerialAcks() {
  static char line[128];
  static size_t length = 0;
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n') {
      line[length] = '\0';
      if (strncmp(line, "ACK ", 4) == 0) {
        const char* eventId = line + 4;
        Event head;
        bool matches = false;
        portENTER_CRITICAL(&queueMux);
        if (queueSize > 0) { head = queue[queueHead]; matches = strcmp(head.eventId, eventId) == 0; }
        portEXIT_CRITICAL(&queueMux);
        if (matches) { discardHead(eventId); Serial.printf("ACKED %s\n", eventId); }
      }
      length = 0;
    } else if (c != '\r') {
      if (length + 1 < sizeof(line)) line[length++] = c;
      else length = 0;
    }
  }
}
#endif

void configureGates() {
  gates[0] = { START_GATE_PIN, "start", GateType::START, false, UINT32_MAX - DEBOUNCE_MS };
  gates[1] = { STOP_GATE_PIN, "stop", GateType::STOP, false, UINT32_MAX - DEBOUNCE_MS };
  for (size_t i = 0; i < CHECKPOINT_GATE_COUNT; i++) {
    gates[2 + i] = { checkpointPins[i], checkpointIds[i], GateType::CHECKPOINT,
                     false, UINT32_MAX - DEBOUNCE_MS };
  }
  for (Gate& gate : gates) {
    if (gate.pin >= 0) pinMode(gate.pin, GATE_INPUT_MODE);
  }
}

void networkTask(void*) {
  for (;;) {
    const uint32_t now = millis();
#if defined(TRANSPORT_HTTP)
    connectWifi(now);
    drainQueue(now);
#else
    readSerialAcks();
    emitSerialHead(now);
#endif
    updateLed(now);
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}
} // namespace

void setup() {
  Serial.begin(115200);
  preferences.begin("robo-compet", false);
  bootCount = preferences.getUInt("bootCount", 0) + 1;
  preferences.putUInt("bootCount", bootCount);
  preferences.end();
  Serial.printf("Boot device=%s lane=%s bootCount=%lu\n", DEVICE_ID, LANE_ID,
                static_cast<unsigned long>(bootCount));

  if (STATUS_LED_PIN >= 0) { pinMode(STATUS_LED_PIN, OUTPUT); setLed(false); }
  configureGates();
#if defined(TRANSPORT_HTTP)
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
#else
  Serial.println("Transport=SERIAL; waiting for laptop bridge ACKs");
#endif
  xTaskCreatePinnedToCore(networkTask, "gate-network", 8192, nullptr, 1, nullptr, 0);
}

void loop() {
  const uint32_t now = millis();
  pollGates(now); // Network work runs on the other core and cannot delay capture.
  delay(1);
}
