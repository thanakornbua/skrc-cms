# Ubuntu competition-day timer + Arduino UNO gate

This standalone Ubuntu desktop timer reads `TRIGGER` and `CLEAR` at 115200 baud
from the E18-D80NK sketch. With one sensor, the first detection starts the clock
and the next detection stops it. Every finish is appended to `results.csv`.

## Install and upload

```bash
cd competition-timer
chmod +x setup-ubuntu.sh upload-arduino.sh run-timer.sh
./setup-ubuntu.sh
# Log out/in if the setup script adds you to the dialout group.
./upload-arduino.sh uno-r4-wifi
```

For a classic Arduino UNO, use `./upload-arduino.sh uno`. You can pass a port
explicitly as the second argument, for example:

```bash
./upload-arduino.sh uno-r4-wifi /dev/ttyACM0
```

Sensor wiring: brown to 5V, blue to GND, black to D2. The sketch uses the
internal pull-up and treats LOW as detected.

## Competition operation

Copy or edit `rounds.json`; it is an ordered JSON list with `round`, `lane`, and
`team` fields. Then run:

```bash
./run-timer.sh
# Or select the serial device explicitly:
./run-timer.sh --port /dev/ttyACM0 --rounds ./rounds.json
```

Controls:

- Sensor trigger or `Space`: start/stop
- `R`: reset the current clock
- `Left` / `Right`: previous/next round (disabled while running)
- `F11`: toggle fullscreen
- `Escape`: leave fullscreen

The program remains usable in manual mode if the Arduino is disconnected.
Keep `results.csv` backed up during competition day. Use only one program per
serial port; close Arduino Serial Monitor before starting the timer.

## Test without hardware

```bash
python3 -m unittest competition-timer/test_timer_core.py
```
