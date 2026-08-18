/**
 * The broadcast overlay, as one self-contained page for an OBS Browser Source.
 *
 * Why this exists alongside the text files: a text source re-reads its file on
 * OBS's own schedule, so a file-fed clock can only ever be as smooth as that
 * cadence, and a team name appears when OBS next looks rather than when the
 * lane is armed. A Browser Source is pushed (SSE) and repainted every frame, so
 * arming shows immediately and the clock does not stutter.
 *
 * Served from the competition API on the operator's own laptop, with no
 * external fonts, scripts or images — an overlay that needs the internet is an
 * overlay that goes blank at the venue.
 *
 * Layout is deliberately bare: OBS positions, scales and crops the source, and
 * anything decorative here would fight the scene the broadcast team built.
 * Transparent background, so it composites over the camera.
 */
export function overlayPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SKRC overlay</title>
<style>
  :root { color-scheme: dark; }
  html, body {
    margin: 0; height: 100%; background: transparent;
    font-family: "Segoe UI", system-ui, sans-serif; color: #fff;
  }
  #overlay {
    display: flex; flex-direction: column; gap: 0.15em;
    padding: 2vh 2vw; align-items: flex-start;
    /* A stroke rather than a box: legible over a bright floor or a dark
       robot without covering the shot with a panel. */
    text-shadow: 0 0 0.18em rgba(0,0,0,0.95), 0 0.06em 0.12em rgba(0,0,0,0.9);
  }
  #stage { font-size: 3.2vh; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.92; }
  #team { font-size: 7.5vh; font-weight: 700; line-height: 1.05; }
  /* Tabular figures stop the digits from shifting the line on every repaint. */
  #clock {
    font-size: 9vh; font-weight: 700;
    font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;
  }
  /* A held result is a different thing from a running clock and should not be
     mistaken for one: it stops moving, and it says so. */
  #overlay.result #clock { color: #7dffa8; }
  #overlay.result.timed-out #clock { color: #ffcf6b; }
  #tag {
    font-size: 2.6vh; letter-spacing: 0.22em; text-transform: uppercase;
    font-weight: 700; opacity: 0.95;
  }
  #overlay > * { transition: opacity 220ms ease; }
  .hidden { visibility: hidden; opacity: 0; }
</style>
</head>
<body>
<div id="overlay">
  <div id="stage"></div>
  <div id="team" class="hidden"></div>
  <div id="clock" class="hidden"></div>
  <div id="tag" class="hidden"></div>
</div>
<script>
(function () {
  var stageEl = document.getElementById("stage");
  var teamEl = document.getElementById("team");
  var clockEl = document.getElementById("clock");
  var tagEl = document.getElementById("tag");
  var overlayEl = document.getElementById("overlay");
  var snapshot = null;
  var skewMs = 0;

  /* Matches RESULT_HOLD_MS in the bridge, so the browser overlay and the text
     files clear at the same moment on a scene that uses both. */
  var RESULT_HOLD_MS = 5000;
  var RESULT_TAGS = { COMPLETE: "Final", TIMED_OUT: "Time limit", UNDER_REVIEW: "Under review" };

  function focusLane(lanes) {
    var order = ["RUNNING", "ARMED", "ASSIGNED"];
    for (var i = 0; i < order.length; i++) {
      for (var j = 0; j < lanes.length; j++) {
        if (lanes[j].state === order[i]) return lanes[j];
      }
    }
    return null;
  }

  function formatElapsed(ms) {
    var clamped = Math.max(0, ms);
    var minutes = Math.floor(clamped / 60000);
    var seconds = Math.floor((clamped % 60000) / 1000);
    var millis = Math.floor(clamped % 1000);
    return minutes + ":" + String(seconds).padStart(2, "0") + "." + String(millis).padStart(3, "0");
  }

  function show(el, text) {
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle("hidden", text === "");
  }

  /* The newest result still inside its hold window. Only consulted when no lane
     is live: a team arming is what the audience is watching now, and it takes
     the screen from a finished one. */
  function heldResult(lanes, now) {
    var newest = null;
    for (var i = 0; i < lanes.length; i++) {
      var result = lanes[i].lastResult;
      if (!result) continue;
      var finished = Date.parse(result.finishedAt);
      if (!isFinite(finished) || now - skewMs - finished > RESULT_HOLD_MS) continue;
      if (!newest || finished > Date.parse(newest.finishedAt)) newest = result;
    }
    return newest;
  }

  function paint(mode, team, clock, tag) {
    overlayEl.classList.toggle("result", mode === "result");
    overlayEl.classList.toggle("timed-out", tag === RESULT_TAGS.TIMED_OUT || tag === RESULT_TAGS.UNDER_REVIEW);
    show(teamEl, team);
    show(clockEl, clock);
    show(tagEl, tag);
  }

  /* Redrawn every frame: the clock is the only thing that moves, and the
     browser is already painting anyway. */
  function draw() {
    requestAnimationFrame(draw);
    var now = Date.now();
    if (!snapshot) { show(stageEl, ""); paint("idle", "", "", ""); return; }
    show(stageEl, snapshot.stageLabel || "");
    var lanes = snapshot.lanes || [];
    var lane = focusLane(lanes);

    if (lane && lane.teamName && lane.state === "RUNNING" && lane.runStartedAt) {
      var started = Date.parse(lane.runStartedAt);
      if (isFinite(started)) {
        paint("live", lane.teamName, formatElapsed(now - skewMs - started), "");
        return;
      }
    }
    if (lane && lane.teamName && lane.state === "ARMED") {
      paint("live", lane.teamName, formatElapsed(0), "On the line");
      return;
    }

    var held = heldResult(lanes, now);
    if (held && held.teamName) {
      paint("result", held.teamName, formatElapsed(held.elapsedMs), RESULT_TAGS[held.status] || "Final");
      return;
    }
    paint("idle", "", "", "");
  }
  requestAnimationFrame(draw);

  /* EventSource reconnects on its own, so a restarted API brings the overlay
     back without anyone touching OBS. A failed snapshot leaves the last known
     state on screen — a frozen number beats a blank scene mid-run. */
  function connect() {
    var source = new EventSource("/public/lanes/stream");
    source.onmessage = function (event) {
      try {
        var received = Date.now();
        var parsed = JSON.parse(event.data);
        var serverMs = Date.parse(parsed.serverTime);
        if (isFinite(serverMs)) skewMs = received - serverMs;
        snapshot = parsed;
      } catch (error) { /* keep the previous snapshot */ }
    };
  }
  connect();
})();
</script>
</body>
</html>`;
}
