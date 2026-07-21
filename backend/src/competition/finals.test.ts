import assert from "node:assert/strict";
import test from "node:test";
import { assembleFinalResults, getFrozenStageResult } from "./repo.js";
import type { CategoryStageResults, CompetitionStage, CompetitionState, StageRankedResult } from "./types.js";

function stage(stage: CompetitionStage, ids: string[]): CategoryStageResults {
  const mode = stage === "ROUND_1" || stage === "BEST_OF_4" ? "CHECKPOINT_LAP" : "TIME_AVERAGE";
  return {
    category: "Open", stage, scoringMode: mode, unranked: [], disqualified: [],
    ranked: ids.map((id, index): StageRankedResult => ({
      rank: index + 1, competitorId: id, teamName: id, stage, scoringMode: mode,
      completedLap: true, lapTimeMs: 1000 + index, furthestCheckpoint: 3,
      aggregateTimeMs: 1000 + index, penaltyTimeMs: 0, finalTimeMs: 1000 + index,
      tieTimestamp: `2026-01-01T00:00:0${index}.000Z`,
    })),
  };
}

test("final placements reuse Best of 4 order for third through eighth", () => {
  const results = assembleFinalResults({
    BEST_OF_4: [stage("BEST_OF_4", ["A", "B", "C", "D", "E", "F", "G", "H"])],
    // D outranks C here, but both are eliminated and must revert to Best-of-4 order.
    BEST_OF_2: [stage("BEST_OF_2", ["A", "B", "D", "C"])],
    THE_BEST: [stage("THE_BEST", ["B", "A"])],
  });
  assert.deepEqual(results[0].ranked.map((item) => item.competitorId), ["B", "A", "C", "D", "E", "F", "G", "H"]);
});

function stateWith(stageResults: CompetitionState["stageResults"]): CompetitionState {
  return { phase: "OPEN", activeStage: "THE_BEST", eligibleCompetitorIds: [], stageResults };
}

test("getFrozenStageResult returns the elimination stage for a competitor absent from later stages", () => {
  const state = stateWith({
    BEST_OF_4: [stage("BEST_OF_4", ["A", "B", "C", "D", "E", "F", "G", "H"])],
    BEST_OF_2: [stage("BEST_OF_2", ["A", "B"])],
    THE_BEST: [stage("THE_BEST", ["B", "A"])],
  });
  const found = getFrozenStageResult(state, "Open", "E");
  assert.equal(found?.stage, "BEST_OF_4");
  assert.equal(found?.rank, 5);
  assert.equal(found?.result?.competitorId, "E");
});

test("getFrozenStageResult returns null when the competitor never appears in any snapshot", () => {
  const state = stateWith({
    BEST_OF_4: [stage("BEST_OF_4", ["A", "B"])],
  });
  assert.equal(getFrozenStageResult(state, "Open", "Z"), null);
});

test("getFrozenStageResult returns a null result/rank when the competitor is only unranked", () => {
  const unrankedStage: CategoryStageResults = {
    category: "Open", stage: "BEST_OF_4", scoringMode: "CHECKPOINT_LAP",
    ranked: stage("BEST_OF_4", ["A", "B"]).ranked,
    unranked: [{ teamName: "No Show", competitorId: "N" }],
    disqualified: [],
  };
  const state = stateWith({ BEST_OF_4: [unrankedStage] });
  assert.deepEqual(getFrozenStageResult(state, "Open", "N"), { stage: "BEST_OF_4", result: null, rank: null });
});
