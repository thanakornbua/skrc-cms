import assert from "node:assert/strict";
import test from "node:test";
import { rankStageCategory } from "./scoring.js";
import type { StageScoringInput } from "./scoring.js";

function entry(id: string, runs: Array<Record<string, unknown>>): StageScoringInput {
  return {
    competitor: { competitorId: id, teamName: id, category: "Open", disqualified: { bool: false } } as StageScoringInput["competitor"],
    runs: runs.map((run, index) => ({
      PK: `COMP#${id}`, SK: `RUN#${index}`, runId: String(index), laneId: "1",
      startDeviceTs: 0, stopDeviceTs: null, elapsedMs: null, splits: [], debounce: {},
      minTimeMs: 0, maxTimeMs: 180000, createdAt: `2026-01-01T00:00:0${index}.000Z`, ...run,
    })) as StageScoringInput["runs"], corrections: [], penalties: [],
  };
}

test("checkpoint stages rank completed laps before furthest checkpoints", () => {
  const results = rankStageCategory([
    entry("C-1", [{ stage: "ROUND_1", status: "TIMED_OUT", splits: [{ gateId: "A" }, { gateId: "B" }, { gateId: "B" }] }]),
    entry("C-2", [{ stage: "ROUND_1", status: "COMPLETE", elapsedMs: 90000 }]),
    entry("C-3", [{ stage: "ROUND_1", status: "TIMED_OUT", splits: [{ gateId: "A" }, { gateId: "B" }, { gateId: "C" }] }]),
  ], "ROUND_1", true)[0];
  assert.deepEqual(results.ranked.map((item) => item.competitorId), ["C-2", "C-3", "C-1"]);
  assert.equal(results.ranked[2].furthestCheckpoint, 2);
});
test("time-average stages average two fastest valid times and use one when alone", () => {
  const results = rankStageCategory([
    entry("C-1", [{ stage: "BEST_OF_2", status: "COMPLETE", elapsedMs: 1000 }, { stage: "BEST_OF_2", status: "COMPLETE", elapsedMs: 3000 }]),
    entry("C-2", [{ stage: "BEST_OF_2", status: "COMPLETE", elapsedMs: 1900 }]),
    entry("C-3", [{ stage: "BEST_OF_2", status: "TIMED_OUT" }]),
  ], "BEST_OF_2", true)[0];
  assert.deepEqual(results.ranked.map((item) => item.competitorId), ["C-2", "C-1"]);
  assert.equal(results.ranked[1].aggregateTimeMs, 2000);
  assert.deepEqual(results.unranked.map((item) => item.competitorId), ["C-3"]);
});

test("void and invalid runs never contribute checkpoint progress or a time", () => {
  const results = rankStageCategory([
    entry("C-1", [{ stage: "ROUND_1", status: "VOID", splits: [{ gateId: "A" }, { gateId: "B" }] }]),
    entry("C-2", [{ stage: "ROUND_1", status: "INVALID", splits: [{ gateId: "A" }] }]),
    entry("C-3", [{ stage: "ROUND_1", status: "TIMED_OUT", splits: [{ gateId: "A" }] }]),
  ], "ROUND_1", true)[0];
  assert.deepEqual(results.ranked.map((item) => item.competitorId), ["C-3"]);
  assert.deepEqual(results.unranked.map((item) => item.competitorId), ["C-1", "C-2"]);
});
