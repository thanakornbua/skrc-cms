import type { CompetitorRecord } from "../competitors/types.js";
import type { AppliedPenalty, TimeCorrection } from "../timing/types.js";
import type { RunRecord } from "../runs/types.js";
import { STAGE_SCORING, type CategoryStageResults, type CompetitionStage, type StageRankedResult } from "./types.js";

export interface StageScoringInput {
  competitor: CompetitorRecord;
  runs: RunRecord[];
  corrections: TimeCorrection[];
  penalties: AppliedPenalty[];
}
const runStage = (run: RunRecord): CompetitionStage => run.stage ?? "ROUND_1";
const correctionStage = (correction: TimeCorrection): CompetitionStage => correction.stage ?? "ROUND_1";
const penaltyStage = (penalty: AppliedPenalty): CompetitionStage => penalty.stage ?? "ROUND_1";

function stagePenalty(input: StageScoringInput, stage: CompetitionStage): number {
  return input.penalties
    .filter((item) => penaltyStage(item) === stage && !item.revocation)
    .reduce((sum, item) => sum + item.penaltyMs, 0);
}

function scoredRuns(input: StageScoringInput, stage: CompetitionStage) {
  const corrections = new Map(input.corrections.filter((item) => correctionStage(item) === stage).map((item) => [item.runId, item]));
  return input.runs.filter((run) => runStage(run) === stage).map((run) => {
    const correction = corrections.get(run.runId);
    const elapsedMs = correction?.elapsedMs ?? (run.status === "COMPLETE" ? run.elapsedMs : null);
    const uniqueCheckpoints = new Set((run.splits ?? []).map((split) => split.gateId)).size;
    return { run, elapsedMs, uniqueCheckpoints };
  });
}

export function scoreCompetitorStage(input: StageScoringInput, stage: CompetitionStage): Omit<StageRankedResult, "rank"> | null {
  const attempts = scoredRuns(input, stage);
  if (attempts.length === 0) return null;
  const penaltyTimeMs = stagePenalty(input, stage);
  const mode = STAGE_SCORING[stage];

  if (mode === "CHECKPOINT_LAP") {
    const laps = attempts
      .filter((item): item is typeof item & { elapsedMs: number } => typeof item.elapsedMs === "number")
      .sort((a, b) => a.elapsedMs - b.elapsedMs || a.run.createdAt.localeCompare(b.run.createdAt));
    const bestLap = laps[0];
    const furthest = Math.max(0, ...attempts.map((item) => item.uniqueCheckpoints));
    const furthestAt = attempts
      .filter((item) => item.uniqueCheckpoints === furthest)
      .map((item) => item.run.createdAt)
      .sort()[0] ?? null;
    const finalTimeMs = bestLap ? bestLap.elapsedMs + penaltyTimeMs : null;
    return {
      teamName: input.competitor.teamName, competitorId: input.competitor.competitorId,
      stage, scoringMode: mode, completedLap: Boolean(bestLap),
      lapTimeMs: bestLap?.elapsedMs ?? null, furthestCheckpoint: furthest,
      aggregateTimeMs: bestLap?.elapsedMs ?? null, penaltyTimeMs, finalTimeMs,
      tieTimestamp: bestLap?.run.createdAt ?? furthestAt,
    };
  }

  const valid = attempts
    .filter((item): item is typeof item & { elapsedMs: number } => typeof item.elapsedMs === "number")
    .sort((a, b) => a.elapsedMs - b.elapsedMs || a.run.createdAt.localeCompare(b.run.createdAt));
  if (valid.length === 0) return null;
  const best = valid.slice(0, 2);
  const aggregateTimeMs = best.reduce((sum, item) => sum + item.elapsedMs, 0) / best.length;
  return {
    teamName: input.competitor.teamName, competitorId: input.competitor.competitorId,
    stage, scoringMode: mode, completedLap: true,
    lapTimeMs: best[0].elapsedMs, furthestCheckpoint: 0,
    aggregateTimeMs, penaltyTimeMs, finalTimeMs: aggregateTimeMs + penaltyTimeMs,
    tieTimestamp: best[0].run.createdAt,
  };
}

export function rankStageCategory(inputs: StageScoringInput[], stage: CompetitionStage, includeInternalIds: boolean): CategoryStageResults[] {
  const categories = [...new Set(inputs.map((item) => item.competitor.category))].sort();
  return categories.map((category) => {
    const entries = inputs.filter((item) => item.competitor.category === category);
    const scored = entries
      .filter((item) => !item.competitor.disqualified.bool)
      .map((item) => ({ input: item, result: scoreCompetitorStage(item, stage) }));
    const rankable = scored.filter((item): item is typeof item & { result: NonNullable<typeof item.result> } => item.result !== null);
    rankable.sort((a, b) => {
      if (stage === "ROUND_1" || stage === "BEST_OF_4") {
        if (a.result.completedLap !== b.result.completedLap) return a.result.completedLap ? -1 : 1;
        if (!a.result.completedLap) {
          return b.result.furthestCheckpoint - a.result.furthestCheckpoint ||
            (a.result.tieTimestamp ?? "").localeCompare(b.result.tieTimestamp ?? "") ||
            a.input.competitor.competitorId.localeCompare(b.input.competitor.competitorId);
        }
      }
      return a.result.finalTimeMs! - b.result.finalTimeMs! ||
        (a.result.tieTimestamp ?? "").localeCompare(b.result.tieTimestamp ?? "") ||
        a.input.competitor.competitorId.localeCompare(b.input.competitor.competitorId);
    });
    return {
      category, stage, scoringMode: STAGE_SCORING[stage],
      ranked: rankable.map(({ result }, index) => ({
        ...result, rank: index + 1,
        ...(!includeInternalIds ? { competitorId: undefined } : {}),
      })),
      unranked: scored.filter((item) => item.result === null).map(({ input }) => ({
        teamName: input.competitor.teamName,
        ...(includeInternalIds ? { competitorId: input.competitor.competitorId } : {}),
      })),
      disqualified: entries.filter((item) => item.competitor.disqualified.bool).map((item) => ({
        teamName: item.competitor.teamName,
        ...(includeInternalIds ? { competitorId: item.competitor.competitorId } : {}),
      })),
    };
  });
}
