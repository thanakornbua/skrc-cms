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
The page has a transparent background and draws the stage name, the team name,
the running clock, the attempt (`Attempt 2 of 3`) and the team's best time this
stage; style and crop it from OBS as any other source.

It holds an SSE connection to `/public/lanes/stream`, which sends the current
state on connect and every change as it happens, with a slow refresh underneath
as a safety net. If the console restarts, the browser reconnects on its own —
nobody has to touch OBS. A failed refresh leaves the last known state on screen
rather than blanking mid-run.

Nothing is loaded from the internet: no fonts, no scripts, no images. The
overlay keeps working at a venue with no uplink.

## One source per element

The combined page above imposes its layout. For a scene that places each value
itself, every field is also its own page — one Browser Source each, positioned
and styled in OBS:

```
http://127.0.0.1:7070/overlay/stage      Qualifying round
http://127.0.0.1:7070/overlay/team       SS2-04
http://127.0.0.1:7070/overlay/clock      0:42.123
http://127.0.0.1:7070/overlay/attempt    Attempt 2 of 3
http://127.0.0.1:7070/overlay/best       0:41.902
http://127.0.0.1:7070/overlay/status     Final | Time limit | Under review | On the line
```

Same feed and the same rules as the combined overlay: pushed by SSE, repainted
every frame, a finished time held five seconds, an arming lane taking the screen
back. All six compute the display state identically, so separate sources can
never disagree about who is on screen.

Size each Browser Source to the space the element occupies in the scene — a
clock might be 600×160 — and set the text size with the query string rather
than by scaling the source, which would blur it:

| Parameter | Default | Accepts |
| --- | --- | --- |
| `size` | `9vh` | `14vh`, `72px`, `4rem` — `vh` is relative to the source's own height |
| `color` | `#ffffff` | `#00ff88`, `white` |
| `weight` | `700` | `100`–`900`, `normal`, `bold` |
| `align` | `left` | `left`, `center`, `right` |
| `font` | IBM Plex Sans, IBM Plex Sans Thai | any family installed on the machine |

```
http://127.0.0.1:7070/overlay/clock?size=90px&color=%2300ff88&align=center
```

Remember to URL-encode `#` as `%23`. Anything that does not match the expected
shape falls back to its default rather than failing, so a typo renders plainly
instead of rendering nothing.

A field is empty whenever it would be meaningless — no team on the line, a team
with no completed run — and an empty page draws nothing, so no visibility
toggling is needed.

### Fonts

The overlay asks for **IBM Plex Sans**, with **IBM Plex Sans Thai** behind it.
Both are needed: Plex Sans carries no Thai glyphs, so a Thai team name would
otherwise fall through to whatever Windows picked next — a different face, at a
different weight, mid-scene. A browser can only use a font installed on the
machine drawing it, so install them wherever OBS runs:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-overlay-fonts.ps1
```

Per-user, so no administrator rights, and safe to re-run. Restart OBS
afterwards. Verify with:

```powershell
[Drawing.FontFamily]::Families | Where-Object Name -like "IBM Plex*"
```

Neither family is bundled with the application: IBM Plex is SIL Open Font
License 1.1, and the licence file is installed alongside the fonts.

## Pulling the data yourself

Both overlays above are just clients. The engine's side of the contract is two
unauthenticated, CORS-open (`Access-Control-Allow-Origin: *`) endpoints, so a
graphics page of your own — loaded from disk in a Browser Source, or served
anywhere — can read them directly:

| Endpoint | Shape |
| --- | --- |
| `GET http://127.0.0.1:7070/public/lanes` | One JSON snapshot |
| `GET http://127.0.0.1:7070/public/lanes/stream` | The same snapshot as SSE: on connect, on every change, plus a refresh every 5s |

```json
{
  "activeStage": "ROUND_1",
  "stageLabel": "Qualifying round",
  "serverTime": "2026-08-18T04:00:00.000Z",
  "lanes": [{
    "laneId": "1",
    "state": "IDLE | ASSIGNED | ARMED | RUNNING",
    "teamName": "SS2-04",
    "runStartedAt": "2026-08-18T03:59:47.500Z",
    "attempt": 2,
    "attemptsTotal": 3,
    "bestMs": 41902,
    "lastResult": {
      "teamName": "SS2-04",
      "elapsedMs": 42123,
      "status": "COMPLETE | TIMED_OUT | UNDER_REVIEW",
      "finishedAt": "2026-08-18T04:00:00.000Z",
      "attempt": 2,
      "attemptsTotal": 3,
      "bestMs": 41902
    }
  }]
}
```

Consuming it, in the order that matters:

1. **`RUNNING` beats `ARMED` beats `ASSIGNED`.** With one lane this is just "the
   lane", but the ordering keeps a multi-lane scene sensible.
2. **Count the clock locally.** `runStartedAt` is a server timestamp; tick from
   it with `requestAnimationFrame` rather than asking the API for every frame.
   Correct for clock skew with `serverTime` minus your own clock at receipt —
   it is near zero on the operator laptop and seconds off against a remote API.
3. **`lastResult` is how a finished time stays up.** The lane is `IDLE` the
   instant a run stops. Hold the result while `now - finishedAt` is under your
   chosen window (the built-in overlays use five seconds), and let an armed lane
   preempt it.
4. **Nothing here is official.** The overlay clock is a broadcast
   approximation; the run record is the official time (Rule 6.1(1)).
5. **No internal competitor IDs** appear, deliberately (Rule 10.1(3)). Do not
   add them to anything on screen.

Everything else — `/admin/*` and the rest — stays restricted to `CORS_ORIGIN`
and needs a bearer token; only `/public` is open.

## Text files

Feeds five OBS text sources — `SKRC_StageName`, `SKRC_TeamName`,
`SKRC_ElapsedTime`, `SKRC_Attempt`, `SKRC_BestTime` — from the competition API.

The bridge writes three plain-text files and OBS reads them. There is no
WebSocket connection, no password, and no plugin: OBS and the bridge can start,
stop, or crash in any order without either needing to know. The worst failure is
a number that stops updating, never a blank or broken scene.

### One-time OBS setup

For each of the five text sources: **Properties → tick "Read from file" →
browse to the matching `.txt`**. Leave everything else — font, colour, position
— as it already is. The bridge only ever changes the text.

The files are named exactly after the sources:

```
obs/SKRC_StageName.txt     Qualifying round
obs/SKRC_TeamName.txt      SS2-04
obs/SKRC_ElapsedTime.txt   0:42.123
obs/SKRC_Attempt.txt       Attempt 2 of 3
obs/SKRC_BestTime.txt      0:41.902
```

`SKRC_Attempt` and `SKRC_BestTime` are empty whenever they would be
meaningless — no team on screen, or a team with no completed run yet. An empty
source draws nothing, so a scene that uses them needs no visibility toggling.

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
| Any of the above | The attempt being run, and the team's best time this stage |
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
