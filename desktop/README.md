# Windows desktop build

The Electron package compiles the React competition console, Express competition
API, DynamoDB/Cognito clients, and Arduino UNO serial bridge into one Windows
desktop installation. The application binds only to `127.0.0.1:3210`; the web
renderer has Node integration disabled and context isolation enabled.

## Build on Windows

Install Node.js 22 or newer, then from PowerShell:

```powershell
npm ci --prefix backend
npm ci --prefix ops
npm ci --prefix frontend
npm ci --prefix desktop
npm run make:win --prefix desktop
```

The installer is written under `desktop\out\make\squirrel.windows\x64`.
For a portable unpacked folder use `npm run package:win --prefix desktop`.

The frontend build takes the Cognito, registration Lambda, and control-plane
values from `frontend\.env`; its competition API URL is forced to the packaged
loopback service.

## First launch

The first launch creates:

```text
%APPDATA%\SKRC Competition Day\competition-day.env
```

Fill it from `competition-day.example.env`, then restart. Alternatively put a
completed `competition-day.env` beside the EXE for a portable operator setup.
The laptop holds **no AWS credentials at all**. Set `COGNITO_IDENTITY_POOL_ID`
and the operator's own Cognito sign-in is exchanged for short-lived, role-scoped
credentials (`backend/src/db/credentials.ts`); they expire on their own and
nothing usable is left on disk if the machine is lost. Provision the pool once
with `npm run create-desktop-identity-pool --prefix ops`. Never commit the
runtime configuration.

Open Arduino IDE's Serial Monitor only for bench testing and close it before
starting this application. Leave `UNO_SERIAL_PORT` blank for auto-detection or
set the exact Windows port, such as `COM3`.

Windows installers should be code-signed before distribution to avoid SmartScreen
warnings. Configure the Squirrel maker certificate before the final release build.


## Working through a network drop

Gate events are written to a durable on-disk spool before delivery, so a lost
connection never loses a time: the run keeps being timed locally and the backlog
is pushed to DynamoDB once the link returns (retried every 5 seconds, and again
on each new event).

Credentials are the one thing that needs the network. They last about an hour,
so a drop longer than that leaves the console unable to write until the operator
is online again — at which point the spool flushes on its own. Timing capture is
never blocked by this; only the push to DynamoDB waits.
