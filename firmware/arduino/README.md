# Arduino IDE sketch — M5Stack Fire bench rig

`lane_timer/lane_timer.ino` is the same lane-timer firmware as
`firmware/src/main.cpp`, packaged so it can be opened and flashed straight from
the Arduino IDE with no PlatformIO installed. The Fire's front-panel buttons
stand in for the lane sensors.

**This is a test harness, not a competition build.** Button presses are
hand-timed, so elapsed times are meaningless. It exercises arming, START/STOP
transitions, event IDs, the retry queue, deduplication, and the laptop bridge on
real hardware before the sensors exist.

## Setup

1. **Board support.** Arduino IDE → Settings → Additional Boards Manager URLs, add
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`,
   then Boards Manager → install **esp32 by Espressif Systems**.
2. **Select the board.** Tools → Board → ESP32 Arduino → **M5Stack-FIRE**.
3. **Install the one library.** Library Manager → **ArduinoJson**, version **7.x**.
   ⚠️ v6 will *not* compile — the sketch uses the v7 `JsonDocument` API, and on v6
   you will get errors about `JsonDocument` requiring a size template argument.
4. **Open the sketch.** File → Open → `firmware/arduino/lane_timer/lane_timer.ino`.
   The IDE shows `config.h` and `gate_logic.h` as extra tabs; keep all three files
   in the same folder or the sketch will not build.
5. **Edit the `config.h` tab.** At minimum set the transport. Leaving
   `TRANSPORT_HTTP` commented out gives the serial build, which needs no WiFi and
   no device key — that is the easier place to start.
6. **Upload**, then open Serial Monitor at **115200 baud**.

On Windows you may need the **CP210x USB driver** for the port to appear. If the
repo lives in WSL and the IDE runs on Windows, open it through `\\wsl$\...` or
copy the `lane_timer` folder to the Windows side.

## Using it

Btn A (left) fires START, Btn C (right) fires STOP. Btn B is deliberately
unassigned so a stray press between them cannot be read as a gate.

Serial output on each press:

```
TRIGGER START gate=start ts=12345 id=esp32-lane1-3-1 queued=1
```

- **Serial transport** — the sketch prints `EVT <json>` once per second until the
  laptop bridge durably stores it and replies `ACK <eventId>`. Run the bridge from
  `ops/`; see `ops/SERIAL_BRIDGE.md`.
- **HTTP transport** — the sketch POSTs to `API_BASE_URL/gate-events` with the
  `X-Device-Key` header, retrying transport failures and 5xx with capped backoff.

`DEVICE_ID` is `esp32-lane1` so the backend's existing `LANES` and `DEVICE_KEYS`
entries work untouched. Give the rig its own ID only if you add it to both.

## Keeping it in sync

The Arduino IDE cannot read `../include` or `platformio.ini` build flags, so this
folder carries its own `gate_logic.h` (a byte-identical copy) and its own
translation of `main.cpp`. Those can silently drift. After changing either copy:

```sh
firmware/arduino/check-sync.sh
```

It fails if `gate_logic.h` differs at all, or if the sketch body differs from
`main.cpp` once the two intentional Arduino adaptations are normalised away:

1. `config.h` is included **first**, because `TRANSPORT_HTTP` comes from
   `config.h` here rather than from a build flag, and must be visible before the
   conditional `WiFi.h` / `HTTPClient.h` includes.
2. Internals are `static` rather than wrapped in an anonymous namespace, because
   the IDE's automatic prototype insertion is unreliable around anonymous
   namespaces in a `.ino`.

## Gotcha worth remembering

`GATE_INPUT_MODE` is `INPUT`, not the `INPUT_PULLUP` used elsewhere. GPIO 37/38/39
are input-only pins with **no internal pull-up**; the Fire supplies external ones
for the buttons. `INPUT_PULLUP` compiles and silently does nothing on those pins —
the same trap applies to any real sensor later attached to G34–G39.

The Fire's ten LEDs are addressable SK6812 parts on G15 and cannot be driven by
`digitalWrite`, so `STATUS_LED_PIN` is `-1` and this rig has no LED status. The
Serial Monitor logs everything the LED would have signalled.
