import assert from "node:assert/strict";
import test from "node:test";
import { assembleFinalResults } from "./repo.js";
import type { CategoryStageResults, CompetitionStage, StageRankedResult } from "./types.js";

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
