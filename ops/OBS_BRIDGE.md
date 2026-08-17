# OBS overlay bridge

Feeds three OBS text sources — `SKRC_StageName`, `SKRC_TeamName`,
`SKRC_ElapsedTime` — from the competition API.

The bridge writes three plain-text files and OBS reads them. There is no
WebSocket connection, no password, and no plugin: OBS and the bridge can start,
stop, or crash in any order without either needing to know. The worst failure is
a number that stops updating, never a blank or broken scene.

## One-time OBS setup

For each of the three text sources: **Properties → tick "Read from file" →
browse to the matching `.txt`**. Leave everything else — font, colour, position
— as it already is. The bridge only ever changes the text.

The files live in `OBS_OUT_DIR` (default `./obs` relative to wherever the bridge
is started) and are named exactly after the sources:

```
obs/SKRC_StageName.txt
obs/SKRC_TeamName.txt
obs/SKRC_ElapsedTime.txt
```

Start the bridge once before configuring the sources so the files exist and the
file picker can see them.

## Running it

From `ops/`, on the same laptop as the API and OBS:

```bash
npm run obs-bridge
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `OBS_API_URL` | `http://127.0.0.1:3000` | Competition API base URL. Use the laptop's local API on competition day. |
| `OBS_OUT_DIR` | `obs` | Where the three text files are written. |
| `OBS_POLL_MS` | `1000` | How often lane state is fetched. |
| `OBS_TICK_MS` | `100` | How often the clock is redrawn between polls. |

The clock is redrawn locally ten times a second and lane state is fetched once a
second — polling an API at 10 Hz just to animate a number would be waste. Files
are written only when the text actually changes, and through a temp-file rename
so OBS never reads a half-written line.

## What appears on screen

| Field state | Shown |
| --- | --- |
| A lane is `RUNNING` | Team name, and a clock counting from the run's start |
| A lane is `ARMED` | Team name, `0:00.000` — the audience sees who is about to go |
| Nothing armed or running | Stage name only; team and clock are cleared |
| Before the first successful poll | All three blank |

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

covers the display decisions. To watch real files move, point `OBS_API_URL` at
any server returning a `/public/lanes` payload.
