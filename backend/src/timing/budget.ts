import type { CompetitionStage } from "../competition/types.js";
import type { RunRecord } from "../runs/types.js";
import type { TimeCorrection } from "./types.js";

/**
 * Rule 6.6(2) grants a sudden-death attempt on top of the three the stage
 * allows, so those runs are invisible to every attempt-budget calculation here.
 */
export const isStageAttempt = (run: RunRecord, stage: CompetitionStage): boolean =>
  (run.stage ?? "ROUND_1") === stage && run.suddenDeathRound === undefined;

/** Single source of truth for a competitor's consumed checkpoint-lap time budget in a stage. */
export function consumedStageBudgetMs(runs: RunRecord[], corrections: TimeCorrection[], stage: CompetitionStage): number {
  const stageRuns = runs.filter((run) => isStageAttempt(run, stage));
  const correctionByRun = new Map(corrections.filter((c) => (c.stage ?? "ROUND_1") === stage).map((c) => [c.runId, c]));
  const charged = stageRuns.filter((run) =>
    run.status === "COMPLETE" || run.status === "TIMED_OUT" || run.status === "INVALID" || correctionByRun.has(run.runId)
  );
  return charged.reduce((sum, run) => {
    const elapsed = correctionByRun.get(run.runId)?.elapsedMs ?? run.elapsedMs;
    return sum + (typeof elapsed === "number" ? Math.min(elapsed, run.maxTimeMs) : run.maxTimeMs);
  }, 0);
}

export function stageAttemptState(runs: RunRecord[], corrections: TimeCorrection[], stage: CompetitionStage): { consumed: number; unresolved: boolean } {
  const stageRuns = runs.filter((run) => isStageAttempt(run, stage));
  const corrected = new Set(corrections.filter((item) => (item.stage ?? "ROUND_1") === stage).map((item) => item.runId));
  return {
    consumed: stageRuns.filter((run) =>
      run.status === "COMPLETE" || run.status === "TIMED_OUT" || run.status === "INVALID" || corrected.has(run.runId)
    ).length,
    unresolved: stageRuns.some((run) => run.status === "UNDER_REVIEW" && !corrected.has(run.runId)),
  };
}
