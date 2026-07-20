# ESP32 serial gateway

Use this fallback when an ESP32 cannot reliably reach the HTTPS API. Flash the
`esp32dev_serial` firmware; do not run both firmware variants on one device.

1. Connect each ESP32 by USB and list ports with `npm run serial-bridge -- --list`.
2. Set `SERIAL_API_URL`, `SERIAL_SPOOL_DIR`, `DEVICE_KEYS`, and `SERIAL_LANES` from
   the protected operator environment. Restrict the spool directory to the operator.
3. Start one bridge process with one or more explicit ports:

   ```bash
   npm run serial-bridge -- --port /dev/ttyUSB0 --port /dev/ttyUSB1
   # Windows example: npm run serial-bridge -- --port COM3
   ```

The bridge validates each `EVT` frame, atomically stores and syncs it, then sends its
`ACK`. Pending files survive bridge/laptop restarts. HTTP 200 responses move to
`archive`; 4xx responses move to `dead-letter` for investigation; transport errors
and 5xx remain pending with capped exponential backoff. Never delete pending files
during competition. A dead-letter event must be investigated and resent with the
same immutable payload; global backend dedup makes a replay safe.

Inspect or replay without opening a serial port:

```bash
npm run serial-bridge -- --status
npm run serial-bridge -- --replay esp32-lane1-7-42
```

Run `npm run test:serial` before the event. Serial firmware and real USB behavior still
require hardware validation when boards become available.
