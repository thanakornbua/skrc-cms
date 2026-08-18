# Windows competition-day desktop application

`desktop/` is the primary competition-day operator build for a normal Arduino
UNO connected to Windows. One Electron application contains:

- the production React competition console;
- the Express competition API that previously ran on EC2;
- Cognito token verification and DynamoDB repositories;
- the UNO serial reader and durable event spool;
- check-in and both weight-inspection stages;
- lane assignment, arming, live state, and reset controls;
- the OBS overlay bridge, writing the three broadcast text files.

Only Amplify registration/public pages, Cognito, the registration Lambda, and
DynamoDB remain remote. By default the desktop API listens on `127.0.0.1:7070`,
so it is not exposed to the venue network. The bundled renderer calls this
loopback API.

If the existing Amplify competition pages must also call this API, set
`API_BIND_HOST=0.0.0.0`, set `CORS_ORIGIN` to the exact Amplify origin, and place
an approved HTTPS reverse proxy or tunnel in front of port 7070. Build the remote
frontend with that stable HTTPS address as `VITE_API_BASE_URL`. Never expose port
7070 directly to the internet without TLS and network controls.

## Run the compiled package

Copy the entire extracted `SKRC Competition Day-win32-x64` directory to the
Windows operator computer. Do not copy only the EXE; Electron's DLLs and
`resources` directory are required. Run `SKRC-Competition-Day.exe`.

On first launch, the program creates and reports this configuration path:

```text
%APPDATA%\SKRC Competition Day\competition-day.env
```

Edit it and restart. A `competition-day.env` placed beside the EXE takes
precedence, which is convenient for a controlled portable event folder. Use
`desktop/competition-day.example.env` as the template.

Configure an AWS profile in `%USERPROFILE%\.aws\credentials` with least-privilege
access to the existing `robo-compet` table. Set the profile name in
`AWS_PROFILE`; do not place AWS keys in frontend variables or distribute them
inside the package.

Leave `UNO_SERIAL_PORT` empty for auto-detection or set the exact port shown in
Arduino IDE, such as `COM3`. Close Serial Monitor before launching the desktop
application.

## Operator workflow

1. Sign in with the existing Cognito staff account.
2. Scan or enter a competitor number.
3. As admin, check the team in.
4. Record the check-in weight and PASS/FAIL verdict.
5. Record the pre-competition weight. Only a pass after the first passed weigh-in
   advances the competitor to `INSPECTED`.
6. In **Lane control** in the same screen, assign the scanned competitor.
7. Arm the lane. The card states that the next sensor edge starts the timer.
8. After START, the card changes to RUNNING; the next edge becomes STOP.
9. Use reset only when necessary. Resetting a running lane voids its active run
   through the existing transaction logic.

All workflow changes, inspections, gate claims, audit events, and run results are
written directly to DynamoDB through the existing repositories.

## Build the executable

On Windows with Node.js 22 or newer:

```powershell
npm ci --prefix backend
npm ci --prefix ops
npm ci --prefix frontend
npm ci --prefix desktop
npm run make:win --prefix desktop
```

The Squirrel installer is created under
`desktop\out\make\squirrel.windows\x64`. The unpacked portable build is created
by `npm run package:win --prefix desktop`. The manual GitHub Actions workflow
`.github/workflows/windows-desktop.yml` performs the installer build on a
Windows runner after its required repository variables are configured.

Code-sign the final installer before general distribution. Electron recommends
signing Windows distributables so Windows can identify the publisher and avoid
unnecessary security warnings.

## Pre-event verification

- Flash `firmware/arduino/uno_gate_sensor/uno_gate_sensor.ino`.
- Confirm the hardware band reports the expected COM port and online status.
- Perform PASS and FAIL measurements at both inspection stations.
- Exercise assign → arm → START → STOP and verify the saved run in DynamoDB.
- Exercise running-lane reset and confirm the run becomes `VOID`.
- Disconnect/reconnect the UNO and confirm the heartbeat changes.
- Complete the remaining scenarios in `ops/DRY_RUN.md`.
