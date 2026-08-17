import { randomInt } from "node:crypto";
import { ApiError } from "../errors.js";
import type {
  BracketMatch,
  BracketRound,
  CategoryStageResults,
  CompetitionBracket,
  CompetitionStage,
  StageRankedResult,
} from "./types.js";

type RandomIndex = (upperExclusive: number) => number;

function match(
  matchId: string,
  round: BracketRound,
  order: number,
  teamAId: string,
  teamBId: string,
  random: RandomIndex,
): BracketMatch {
  return {
    matchId,
    round,
    order,
    teamAId,
    teamBId,
    startsFirstId: random(2) === 0 ? teamAId : teamBId,
    winnerId: null,
    completedAt: null,
  };
}

export function drawBrackets(
  qualifying: CategoryStageResults[],
  drawnAt: string,
  drawnBy: string,
  random: RandomIndex = randomInt,
): CompetitionBracket[] {
  return qualifying.map((category) => {
    const qualified = category.ranked.slice(0, 8);
    if (qualified.length !== 8 || qualified.some((item) => !item.competitorId)) {
      throw new ApiError(409, "CONFLICT", `${category.category} requires eight ranked teams before drawing the bracket`);
    }
    const shuffled = [...qualified];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swap = random(index + 1);
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    const positions = shuffled.map((item, index) => ({
      position: index + 1,
      competitorId: item.competitorId!,
      teamName: item.teamName,
    }));
    const matches = Array.from({ length: 4 }, (_, index) => match(
      `QF${index + 1}`,
      "QUARTERFINAL",
      index + 1,
      positions[index * 2].competitorId,
      positions[index * 2 + 1].competitorId,
      random,
    ));
    return { category: category.category, drawnAt, drawnBy, positions, matches };
  });
}

/**
 * Whether a Final or third-place match is still level after Rule 6.5(a)-(c),
 * which is the precondition for sudden death under 6.6(1). Rule 6.5(2)
 * withholds the administrative registration-time tiebreak from these two
 * matches, so a tie here has no other way to resolve itself.
 */
export function matchIsTied(matchItem: BracketMatch, result: CategoryStageResults): boolean {
  if (matchItem.round !== "FINAL" && matchItem.round !== "THIRD_PLACE") return false;
  const byId = new Map(result.ranked.map((item) => [item.competitorId, item]));
  const aResult = byId.get(matchItem.teamAId);
  const bResult = byId.get(matchItem.teamBId);
  if (!aResult || !bResult) return false;
  return Math.min(aResult.completedRunCount, 2) === Math.min(bResult.completedRunCount, 2)
    && aResult.finalTimeMs === bResult.finalTimeMs
    && aResult.lapTimeMs === bResult.lapTimeMs
    && aResult.secondBestTimeMs === bResult.secondBestTimeMs
    && aResult.penaltyTimeMs === bResult.penaltyTimeMs;
}

/**
 * One team's sudden-death attempt. `chargedMs` is the attempt's own elapsed
 * time plus only those penalties tagged to that run — per the operator's
 * 2026-08-17 decision, a sudden-death penalty decides the head-to-head and
 * never joins the stage total, which Rule 6.6(3) keeps intact separately.
 */
export interface SuddenDeathAttempt {
  competitorId: string;
  completed: boolean;
  chargedMs: number;
}

/**
 * Rule 6.6(4)-(5). A finisher beats a team that took the stage maximum; two
 * finishers are separated by time; anything else — two maximums, or an exact
 * dead heat — returns null, which means another round is required.
 */
export function suddenDeathWinner(a: SuddenDeathAttempt, b: SuddenDeathAttempt): string | null {
  if (a.completed !== b.completed) return a.completed ? a.competitorId : b.competitorId;
  if (!a.completed) return null;
  if (a.chargedMs === b.chargedMs) return null;
  return a.chargedMs < b.chargedMs ? a.competitorId : b.competitorId;
}

function winnerFromResult(matchItem: BracketMatch, result: CategoryStageResults): string | null {
  if (matchIsTied(matchItem, result)) return null;
  const rank = new Map(result.ranked.map((item) => [item.competitorId, item.rank]));
  const a = rank.get(matchItem.teamAId);
  const b = rank.get(matchItem.teamBId);
  if (a !== undefined && b !== undefined) return a <= b ? matchItem.teamAId : matchItem.teamBId;
  if (a !== undefined) return matchItem.teamAId;
  if (b !== undefined) return matchItem.teamBId;
  return null;
}

/**
 * Resolves a tied Final / third-place match from whatever sudden-death rounds
 * have actually been run, returning null while the tie still stands.
 */
export type SuddenDeathResolver = (matchItem: BracketMatch) => string | null;

