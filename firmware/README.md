# ESP32 lane timer firmware

One ESP32 handles the start, stop, and optional checkpoint sensors for one lane. All timestamps therefore come from the same `millis()` clock. Triggers enter a 64-event RAM FIFO immediately; HTTP delivery happens separately and retains the original timestamp through WiFi outages.

## Configure and wire

Edit `include/config.h` before flashing. Set the WiFi credentials, HTTPS API URL, its certificate authority PEM (`API_ROOT_CA`), `DEVICE_ID`, matching `DEVICE_KEY`, `LANE_ID`, status LED pin, and sensor GPIO pins. The repository deliberately assigns no GPIO numbers because they must match the operator's board and wiring. Pins left at `-1` are disabled.

Sensors are configured as `INPUT_PULLUP` and active-low by default. Change `GATE_INPUT_MODE` and `GATE_ACTIVE_LEVEL` if the actual sensor modules use a different electrical interface. Never connect a 5 V sensor output directly to an ESP32 GPIO; use a 3.3 V-compatible output or suitable level shifting.

For checkpoints, set `CHECKPOINT_GATE_COUNT` from 0–4 and populate the matching pin and ID arrays. Gate IDs must be unique within a lane.

## Build, flash, and monitor

Install PlatformIO, connect the ESP32, then run:

```sh
pio run
pio run --target upload
pio device monitor --baud 115200
```

The serial monitor logs every sensor trigger, queued event ID, retry, HTTP status, and backend response. The status LED is solid while connected and idle, blinks while draining queued events, and fast-blinks while disconnected.

## Runtime behavior

- Each gate is edge-triggered by polling and ignores re-triggers within 100 ms.
- `deviceTs` is captured in the tight sensor loop; WiFi and HTTP run in a separate FreeRTOS task on the other ESP32 core.
- NVS increments `bootCount` on every boot. Event IDs use `<deviceId>-<bootCount>-<seq>` and therefore remain unique after resets.
- The FIFO drains in order. Transport failures and HTTP 5xx responses retry from 1 second up to a 30-second cap. Any HTTP 2xx or 4xx response is final; notably, `200 {"accepted":false}` is logged and removed rather than retried.
- WiFi reconnects automatically. The queue is RAM-only, so a power loss while events are waiting can lose them; use stable power during competition.

## Hardware-in-loop checklist

1. Assign and arm the lane in the admin console.
2. Break start then stop beams and compare the portal time with a stopwatch (target tolerance: about 50 ms).
3. During an armed run, disconnect WiFi, trigger start/checkpoints/stop, reconnect, and confirm the FIFO drains into one correct completed run.
4. Double-break a sensor within 100 ms and confirm only one serial trigger.
5. Reboot while idle and confirm the next serial event ID has a larger `bootCount` and is accepted.

Firmware cannot invent a beam-break that the sensor never reports. A missed STOP is handled at the admin-configured maximum time; an administrator can attach an audited corrected time to that attempt. Reliable mounting, alignment, power, and pre-event beam tests remain essential.
