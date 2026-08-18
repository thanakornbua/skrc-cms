import assert from "node:assert/strict";
import test from "node:test";
import {
  clockSkewMs, focusLane, formatElapsed, overlayText, type PublicLane, type PublicLanesSnapshot, RESULT_HOLD_MS,
} from "./obs-bridge-core.js";

const lane = (over: Partial<PublicLane> = {}): PublicLane => ({
  laneId: "1", state: "IDLE", teamName: null, runStartedAt: null, ...over,
});

const snapshotOf = (lanes: PublicLane[], serverTime = "2026-08-18T10:00:00.000Z"): PublicLanesSnapshot => ({
  activeStage: "ROUND_1", stageLabel: "Qualifying round", serverTime, lanes,
});

const AT = Date.parse("2026-08-18T10:00:00.000Z");

test("a running lane shows its team and a live clock", () => {
  const snapshot = snapshotOf([lane({ state: "RUNNING", teamName: "Team A", runStartedAt: "2026-08-18T09:59:47.500Z" })]);
  assert.deepEqual(overlayText(snapshot, AT), {
    SKRC_StageName: "Qualifying round",
    SKRC_TeamName: "Team A",
    SKRC_ElapsedTime: "0:12.500",
  });
});

test("an armed lane shows the team about to run at zero", () => {
  const snapshot = snapshotOf([lane({ state: "ARMED", teamName: "Team B" })]);
  assert.deepEqual(overlayText(snapshot, AT), {
    SKRC_StageName: "Qualifying round",
    SKRC_TeamName: "Team B",
    SKRC_ElapsedTime: "0:00.000",
  });
});

test("an idle field clears the run fields but keeps the stage", () => {
  assert.deepEqual(overlayText(snapshotOf([lane()]), AT), {
    SKRC_StageName: "Qualifying round", SKRC_TeamName: "", SKRC_ElapsedTime: "",
  });
});

test("everything is blank before the first successful poll", () => {
  assert.deepEqual(overlayText(null, AT), {
    SKRC_StageName: "", SKRC_TeamName: "", SKRC_ElapsedTime: "",
  });
});

test("a running lane wins over one that is merely armed", () => {
  const running = lane({ laneId: "2", state: "RUNNING", teamName: "Team R", runStartedAt: "2026-08-18T09:59:59.000Z" });
  assert.equal(focusLane([lane({ state: "ARMED", teamName: "Team A" }), running])?.laneId, "2");
});

test("clock skew keeps the displayed time honest against a server on another clock", () => {
  // This machine is 5 s ahead of the API; a run started 2 s ago must not read 7 s.
  const snapshot = snapshotOf([lane({ state: "RUNNING", teamName: "Team A", runStartedAt: "2026-08-18T09:59:58.000Z" })]);
  const skew = clockSkewMs(snapshot, AT + 5000);
  assert.equal(skew, 5000);
  assert.equal(overlayText(snapshot, AT + 5000, skew).SKRC_ElapsedTime, "0:02.000");
});

test("a clock that would read negative is floored at zero rather than shown", () => {
  const snapshot = snapshotOf([lane({ state: "RUNNING", teamName: "Team A", runStartedAt: "2026-08-18T10:00:03.000Z" })]);
  assert.equal(overlayText(snapshot, AT).SKRC_ElapsedTime, "0:00.000");
});

test("elapsed time crosses into minutes readably", () => {
  assert.equal(formatElapsed(0), "0:00.000");
  assert.equal(formatElapsed(9999), "0:09.999");
  assert.equal(formatElapsed(65432), "1:05.432");
  assert.equal(formatElapsed(180000), "3:00.000");
});

test("a lane holding an unknown team shows nothing rather than a blank name", () => {
  const snapshot = snapshotOf([lane({ state: "RUNNING", teamName: null, runStartedAt: "2026-08-18T09:59:50.000Z" })]);
  assert.equal(overlayText(snapshot, AT).SKRC_TeamName, "");
  assert.equal(overlayText(snapshot, AT).SKRC_ElapsedTime, "");
});

test("a finished run holds its time on screen, then clears", () => {
  const finishedAt = "2026-08-18T04:00:00.000Z";
  const finishedMs = Date.parse(finishedAt);
  const snapshot: PublicLanesSnapshot = {
    activeStage: "ROUND_1",
    stageLabel: "Qualifying round",
    serverTime: finishedAt,
    lanes: [{
      laneId: "1", state: "IDLE", teamName: null, runStartedAt: null,
      lastResult: { teamName: "SS2-04", elapsedMs: 42_123, status: "COMPLETE", finishedAt },
    }],
  };

  // Inside the hold window the finishing time is still up.
  const held = overlayText(snapshot, finishedMs + 2000);
  assert.equal(held.SKRC_TeamName, "SS2-04");
  assert.equal(held.SKRC_ElapsedTime, "0:42.123");
  assert.equal(held.SKRC_StageName, "Qualifying round");

  // The number does not drift while it is held — it is a result, not a clock.
  assert.equal(overlayText(snapshot, finishedMs + 4900).SKRC_ElapsedTime, "0:42.123");

  // After it, the field clears back to the stage name alone.
  const cleared = overlayText(snapshot, finishedMs + RESULT_HOLD_MS + 1);
  assert.equal(cleared.SKRC_TeamName, "");
  assert.equal(cleared.SKRC_ElapsedTime, "");
  assert.equal(cleared.SKRC_StageName, "Qualifying round");
});

test("an armed lane takes the screen from a result still inside its hold", () => {
  const finishedAt = "2026-08-18T04:00:00.000Z";
  const snapshot: PublicLanesSnapshot = {
    activeStage: "ROUND_1",
    stageLabel: "Qualifying round",
    serverTime: finishedAt,
    lanes: [
      { laneId: "1", state: "ARMED", teamName: "Next Team", runStartedAt: null,
        lastResult: { teamName: "SS2-04", elapsedMs: 42_123, status: "COMPLETE", finishedAt } },
    ],
  };
  const text = overlayText(snapshot, Date.parse(finishedAt) + 1000);
  assert.equal(text.SKRC_TeamName, "Next Team");
  assert.equal(text.SKRC_ElapsedTime, "0:00.000");
});
