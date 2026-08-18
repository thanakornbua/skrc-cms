# OBS overlay

Two ways to get the field onto the stream. **Prefer the Browser Source** — it
is pushed, so a team name appears in the same moment the lane is armed, and the
clock is redrawn every frame instead of whenever OBS next reads a file.

## Browser Source (recommended)

Add a **Browser Source**, URL:

```
http://127.0.0.1:7070/overlay
```

Set its width and height to the canvas size (1920×1080), leave "Shutdown source
when not visible" **off** so it stays connected, and position it in the scene.
The page has a transparent background and draws the stage name, the team name
and the running clock; style and crop it from OBS as any other source.

It holds an SSE connection to `/public/lanes/stream`, which sends the current
state on connect and every change as it happens, with a slow refresh underneath
as a safety net. If the console restarts, the browser reconnects on its own —
nobody has to touch OBS. A failed refresh leaves the last known state on screen
rather than blanking mid-run.

Nothing is loaded from the internet: no fonts, no scripts, no images. The
overlay keeps working at a venue with no uplink.

## Text files

Feeds three OBS text sources — `SKRC_StageName`, `SKRC_TeamName`,
`SKRC_ElapsedTime` — from the competition API.

The bridge writes three plain-text files and OBS reads them. There is no
WebSocket connection, no password, and no plugin: OBS and the bridge can start,
stop, or crash in any order without either needing to know. The worst failure is
a number that stops updating, never a blank or broken scene.

### One-time OBS setup

For each of the three text sources: **Properties → tick "Read from file" →
browse to the matching `.txt`**. Leave everything else — font, colour, position
— as it already is. The bridge only ever changes the text.

The files are named exactly after the sources:

```
obs/SKRC_StageName.txt
obs/SKRC_TeamName.txt
obs/SKRC_ElapsedTime.txt
```

Start the console (or the CLI below) once before configuring the sources, so the
files exist and the file picker can see them.

### On competition day: nothing to run

The bridge is built into the Windows application. **SKRC Competition Day** starts
it against its own loopback API (`http://127.0.0.1:7070`) as it boots, so the
broadcast operator installs one program and never opens a terminal. The files
land in

```text
%APPDATA%\SKRC Competition Day\obs\
```

Paste that path into the OBS file picker's location bar to get there. Two keys in
`competition-day.env` change it:

| Key | Default | Meaning |
| --- | --- | --- |
| `OBS_OVERLAY` | `on` | Set to `off` to skip the overlay entirely. |
| `OBS_OUT_DIR` | `%APPDATA%\SKRC Competition Day\obs` | Where the three text files are written. Point it at any writable folder — not beside the EXE, which sits in Program Files. |

If the bridge fails to start it is logged and the application carries on: the
timing console never depends on the overlay.

### The CLI, for rehearsal or a second laptop

From `ops/`, when driving OBS from a machine other than the operator's, or
against a remote API during rehearsal:

```bash
npm run obs-bridge
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `OBS_API_URL` | `http://127.0.0.1:7070` | Competition API base URL — the desktop application's port. Point it at the operator laptop's address, or at EC2 for rehearsal. |
| `OBS_OUT_DIR` | `obs` | Where the three text files are written, relative to where the bridge is started. |
| `OBS_POLL_MS` | `1000` | How often lane state is fetched. |
| `OBS_TICK_MS` | `100` | How often the clock is redrawn between polls. |

Reaching the API from another machine means it is no longer bound to loopback —
see the network warning in `docs/COMPETITION_DAY_WINDOWS.md` before doing that.

The clock is redrawn locally ten times a second and lane state is fetched once a
second — polling an API at 10 Hz just to animate a number would be waste. Files
are written only when the text actually changes, and through a temp-file rename
so OBS never reads a half-written line.

## What appears on screen

| Field state | Shown |
| --- | --- |
| A lane is `RUNNING` | Team name, and a clock counting from the run's start |
| A lane is `ARMED` | Team name, `0:00.000` — the audience sees who is about to go |
| A run just finished | The finishing team and its final time, held for five seconds |
| Nothing armed, running or just finished | Stage name only; team and clock are cleared |
| Before the first successful poll | All three blank |

A lane goes IDLE the instant a run stops, so without the hold the number the
audience just watched being set would leave the screen in the same frame. Five
seconds is long enough to read a time aloud, and an arming lane replaces it
early — a live lane always outranks a finished one.

The Browser Source overlay marks a held result rather than letting it read as a
still-running clock: the time turns green and is captioned **Final**, or amber
for **Time limit** and **Under review**. An armed team is captioned **On the
line**. The text sources carry the same team and time, without the caption —
there are only three of them.

If several lanes are ever configured, `RUNNING` takes precedence over `ARMED`.

## The clock is not the official time

`SKRC_ElapsedTime` counts from `runStartedAt`, the server's timestamp for when
the START event was accepted. The **official** time is the run record, taken
from the device timestamps (Rule 6.1(1)), and it is what the scoreboard, the
portal and the results publish. The two agree to a fraction of a second, but if
they ever disagree the overlay is the one that is wrong. Never read a result off
the stream.

The bridge measures the difference between its own clock and the API's on every
poll and corrects for it, so a laptop whose clock has drifted still shows the
right elapsed time.

## Privacy

The bridge reads `GET /public/lanes`, which is unauthenticated and returns team
names only. Internal competitor numbers are never exposed there, because Rule
10.1(3) forbids putting them on a public display — which is exactly why the
overlay does not simply read `/admin/lanes`.

## Testing without the field

```bash
npm run test:obs
```

covers the display decisions — they live in `obs-bridge-core.ts`, apart from the
polling loop in `obs-bridge-runner.ts` that both the desktop application and the
CLI drive. To watch real files move, point `OBS_API_URL` at any server returning
a `/public/lanes` payload.
