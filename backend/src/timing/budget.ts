import type { CompetitionStage } from "../competition/types.js";
import type { RunRecord } from "../runs/types.js";
import type { TimeCorrection } from "./types.js";

/** Single source of truth for a competitor's consumed checkpoint-lap time budget in a stage. */
export function consumedStageBudgetMs(runs: RunRecord[], corrections: TimeCorrection[], stage: CompetitionStage): number {
  const stageRuns = runs.filter((run) => (run.stage ?? "ROUND_1") === stage);
  const correctionByRun = new Map(corrections.filter((c) => (c.stage ?? "ROUND_1") === stage).map((c) => [c.runId, c]));
  const charged = stageRuns.filter((run) =>
    run.status === "COMPLETE" || run.status === "TIMED_OUT" || run.status === "INVALID" || correctionByRun.has(run.runId)
  );
  return charged.reduce((sum, run) => {
    const elapsed = correctionByRun.get(run.runId)?.elapsedMs ?? run.elapsedMs;
    return sum + (typeof elapsed === "number" ? Math.min(elapsed, run.maxTimeMs) : run.maxTimeMs);
  }, 0);
}
