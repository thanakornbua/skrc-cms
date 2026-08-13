# Ubuntu competition-day service (legacy alternative)

The compiled Windows desktop application in
[`COMPETITION_DAY_WINDOWS.md`](./COMPETITION_DAY_WINDOWS.md) is now the primary
normal-UNO competition-day deployment. This Ubuntu service remains available as
an operational fallback.

This deployment moves the **competition API process and Arduino USB transport**
from EC2/ESP32 onto the operator's Ubuntu laptop. It does not replace Amplify,
Cognito, the registration-week Lambda, or DynamoDB.

```text
Amplify React UI ── Cognito ID token ──► api.suankularb.space
                                               │
                                     Caddy/TLS on Ubuntu
                                               │
                                     competition API :3000
                                      │                 │
                                      ▼                 ▼
                               DynamoDB robo-compet   local bridge
                                                        │ USB serial
                                                        ▼
                                                Arduino UNO + E18
```

The deployed frontend keeps using `VITE_REGWEEK_API_URL` for registration and
always-on staff record management. In competition mode, set
`VITE_API_BASE_URL=https://api.suankularb.space`; DNS must resolve to the laptop's
reachable address and Caddy must terminate TLS using `competition-day/Caddyfile.laptop`.
If venue networking cannot accept inbound traffic, use an approved HTTPS tunnel
and set `VITE_API_BASE_URL` to its stable URL before building the frontend.

## Data and workflow

The existing state machines and table remain authoritative. No local results file
or second database is introduced.

1. Admin scans a competitor and checks the team in (`REGISTERED → CHECKED_IN`).
2. Committee records the check-in weight in grams with PASS/FAIL.
3. Before lane assignment, committee records the pre-competition weight. A PASS,
   after a passed check-in weigh-in, advances `CHECKED_IN → INSPECTED`.
4. Failed measurements remain immutable audit records and can be followed by a
   new measurement. The regulations do not define a numeric weight threshold in
   the repository, so the authorized inspector records the verdict; the service
   does not invent one.
5. Admin assigns and arms the lane in the existing lane console.
6. The bridge reads `TRIGGER <millis>` from the UNO. It asks the API for the
   current lane state: `ARMED` becomes START and `RUNNING` becomes STOP. The event
   is durably spooled before delivery and then enters the existing DynamoDB gate
   claim/audit/run transaction.

Weight measurements use `COMP#<competitorId>` with sort keys
`INSPECTION#CHECK_IN#<inspectionId>` or
`INSPECTION#PRE_COMPETITION#<inspectionId>`. Arduino status uses
`DEVICE#<deviceId>` / `STATUS`. Neither needs a new table or GSI.

## Setup

Flash `firmware/arduino/uno_gate_sensor/uno_gate_sensor.ino` from Arduino IDE on
Windows or with the existing upload helper. On Ubuntu:

```bash
cd competition-day
chmod +x setup-ubuntu.sh run-ubuntu.sh check-readiness.sh
./setup-ubuntu.sh
editor .env
# Generate the DEVICE_KEYS value with: openssl rand -hex 32
./check-readiness.sh
./run-ubuntu.sh
```

The laptop needs AWS credentials limited to the existing competition table, plus
network access to DynamoDB and Cognito JWKS. Keep `.env` mode `0600`, never commit
it, and do not put AWS credentials in frontend variables.

Open `/competition-day` in the competition-mode frontend. The hardware band is
green only while the bridge heartbeat is less than 30 seconds old. Close Arduino
Serial Monitor before starting because only one process can own the serial port.

Before real competitors arrive, complete `ops/DRY_RUN.md`, including duplicate,
under-minimum, timeout, reset, correction, and conclusion checks.
