import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import type { CompetitionState } from "./types.js";

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