export function settleRound(
  bracket: CompetitionBracket,
  round: BracketRound,
  result: CategoryStageResults,
  completedAt: string,
  resolveSuddenDeath: SuddenDeathResolver = () => null,
): CompetitionBracket {
  const matches = bracket.matches.map((item) => {
    if (item.round !== round || item.winnerId) return item;
    // Rule 6.6(6): an administrative decision stands in for a result that could
    // not be produced on the track, so it outranks a still-tied comparison.
    const winnerId = item.administrativeDecision?.winnerId
      ?? winnerFromResult(item, result)
      ?? resolveSuddenDeath(item);
    if (!winnerId) {
      throw new ApiError(409, "CONFLICT",
        `${item.matchId} is tied; open a sudden-death round (Rule 6.6) before concluding`);
    }
    return { ...item, winnerId, completedAt };
  });
  return { ...bracket, matches };
}

export function addSemifinals(
  bracket: CompetitionBracket,
  random: RandomIndex = randomInt,
): CompetitionBracket {
  const qf = bracket.matches.filter((item) => item.round === "QUARTERFINAL").sort((a, b) => a.order - b.order);
  if (qf.length !== 4 || qf.some((item) => !item.winnerId)) throw new ApiError(409, "CONFLICT", "All quarterfinals must be complete");
  const semifinals = [
    match("SF1", "SEMIFINAL", 1, qf[0].winnerId!, qf[1].winnerId!, random),
    match("SF2", "SEMIFINAL", 2, qf[2].winnerId!, qf[3].winnerId!, random),
  ];
  return { ...bracket, matches: [...bracket.matches, ...semifinals] };
}

export function addFinals(
  bracket: CompetitionBracket,
  random: RandomIndex = randomInt,
): CompetitionBracket {
  const sf = bracket.matches.filter((item) => item.round === "SEMIFINAL").sort((a, b) => a.order - b.order);
  if (sf.length !== 2 || sf.some((item) => !item.winnerId)) throw new ApiError(409, "CONFLICT", "Both semifinals must be complete");
  const winners = sf.map((item) => item.winnerId!);
  const losers = sf.map((item) => item.winnerId === item.teamAId ? item.teamBId : item.teamAId);
  return {
    ...bracket,
    matches: [
      ...bracket.matches,
      match("F", "FINAL", 1, winners[0], winners[1], random),
      match("3P", "THIRD_PLACE", 1, losers[0], losers[1], random),
    ],
  };
}

const stageForRound: Record<BracketRound, CompetitionStage> = {
  QUARTERFINAL: "BEST_OF_4",
  SEMIFINAL: "BEST_OF_2",
  FINAL: "THE_BEST",
  THIRD_PLACE: "THE_BEST",
};

export interface PublicBracket {
  category: string;
  drawnAt: string;
  positions: Array<{ position: number; teamName: string }>;
  matches: Array<{
    matchId: string;
    round: BracketRound;
    order: number;
    teamA: { teamName: string; finalTimeMs: number | null };
    teamB: { teamName: string; finalTimeMs: number | null };
    startsFirst: string;
    winnerTeamName: string | null;
    status: "PENDING" | "COMPLETE";
    /** Rule 10.1(2) allows match progress publicly; team names only, never IDs. */
    suddenDeath: Array<{ round: number; startsFirst: string; openedAt: string }>;
    settledAdministratively: boolean;
  }>;
}

function resultFor(
  results: Partial<Record<CompetitionStage, CategoryStageResults[]>>,
  stage: CompetitionStage,
  category: string,
  competitorId: string,
): StageRankedResult | undefined {
  return results[stage]?.find((item) => item.category === category)?.ranked.find((item) => item.competitorId === competitorId);
}

export function publicizeBrackets(
  brackets: CompetitionBracket[] | undefined,
  results: Partial<Record<CompetitionStage, CategoryStageResults[]>>,
): PublicBracket[] {
  return (brackets ?? []).map((bracket) => {
    const names = new Map(bracket.positions.map((item) => [item.competitorId, item.teamName]));
    return {
      category: bracket.category,
      drawnAt: bracket.drawnAt,
      positions: bracket.positions.map(({ position, teamName }) => ({ position, teamName })),
      matches: bracket.matches.map((item) => {
        const stage = stageForRound[item.round];
        return {
          matchId: item.matchId,
          round: item.round,
          order: item.order,
          teamA: { teamName: names.get(item.teamAId) ?? "—", finalTimeMs: resultFor(results, stage, bracket.category, item.teamAId)?.finalTimeMs ?? null },
          teamB: { teamName: names.get(item.teamBId) ?? "—", finalTimeMs: resultFor(results, stage, bracket.category, item.teamBId)?.finalTimeMs ?? null },
          startsFirst: names.get(item.startsFirstId) ?? "—",
          winnerTeamName: item.winnerId ? names.get(item.winnerId) ?? null : null,
          status: item.winnerId ? "COMPLETE" : "PENDING",
          suddenDeath: (item.suddenDeath ?? []).map((round) => ({
            round: round.round,
            startsFirst: names.get(round.startsFirstId) ?? "—",
            openedAt: round.openedAt,
          })),
          settledAdministratively: Boolean(item.administrativeDecision),
        };
      }),
    };
  });
}
