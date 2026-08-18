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
  .hidden { visibility: hidden; }
</style>
</head>
<body>
<div id="overlay">
  <div id="stage"></div>
  <div id="team" class="hidden"></div>
  <div id="clock" class="hidden"></div>
</div>
<script>
(function () {
  var stageEl = document.getElementById("stage");
  var teamEl = document.getElementById("team");
  var clockEl = document.getElementById("clock");
  var snapshot = null;
  var skewMs = 0;

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

  /* Redrawn every frame: the clock is the only thing that moves, and the
     browser is already painting anyway. */
  function draw() {
    requestAnimationFrame(draw);
    if (!snapshot) { show(stageEl, ""); show(teamEl, ""); show(clockEl, ""); return; }
    show(stageEl, snapshot.stageLabel || "");
    var lane = focusLane(snapshot.lanes || []);
    if (!lane || !lane.teamName) { show(teamEl, ""); show(clockEl, ""); return; }
    if (lane.state === "RUNNING" && lane.runStartedAt) {
      var started = Date.parse(lane.runStartedAt);
      if (!isFinite(started)) { show(teamEl, ""); show(clockEl, ""); return; }
      show(teamEl, lane.teamName);
      show(clockEl, formatElapsed(Date.now() - skewMs - started));
      return;
    }
    if (lane.state === "ARMED") {
      show(teamEl, lane.teamName);
      show(clockEl, formatElapsed(0));
      return;
    }
    show(teamEl, "");
    show(clockEl, "");
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
