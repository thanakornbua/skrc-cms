# ESP32 lane timer firmware

One ESP32 handles the start, stop, and optional checkpoint sensors for one lane. All timestamps therefore come from the same `millis()` clock. Triggers enter a 64-event RAM FIFO immediately; HTTP delivery happens separately and retains the original timestamp through WiFi outages.

## Configure and wire

Edit `include/config.h` before flashing. Both builds require `DEVICE_ID`, `LANE_ID`,
the status LED pin, and sensor GPIO pins. The HTTP build additionally requires WiFi,
HTTPS URL/CA, and matching `DEVICE_KEY`; the serial build keeps the device key on the
laptop. The repository deliberately assigns no GPIO numbers because they must match
the operator's board and wiring. Pins left at `-1` are disabled.

Sensors are configured as `INPUT_PULLUP` and active-low by default. Change `GATE_INPUT_MODE` and `GATE_ACTIVE_LEVEL` if the actual sensor modules use a different electrical interface. Never connect a 5 V sensor output directly to an ESP32 GPIO; use a 3.3 V-compatible output or suitable level shifting.

For checkpoints, set `CHECKPOINT_GATE_COUNT` from 0–4 and populate the matching pin and ID arrays. Gate IDs must be unique within a lane.

## Build, flash, and monitor

Install PlatformIO, choose the transport for competition day, connect the ESP32,
then run one of:

```sh
pio run -e esp32dev_http
pio run -e esp32dev_http --target upload
# or, when the ESP32 cannot reach AWS directly:
pio run -e esp32dev_serial
pio run -e esp32dev_serial --target upload
pio device monitor --baud 115200
```

## Bench rig: M5Stack Fire buttons as stand-in sensors

Before sensors are wired, an M5Stack Fire can run the identical firmware with its
front-panel buttons acting as the START and STOP gates. Nothing in `src/` changes —
the buttons are ordinary digital inputs, so only the board and `config.h` differ.

```sh
cp include/config.m5fire.example.h include/config.h   # then fill in placeholders
pio run -e m5fire_serial --target upload              # or -e m5fire_http
pio device monitor --baud 115200
```

Btn A (left, G39) fires START and Btn C (right, G37) fires STOP. Btn B is left
unassigned on purpose so a stray press between them cannot be read as a gate.

Two things to know:

- **The elapsed times are meaningless.** They measure how fast you press two
  buttons. This rig validates arming, state transitions, event IDs, the retry
  queue, deduplication, and the laptop bridge — not timing accuracy. Every
  accuracy check in the hardware-in-loop checklist below still has to be done
  against real sensors.
- **GPIO 37/38/39 are input-only with no internal pull-up**, which is why the
  M5 config sets `GATE_INPUT_MODE` to `INPUT` rather than the `INPUT_PULLUP`
  default. The Fire supplies external pull-ups on the buttons. `INPUT_PULLUP`
  would compile and silently do nothing on these pins. The same trap applies to
  any real sensor you later attach to G34–G39.

The Fire's ten status LEDs are addressable SK6812 parts on G15 and cannot be driven
by `digitalWrite`, so `STATUS_LED_PIN` is `-1` and there is no LED status on this
rig. The serial monitor logs everything the LED would have signalled.

`DEVICE_ID` stays `esp32-lane1` so the backend's existing `LANES` and `DEVICE_KEYS`
entries work untouched. Give the rig its own ID only if you also add it to both.

Both images share GPIO capture, debounce, NVS boot count, event IDs, and the 64-event
FIFO. The serial image emits `EVT <json>` once per second until the laptop durably
stores it and replies `ACK <eventId>`. It never needs WiFi, CA, API URL, or device-key
secrets; configure those on the laptop bridge instead.

For code-only verification without an ESP32 or PlatformIO, compile and run the portable
firmware logic tests with any C++17 compiler:

```sh
g++ -std=c++17 -Wall -Wextra -Werror -Ifirmware/include \
  firmware/test/test_gate_logic.cpp -o /tmp/skrc-gate-logic-test
/tmp/skrc-gate-logic-test
```

These tests cover debounce and `millis()` rollover arithmetic, retry deadlines and capped
exponential backoff, HTTP retry classification, event-ID construction, and the minimum
queue capacity. They do not emulate ESP32 NVS, WiFi, TLS, GPIO electrical behavior, or
FreeRTOS scheduling.

The serial monitor logs every sensor trigger, queued event ID, retry, HTTP status, and backend response. The status LED is solid while connected and idle, blinks while draining queued events, and fast-blinks while disconnected.

## Runtime behavior

- Each gate is edge-triggered by polling and ignores re-triggers within 100 ms.
- `deviceTs` is captured in the tight sensor loop; WiFi and HTTP run in a separate FreeRTOS task on the other ESP32 core.
- NVS increments `bootCount` on every boot. Event IDs use `<deviceId>-<bootCount>-<seq>` and therefore remain unique after resets.
- The FIFO drains in order. Transport failures and HTTP 5xx responses retry from 1 second up to a 30-second cap. Any HTTP 2xx or 4xx response is final; notably, `200 {"accepted":false}` is logged and removed rather than retried.
- WiFi reconnects automatically. The queue is RAM-only, so a power loss while events are waiting can lose them; use stable power during competition.

## Hardware-in-loop checklist

This checklist is intentionally deferred when no ESP32 is available; host-side tests
cannot replace it.

1. Assign and arm the lane in the admin console.
2. Break start then stop beams and compare the portal time with a stopwatch (target tolerance: about 50 ms).
3. During an armed run, disconnect WiFi, trigger start/checkpoints/stop, reconnect, and confirm the FIFO drains into one correct completed run.
4. Double-break a sensor within 100 ms and confirm only one serial trigger.
5. Reboot while idle and confirm the next serial event ID has a larger `bootCount` and is accepted.

Firmware cannot invent a beam-break that the sensor never reports. A missed STOP is handled at the admin-configured maximum time; an administrator can attach an audited corrected time to that attempt. Reliable mounting, alignment, power, and pre-event beam tests remain essential.
