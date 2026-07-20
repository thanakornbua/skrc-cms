# Environment Variables

Never commit real values. Each of `backend/`, `frontend/`, and the registration-week Lambda (built inside `ops/` in Phase 3) ships its own `.env.example` mirroring this file exactly — placeholders only.

## Shared backend values (EC2 API and the registration-week Lambda both read these)

| Var | Example | Notes |
|---|---|---|
| `AWS_REGION` | `ap-southeast-7` | Fixed by D5. |
| `DYNAMO_TABLE` | `robo-compet` | Fixed by D5. |
| `COGNITO_USER_POOL_ID` | `ap-southeast-7_xxxxxxxxx` | Printed by `ops/create-auth.ts` (Phase 2). |
| `COGNITO_CLIENT_ID` | `xxxxxxxxxxxxxxxxxxxxxxxxxx` | Printed by `ops/create-auth.ts` (Phase 2). |
| `CORS_ORIGIN` | `https://competitive.skrc.suankularb.space` | Fixed frontend origin. |

Neither service ever reads or stores a JWT signing secret — Cognito verification is JWKS-based (`aws-jwt-verify`, pool ID + client ID above).

## EC2 API only

| Var | Example | Notes |
|---|---|---|
| `PORT` | `3000` | Container listen port. |
| `DEVICE_KEYS` | `{"esp32-lane1":"<random-key>","esp32-lane2":"<random-key>"}` | JSON map, `deviceId` → per-device API key, checked against `X-Device-Key` on `/gate-events` (Phase 7). Generate with a CSPRNG at deploy time — never hardcode. |
| `LANES` | `["1"]` or `[{"laneId":"1","deviceId":"esp32-lane1"}]` | JSON array of lane IDs (Phase 6). Operator decided **1 lane at launch**, expandable later by editing this var — never hardcode lane count. Object form records which ESP32 drives the lane once hardware is provisioned. Default when unset: `["1"]`. |

## Frontend (Amplify build-time vars, `VITE_` prefix)

| Var | Example | Notes |
|---|---|---|
| `VITE_EVENT_MODE` | `registration` \| `competition` \| `concluded` | Selects which backend (if any) the frontend targets and which UI mode renders. See IMPLEMENTATION_PLAN.md preamble for the three-era lifecycle. |
| `VITE_REGWEEK_API_URL` | `https://xxxx.lambda-url.ap-southeast-7.on.aws/` | Lambda function URL. Only used in `registration` mode. |
| `VITE_API_BASE_URL` | `https://api.suankularb.space` | Competition API behind Caddy TLS. |
| `VITE_COGNITO_USER_POOL_ID` | same as backend | |
| `VITE_COGNITO_CLIENT_ID` | same as backend | |

No AWS credentials, access keys, or secret keys are ever set as frontend env vars — the frontend authenticates only via Cognito (`aws-amplify` Auth) and calls only the two backends above (never DynamoDB/S3 directly). See the hard rule in IMPLEMENTATION_PLAN.md's fixed decisions.

## Firmware (ESP32, PlatformIO build flags / a config header — not dotenv)

| Constant | Notes |
|---|---|
| `WIFI_SSID` / `WIFI_PASS` | Venue WiFi credentials. Operator-provided at flash time. |
| `API_BASE_URL` | The EC2 API's competition-day URL (same value as `VITE_API_BASE_URL`). |
| `DEVICE_ID` | Must match a key in the backend's `DEVICE_KEYS` map, e.g. `esp32-lane1`. |
| `DEVICE_KEY` | The corresponding value from `DEVICE_KEYS`. |
| `LANE_ID` | Which lane this device drives, e.g. `1`. |
| Gate pin map | GPIO pin assignment for start/stop/checkpoint gates — operator's hardware wiring, not a build decision. |

## Laptop serial bridge fallback

| Var | Example | Notes |
|---|---|---|
| `SERIAL_API_URL` | `https://api.suankularb.space` | Existing EC2 API; the bridge adds `/gate-events`. |
| `SERIAL_SPOOL_DIR` | `.serial-spool` | Local durable queue; protect and back up during the event. |
| `SERIAL_LANES` | `{"esp32-lane1":"1"}` | Device-to-lane guard for received serial frames. |

The bridge also reads the existing `DEVICE_KEYS` map. Keys remain on the laptop and
are never transmitted to serial firmware.

## Bootstrap-only (never long-lived env vars; used once by an operator running a script)

- `ops/bootstrap-staff.ts` (Phase 2) takes the D7 staff list + temporary passwords as a script argument or a local JSON file **outside version control** — never as a committed env var.
