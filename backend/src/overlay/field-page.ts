import { type FieldStyle, type OverlayField } from "./fields.js";

/**
 * One value, on its own transparent page, for a single OBS Browser Source.
 *
 * Same feed and the same display rules as the combined overlay — pushed by SSE,
 * repainted every frame, a finished time held briefly — but it draws exactly
 * one field, so the scene owns the layout. Empty when the value would be
 * meaningless (no team on the line, no completed run yet), and an empty page
 * draws nothing, so no visibility toggling is needed.
 */
export function overlayFieldPage(field: OverlayField, style: FieldStyle): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SKRC ${field}</title>
<style>
  html, body { margin: 0; height: 100%; background: transparent; }
  body {
    display: flex; align-items: center;
    justify-content: ${style.align === "center" ? "center" : style.align === "right" ? "flex-end" : "flex-start"};
    font-family: ${style.font};
    color: ${style.color};
    font-size: ${style.size};
    font-weight: ${style.weight};
    text-align: ${style.align};
    /* A stroke rather than a panel: legible over a bright floor or a dark
       robot without covering the shot. */
    text-shadow: 0 0 0.18em rgba(0,0,0,0.95), 0 0.06em 0.12em rgba(0,0,0,0.9);
    /* Digits must not shift the line as they tick. */
    font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;
    overflow: hidden; white-space: nowrap;
  }
  #value { transition: opacity 200ms ease; }
</style>
</head>
<body>
<div id="value"></div>
<script>
(function () {
  var FIELD = ${JSON.stringify(field)};
  var valueEl = document.getElementById("value");
  var snapshot = null;
  var skewMs = 0;
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

  /* The whole display state, computed the same way for every field, so separate
     sources can never disagree about who is on screen. */
  function state(now) {
    var blank = { stage: "", team: "", clock: "", attempt: "", best: "", status: "" };
    if (!snapshot) return blank;
    blank.stage = snapshot.stageLabel || "";
    var lanes = snapshot.lanes || [];
    var lane = focusLane(lanes);

    function withTeam(teamName, clock, status, attempt, attemptsTotal, bestMs) {
      return {
        stage: blank.stage,
        team: teamName,
        clock: clock,
        attempt: typeof attempt === "number" && typeof attemptsTotal === "number"
          ? "Attempt " + attempt + " of " + attemptsTotal : "",
        best: typeof bestMs === "number" ? formatElapsed(bestMs) : "",
        status: status,
      };
    }

    if (lane && lane.teamName && lane.state === "RUNNING" && lane.runStartedAt) {
      var started = Date.parse(lane.runStartedAt);
      if (isFinite(started)) {
        return withTeam(lane.teamName, formatElapsed(now - skewMs - started), "",
          lane.attempt, lane.attemptsTotal, lane.bestMs);
      }
    }
    if (lane && lane.teamName && lane.state === "ARMED") {
      return withTeam(lane.teamName, formatElapsed(0), "On the line",
        lane.attempt, lane.attemptsTotal, lane.bestMs);
    }
    var held = heldResult(lanes, now);
    if (held && held.teamName) {
      return withTeam(held.teamName, formatElapsed(held.elapsedMs),
        RESULT_TAGS[held.status] || "Final", held.attempt, held.attemptsTotal, held.bestMs);
    }
    return blank;
  }

  function draw() {
    requestAnimationFrame(draw);
    var text = state(Date.now())[FIELD] || "";
    if (valueEl.textContent !== text) valueEl.textContent = text;
    valueEl.style.opacity = text === "" ? "0" : "1";
  }
  requestAnimationFrame(draw);

  /* EventSource reconnects on its own, so a restarted console brings every
     source back without anyone touching OBS. */
  new EventSource("/public/lanes/stream").onmessage = function (event) {
    try {
      var received = Date.now();
      var parsed = JSON.parse(event.data);
      var serverMs = Date.parse(parsed.serverTime);
      if (isFinite(serverMs)) skewMs = received - serverMs;
      snapshot = parsed;
    } catch (error) { /* keep the previous snapshot */ }
  };
})();
</script>
</body>
</html>`;
}
