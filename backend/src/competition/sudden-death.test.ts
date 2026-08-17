import assert from "node:assert/strict";
import test from "node:test";
import { matchIsTied, settleRound, suddenDeathWinner } from "./bracket.js";
import { rankStageCategory, scoreCompetitorStage } from "./scoring.js";
import { stageAttemptState } from "../timing/budget.js";
import { openSuddenDeathRound } from "./state.js";
import type { BracketMatch, CategoryStageResults, CompetitionBracket, CompetitionState, StageRankedResult } from "./types.js";
import type { RunRecord } from "../runs/types.js";
import type { CompetitorRecord } from "../competitors/types.js";
import type { AppliedPenalty } from "../timing/types.js";

/**
 * Rule 6.6 lives at the seam between three things: the tie must be detected,
 * the extra attempt must not be charged against the stage, and the head-to-head
 * must be decided without disturbing the Final's own average.
 */

function run(id: string, over: Partial<RunRecord> = {}): RunRecord {
  return {
    PK: "COMP#C-0001", SK: `RUN#${id}`, runId: id, laneId: "1",
    startDeviceTs: 0, stopDeviceTs: null, elapsedMs: null, splits: [], debounce: {},
    status: "COMPLETE", minTimeMs: 4999, maxTimeMs: 180000, stage: "THE_BEST",
    createdAt: "2026-01-01T00:00:00.000Z", ...over,
  };
}

function competitor(competitorId: string, createdAt = "2026-01-01T00:00:00.000Z"): CompetitorRecord {
  return {
    competitorId, teamName: `Team ${competitorId}`, category: "Open", createdAt,
    disqualified: { bool: false, reason: null, byUser: null, at: null },
  } as CompetitorRecord;
}

function ranked(competitorId: string, over: Partial<StageRankedResult> = {}): StageRankedResult {
  return {
    rank: 1, competitorId, teamName: `Team ${competitorId}`, stage: "THE_BEST", scoringMode: "TIME_AVERAGE",
    completedLap: true, completedRunCount: 2, lapTimeMs: 20000, secondBestTimeMs: 22000, furthestCheckpoint: 0,
    aggregateTimeMs: 21000, penaltyTimeMs: 0, finalTimeMs: 21000, tieTimestamp: "2026-01-01T00:00:00.000Z", ...over,
  };
}

const finalMatch: BracketMatch = {
  matchId: "F", round: "FINAL", order: 1, teamAId: "A", teamBId: "B",
  startsFirstId: "A", winnerId: null, completedAt: null,
};

function results(items: StageRankedResult[]): CategoryStageResults {
  return { category: "Open", stage: "THE_BEST", scoringMode: "TIME_AVERAGE", ranked: items, unranked: [], disqualified: [] };
}

const bracketWith = (match: BracketMatch): CompetitionBracket => ({
  category: "Open", drawnAt: "2026-01-01T00:00:00.000Z", drawnBy: "admin",
  positions: [{ position: 1, competitorId: "A", teamName: "Team A" }, { position: 2, competitorId: "B", teamName: "Team B" }],
  matches: [match],
});

test("Rule 6.6(4): a finisher beats a team that took the stage maximum", () => {
  assert.equal(
    suddenDeathWinner({ competitorId: "A", completed: false, chargedMs: 180000 }, { competitorId: "B", completed: true, chargedMs: 90000 }),
    "B",
  );
});

test("Rule 6.6(4): two finishers are separated by the lower time", () => {
  assert.equal(
    suddenDeathWinner({ competitorId: "A", completed: true, chargedMs: 19500 }, { competitorId: "B", completed: true, chargedMs: 19501 }),
    "A",
  );
});

test("Rule 6.6(5): two maximum times require another round rather than a winner", () => {
  assert.equal(
    suddenDeathWinner({ competitorId: "A", completed: false, chargedMs: 180000 }, { competitorId: "B", completed: false, chargedMs: 180000 }),
    null,
  );
});

test("a sudden-death penalty decides its own head-to-head", () => {
  // Identical raw times; A's five-second penalty on this attempt loses it.
  assert.equal(
    suddenDeathWinner({ competitorId: "A", completed: true, chargedMs: 25000 }, { competitorId: "B", completed: true, chargedMs: 20000 }),
    "B",
  );
});

test("a Final level through Rule 6.5(a)-(c) is tied, and a difference in penalties is not", () => {
  assert.equal(matchIsTied(finalMatch, results([ranked("A"), ranked("B")])), true);
  assert.equal(matchIsTied(finalMatch, results([ranked("A"), ranked("B", { penaltyTimeMs: 5000 })])), false);
});

test("a quarterfinal never goes to sudden death — Rule 6.5(2) limits it to the Final and third place", () => {
  const qf: BracketMatch = { ...finalMatch, matchId: "QF1", round: "QUARTERFINAL" };
  assert.equal(matchIsTied(qf, results([ranked("A"), ranked("B")])), false);
});

test("settleRound refuses to invent a winner while a Final is still tied", () => {
  assert.throws(
    () => settleRound(bracketWith(finalMatch), "FINAL", results([ranked("A"), ranked("B")]), "2026-01-02T00:00:00.000Z"),
    /tied/,
  );
});

