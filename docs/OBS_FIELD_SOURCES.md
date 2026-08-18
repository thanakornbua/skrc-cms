# OBS: one Browser Source per field

For a scene that places each value itself. Every field is its own page, so the
broadcast design decides position, size and colour — the console only supplies
the value.

If you would rather not lay anything out, use the single combined overlay at
`http://127.0.0.1:7070/overlay` instead and skip this page.

Everything here needs the console running on the same machine as OBS. Nothing
loads from the internet.

## The URLs

| Field | URL | Shows |
| --- | --- | --- |
| Stage | `http://127.0.0.1:7070/overlay/stage` | `Qualifying round` |
| Team | `http://127.0.0.1:7070/overlay/team` | `SS2-04` |
| Clock | `http://127.0.0.1:7070/overlay/clock` | `0:42.123` |
| Attempt | `http://127.0.0.1:7070/overlay/attempt` | `Attempt 2 of 3` |
| Best time | `http://127.0.0.1:7070/overlay/best` | `0:41.902` |
| Status | `http://127.0.0.1:7070/overlay/status` | `On the line`, `Final`, `Time limit`, `Under review` |

Add only the ones the scene uses. They stay in step with each other — all six
read the same feed and decide who is on screen with the same rule.

## Adding one in OBS

1. **Sources → + → Browser**, name it after the field (`SKRC Clock`).
2. Paste the URL.
3. Set **Width** and **Height** to the space the element occupies in the scene —
   not the canvas size. A clock reads well at about `600 × 160`, a team name at
   `900 × 140`.
4. **Untick "Shutdown source when not visible"** and **"Refresh browser when
   scene becomes active"**. Both tear down a live connection that should stay up.
5. **OK**, then position it.

Repeat per field. The page background is transparent, so it composites over the
camera with no keying.

## Sizing the text

Set the text size in the URL. Do **not** scale the source in OBS to make text
bigger — that stretches a rendered bitmap and the result is soft on a stream.

```
http://127.0.0.1:7070/overlay/clock?size=120px
http://127.0.0.1:7070/overlay/team?size=64px&color=%23ffd166
http://127.0.0.1:7070/overlay/attempt?size=32px&align=center&weight=500
```

| Parameter | Default | Accepts |
| --- | --- | --- |
| `size` | `9vh` | `120px`, `4rem`, `14vh` — `vh` is a percentage of that source's own height, so `50vh` is half its box |
| `color` | `#ffffff` | `#ffd166`, `white`. **Encode `#` as `%23`** in the URL |
| `weight` | `700` | `100`–`900`, `normal`, `bold` |
| `align` | `left` | `left`, `center`, `right` — within the source's own box |
| `font` | IBM Plex Sans, IBM Plex Sans Thai | any family installed on this machine |

A value that is not understood falls back to its default, so a typo renders
plainly rather than not at all. After editing a URL, click **OK** — the source
reloads itself.

## Fonts

The default is IBM Plex Sans with IBM Plex Sans Thai behind it, because Plex
Sans carries no Thai glyphs and roughly half the teams register under Thai
names. Install both on the OBS machine, or every one of those names falls back
to whatever Windows picks:

```powershell
powershell -ExecutionPolicy Bypass -File \\wsl.localhost\Ubuntu\home\thanakornbua\skrc-robo-compet\scripts\install-overlay-fonts.ps1
```

Restart OBS afterwards. Check they arrived with:

```powershell
[Drawing.FontFamily]::Families | Where-Object Name -like "IBM Plex*"
```

If this machine has no access to that path, copy `install-overlay-fonts.ps1`
across and run it locally — it downloads the fonts itself and needs no
administrator rights.

## What each field does between runs

Nothing needs hiding or showing by hand. A field is blank whenever it would be
meaningless, and a blank page draws nothing.

| Moment | Team | Clock | Attempt | Best | Status |
| --- | --- | --- | --- | --- | --- |
| Lane armed | team | `0:00.000` | `Attempt 2 of 3` | best so far | `On the line` |
| Running | team | counting | `Attempt 2 of 3` | best so far | blank |
| Just finished | team | final time, frozen | the attempt it was | best incl. this run | `Final` |
| Five seconds later | blank | blank | blank | blank | blank |

The finished result is held for five seconds, then everything clears back to the
stage name alone. A lane being armed replaces it early — whoever is about to run
outranks whoever just did.

`Best` is empty for a team with no completed run yet, rather than `0:00.000`.

## If a source is blank when it should not be

1. **Is the console running and signed in?** The lane feed reads the competition
   table, and nothing is readable until an operator signs in. Open
   `http://127.0.0.1:7070/public/lanes` in a browser — a JSON snapshot means the
   feed is healthy, a `500` means sign in first.
2. **Right-click the source → Interact**, or **Refresh**. A source added before
   the console started may never have connected.
3. **Check the port.** These URLs are `7070`. An older build used `3210`.
4. **Read the log**: `%APPDATA%\SKRC Competition Day\console.log`.

The clock is a broadcast approximation. The official time is the run record
(Rule 6.1(1)) — never read a result off the stream.
