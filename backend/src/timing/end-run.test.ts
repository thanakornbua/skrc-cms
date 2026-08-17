import assert from "node:assert/strict";
import test from "node:test";
import { stageAttemptState } from "./budget.js";
import { scoreCompetitorStage } from "../competition/scoring.js";
import { rankStageCategory } from "../competition/scoring.js";
import type { RunRecord } from "../runs/types.js";
import type { CompetitorRecord } from "../competitors/types.js";

/**
 * Shape of the record recordForfeitedAttempt writes: an attempt consumed
 * without the robot ever being released. The point of these tests is that the
 * synthesized run needs no special case anywhere — scoring and the attempt
 * budget must already read it correctly as "consumed, worth maxTimeMs".
 */
function forfeitedRun(id: string, resolution: RunRecord["reviewResolution"]): RunRecord {
  return {
    PK: "COMP#C-0001", SK: `RUN#${id}`, runId: id, laneId: "",
    startDeviceTs: 0, stopDeviceTs: null, elapsedMs: null, splits: [], debounce: {},
    status: "TIMED_OUT", minTimeMs: 4999, maxTimeMs: 180000, stage: "ROUND_1",
    reviewResolution: resolution, reviewReason: "did not present",
    reviewedAt: "2026-01-01T00:00:00.000Z", reviewedBy: "committee-1",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function completedRun(id: string, elapsedMs: number): RunRecord {
  return {
    PK: "COMP#C-0001", SK: `RUN#${id}`, runId: id, laneId: "1",
    startDeviceTs: 0, stopDeviceTs: elapsedMs, elapsedMs, splits: [], debounce: {},
    status: "COMPLETE", minTimeMs: 4999, maxTimeMs: 180000, stage: "ROUND_1",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function competitor(competitorId: string): CompetitorRecord {
  return {
    competitorId, teamName: `Team ${competitorId}`, category: "Line Tracing - Open",
    createdAt: "2026-01-01T00:00:00.000Z",
    disqualified: { bool: false, reason: null, byUser: null, at: null },
  } as CompetitorRecord;
}

test("a forfeited attempt consumes one of the three run rights", () => {
  const runs = [forfeitedRun("f1", "NO_SHOW")];
  assert.deepEqual(stageAttemptState(runs, [], "ROUND_1"), { consumed: 1, unresolved: false });
});

test("a forfeited attempt scores at the stage maximum, not as a missing run", () => {
  const result = scoreCompetitorStage(
    { competitor: competitor("C-0001"), runs: [forfeitedRun("f1", "GRACE_EXPIRED")], corrections: [], penalties: [] },
    "ROUND_1",
  );
  assert.ok(result);
  assert.equal(result.aggregateTimeMs, 180000);
  assert.equal(result.finalTimeMs, 180000);
  // It is not a completed lap — Rule 6.4 must still rank a team that finished
  // ahead of one that only has max-time entries.
  assert.equal(result.completedLap, false);
  assert.equal(result.completedRunCount, 0);
});

test("a no-show is ranked last rather than dropped from the standings", () => {
  // The decision this pins: no-shows take max time with a NO_SHOW label instead
  // of being disqualified, because a DQ would remove them from the ranking
  // entirely along with any time they had already set.
  const ranked = rankStageCategory([
    { competitor: competitor("C-0001"), runs: [forfeitedRun("f1", "NO_SHOW")], corrections: [], penalties: [] },
    { competitor: competitor("C-0002"), runs: [completedRun("r1", 30000), completedRun("r2", 32000)], corrections: [], penalties: [] },
  ], "ROUND_1", true);

  const category = ranked[0];
  assert.equal(category.ranked.length, 2);
  assert.equal(category.ranked[0].competitorId, "C-0002");
  assert.equal(category.ranked[1].competitorId, "C-0001");
  assert.equal(category.unranked.length, 0, "a no-show must appear in the ranking, not as unranked");
  assert.equal(category.disqualified.length, 0, "a no-show is not a disqualification");
});

test("a team that ran once then vanished keeps the time it actually set", () => {
  const result = scoreCompetitorStage({
    competitor: competitor("C-0003"),
    runs: [completedRun("r1", 28000), forfeitedRun("f1", "NO_SHOW")],
    corrections: [], penalties: [],
  }, "ROUND_1");
  assert.ok(result);
  assert.equal(result.lapTimeMs, 28000, "the recorded lap survives the no-show");
  // Averaged with the max-time forfeit: ceil((28000 + 180000) / 2).
  assert.equal(result.aggregateTimeMs, 104000);
});