test("settleRound takes the winner from a resolved sudden-death round", () => {
  const settled = settleRound(
    bracketWith({ ...finalMatch, suddenDeath: [{ round: 1, startsFirstId: "B", openedAt: "2026-01-02T00:00:00.000Z", openedBy: "admin" }] }),
    "FINAL", results([ranked("A"), ranked("B")]), "2026-01-02T00:10:00.000Z",
    () => "B",
  );
  assert.equal(settled.matches[0].winnerId, "B");
});

test("Rule 6.6(6): an administrative decision settles a match that cannot be run", () => {
  const settled = settleRound(
    bracketWith({
      ...finalMatch,
      administrativeDecision: { winnerId: "A", reason: "venue evacuated", byUser: "admin", at: "2026-01-02T00:00:00.000Z" },
    }),
    "FINAL", results([ranked("A"), ranked("B")]), "2026-01-02T00:10:00.000Z",
  );
  assert.equal(settled.matches[0].winnerId, "A");
});

test("Rule 6.6(2): the extra attempt is not charged against the stage's three", () => {
  const runs = [run("r1"), run("r2"), run("r3"), run("sd1", { suddenDeathRound: 1 })];
  assert.deepEqual(stageAttemptState(runs, [], "THE_BEST"), { consumed: 3, unresolved: false });
});

test("a sudden-death run never joins the stage average, nor does its penalty", () => {
  const penalties: AppliedPenalty[] = [{
    SK: "PENALTY#1", ruleId: "r", label: "Intervention", penaltyMs: 5000,
    byUser: "committee", at: "2026-01-02T00:00:00.000Z", stage: "THE_BEST", runId: "sd1",
  }];
  const result = scoreCompetitorStage({
    competitor: competitor("A"),
    runs: [run("r1", { elapsedMs: 20000 }), run("r2", { elapsedMs: 22000 }), run("r3", { elapsedMs: 30000 }),
      run("sd1", { suddenDeathRound: 1, elapsedMs: 1000 })],
    corrections: [], penalties,
  }, "THE_BEST");
  assert.ok(result);
  // Best two of the three stage attempts — the 1 s sudden-death run is invisible.
  assert.equal(result.aggregateTimeMs, 21000);
  assert.equal(result.penaltyTimeMs, 0);
  assert.equal(result.finalTimeMs, 21000);
});

test("an open round is found even though the finalist also appears in earlier matches", () => {
  // A finalist sits in a quarterfinal, a semifinal and the Final at once; only
  // the Final carries the sudden-death round, and that is the one that counts.
  const state: CompetitionState = {
    phase: "OPEN", activeStage: "THE_BEST",
    brackets: [{
      category: "Open", drawnAt: "2026-01-01T00:00:00.000Z", drawnBy: "admin",
      positions: [{ position: 1, competitorId: "A", teamName: "Team A" }, { position: 2, competitorId: "B", teamName: "Team B" }],
      matches: [
        { matchId: "QF1", round: "QUARTERFINAL", order: 1, teamAId: "A", teamBId: "X", startsFirstId: "A", winnerId: "A", completedAt: null },
        { matchId: "SF1", round: "SEMIFINAL", order: 1, teamAId: "A", teamBId: "Y", startsFirstId: "A", winnerId: "A", completedAt: null },
        { ...finalMatch, suddenDeath: [{ round: 1, startsFirstId: "B", openedAt: "2026-01-02T00:00:00.000Z", openedBy: "admin" }] },
      ],
    }],
  };
  assert.equal(openSuddenDeathRound(state, "A", []), 1);
  // One attempt per team per round: once the run exists, no second START.
  assert.equal(openSuddenDeathRound(state, "A", [{ suddenDeathRound: 1 }]), undefined);
  // A team that is not in the tied match gets nothing.
  assert.equal(openSuddenDeathRound(state, "X", []), undefined);
});

test("Rule 6.4(3): teams with no completed run are separated by final time, not by registration order", () => {
  const maxOut = (id: string) => [run(`${id}-1`, { status: "TIMED_OUT", stage: "ROUND_1" }), run(`${id}-2`, { status: "TIMED_OUT", stage: "ROUND_1" })];
  const penalty = (runId: string): AppliedPenalty => ({
    SK: `PENALTY#${runId}`, ruleId: "r", label: "Intervention", penaltyMs: 5000,
    byUser: "committee", at: "2026-01-01T00:00:00.000Z", stage: "ROUND_1", runId,
  });
  // "Early" registered first but carries a penalty, so it must rank behind "Late".
  const ranking = rankStageCategory([
    { competitor: competitor("early", "2026-01-01T00:00:00.000Z"), runs: maxOut("early"), corrections: [], penalties: [penalty("early-1")] },
    { competitor: competitor("late", "2026-01-01T09:00:00.000Z"), runs: maxOut("late"), corrections: [], penalties: [] },
  ], "ROUND_1", true);
  assert.deepEqual(ranking[0].ranked.map((item) => item.competitorId), ["late", "early"]);
});
