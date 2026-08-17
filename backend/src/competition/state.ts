import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import type { BracketMatch, CompetitionState } from "./types.js";

export const COMPETITION_STATE_KEY = { PK: "CONFIG#COMPETITION", SK: "STATE" };

export async function getCompetitionState(): Promise<CompetitionState> {
  const result = await ddbDoc.send(new GetCommand({ TableName: TABLE_NAME, Key: COMPETITION_STATE_KEY, ConsistentRead: true }));
  const stored = result.Item as Partial<CompetitionState> | undefined;
  return {
    phase: stored?.phase ?? "OPEN",
    activeStage: stored?.activeStage ?? "ROUND_1",
    ...(stored ?? {}),
  } as CompetitionState;
}
export function isEligibleForStage(state: CompetitionState, competitorId: string): boolean {
  return state.activeStage === "ROUND_1" || (state.eligibleCompetitorIds ?? []).includes(competitorId);
}

/**
 * Every match a competitor appears in. A finalist is in a quarterfinal, a
 * semifinal and the Final at once, so callers that mean "the match being played
 * now" must say which — picking the first hit would always land on the
 * quarterfinal.
 */
export function matchesFor(state: CompetitionState, competitorId: string): BracketMatch[] {
  return (state.brackets ?? [])
    .flatMap((bracket) => bracket.matches)
    .filter((item) => item.teamAId === competitorId || item.teamBId === competitorId);
}

/**
 * The sudden-death round this competitor still owes a run for, or undefined.
 * Rule 6.6(2) grants exactly one attempt per team per round, so a round stops
 * being open for a team the moment that team has a run tagged with it — which
 * is also what stops a second START from being accepted.
 */
export function openSuddenDeathRound(
  state: CompetitionState,
  competitorId: string,
  runs: Array<{ suddenDeathRound?: number }>,
): number | undefined {
  const rounds = matchesFor(state, competitorId).flatMap((item) => item.suddenDeath ?? []);
  if (rounds.length === 0) return undefined;
  const latest = Math.max(...rounds.map((item) => item.round));
  return runs.some((run) => run.suddenDeathRound === latest) ? undefined : latest;
}
