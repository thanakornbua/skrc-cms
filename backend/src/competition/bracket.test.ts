import assert from "node:assert/strict";
import test from "node:test";
import { addFinals, addSemifinals, drawBrackets, publicizeBrackets, settleRound } from "./bracket.js";
import type { CategoryStageResults, CompetitionStage, StageRankedResult } from "./types.js";

function results(stage: CompetitionStage, ids: string[]): CategoryStageResults {
  return {
    category: "Open",
    stage,
    scoringMode: "TIME_AVERAGE",
    ranked: ids.map((id, index): StageRankedResult => ({
      rank: index + 1,
      competitorId: id,
      teamName: `Team ${id}`,
      stage,
      scoringMode: "TIME_AVERAGE",
      completedLap: true,
      completedRunCount: 3,
      lapTimeMs: 10_000 + index,
      secondBestTimeMs: 11_000 + index,
      furthestCheckpoint: 0,
      aggregateTimeMs: 10_500 + index,
      penaltyTimeMs: 0,
      finalTimeMs: 10_500 + index,
      tieTimestamp: `2026-08-02T00:00:0${index}.000Z`,
    })),
    unranked: [],
    disqualified: [],
  };
}

test("qualifying rank selects eight teams but random draw determines bracket positions", () => {
  const qualifying = results("ROUND_1", ["A", "B", "C", "D", "E", "F", "G", "H"]);
  const bracket = drawBrackets([qualifying], "2026-08-02T00:00:00.000Z", "admin", () => 0)[0];
  assert.equal(bracket.positions.length, 8);
  assert.notDeepEqual(bracket.positions.map((item) => item.competitorId), qualifying.ranked.map((item) => item.competitorId));
  assert.deepEqual(bracket.matches.map((item) => item.matchId), ["QF1", "QF2", "QF3", "QF4"]);
});

test("match winners populate semifinals, final, and third-place match", () => {
  let bracket = drawBrackets([results("ROUND_1", ["A", "B", "C", "D", "E", "F", "G", "H"])], "2026-08-02T00:00:00.000Z", "admin", () => 0)[0];
  const positionIds = bracket.positions.map((item) => item.competitorId);
  bracket = addSemifinals(settleRound(bracket, "QUARTERFINAL", results("BEST_OF_4", positionIds), "2026-08-02T01:00:00.000Z"), () => 0);
  const semifinalists = bracket.matches.filter((item) => item.round === "SEMIFINAL").flatMap((item) => [item.teamAId, item.teamBId]);
  bracket = addFinals(settleRound(bracket, "SEMIFINAL", results("BEST_OF_2", semifinalists), "2026-08-02T02:00:00.000Z"), () => 0);
  assert.equal(bracket.matches.filter((item) => item.round === "FINAL").length, 1);
  assert.equal(bracket.matches.filter((item) => item.round === "THIRD_PLACE").length, 1);
});

test("public bracket strips competitor IDs and staff attribution", () => {
  const qualifying = results("ROUND_1", ["A", "B", "C", "D", "E", "F", "G", "H"]);
  const bracket = drawBrackets([qualifying], "2026-08-02T00:00:00.000Z", "admin-secret", () => 0)[0];
  const published = publicizeBrackets([bracket], { ROUND_1: [qualifying] });
  assert.equal(JSON.stringify(published).includes("competitorId"), false);
  assert.equal(JSON.stringify(published).includes("admin-secret"), false);
});
