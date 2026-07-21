import assert from "node:assert/strict";
import test from "node:test";
import { consumedStageBudgetMs } from "./budget.js";
import type { RunRecord } from "../runs/types.js";
import type { TimeCorrection } from "./types.js";

function run(id: string, overrides: Partial<RunRecord>): RunRecord {
  return {
    PK: "COMP#c-1", SK: `RUN#${id}`, runId: id, laneId: "1",
    startDeviceTs: 0, stopDeviceTs: null, elapsedMs: null, splits: [], debounce: {},
    minTimeMs: 0, maxTimeMs: 180000, createdAt: "2026-01-01T00:00:00.000Z",
    stage: "ROUND_1", ...overrides,
  };
}

function correction(runId: string, elapsedMs: number, stage: TimeCorrection["stage"] = "ROUND_1"): TimeCorrection {
  return { runId, elapsedMs, reason: "test", byUser: "admin", at: "2026-01-01T00:00:01.000Z", stage };
}

test("charges a COMPLETE run at its elapsed time", () => {
  const runs = [run("1", { status: "COMPLETE", elapsedMs: 50000 })];
  assert.equal(consumedStageBudgetMs(runs, [], "ROUND_1"), 50000);
});

test("charges a TIMED_OUT run at maxTimeMs, capping an over-limit elapsed", () => {
  const runs = [run("1", { status: "TIMED_OUT", elapsedMs: 200000, maxTimeMs: 180000 })];
  assert.equal(consumedStageBudgetMs(runs, [], "ROUND_1"), 180000);
});

test("charges an INVALID run at maxTimeMs when it has no elapsed time", () => {
  const runs = [run("1", { status: "INVALID", elapsedMs: null, maxTimeMs: 180000 })];
  assert.equal(consumedStageBudgetMs(runs, [], "ROUND_1"), 180000);
});

test("charges a corrected run at the correction's elapsed time, not the raw run elapsed", () => {
  const runs = [run("1", { status: "UNDER_REVIEW", elapsedMs: null })];
  const corrections = [correction("1", 45000)];
  assert.equal(consumedStageBudgetMs(runs, corrections, "ROUND_1"), 45000);
});

test("ignores runs from a different stage", () => {
  const runs = [run("1", { status: "COMPLETE", elapsedMs: 50000, stage: "BEST_OF_4" })];
  assert.equal(consumedStageBudgetMs(runs, [], "ROUND_1"), 0);
});

test("does not charge an uncorrected RUNNING or UNDER_REVIEW run", () => {
  const runs = [
    run("1", { status: undefined, elapsedMs: null }),
    run("2", { status: "UNDER_REVIEW", elapsedMs: null }),
  ];
  assert.equal(consumedStageBudgetMs(runs, [], "ROUND_1"), 0);
});
