import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { BatchWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import { ApiError } from "../errors.js";
import type { CompetitorRecord } from "../competitors/types.js";
import { listRuns } from "../runs/repo.js";
import { listAppliedPenalties, listCorrections } from "../timing/repo.js";
import { rankStageCategory, type StageScoringInput } from "./scoring.js";
import { COMPETITION_STATE_KEY, getCompetitionState } from "./state.js";
import {
  ADVANCEMENT_COUNT, NEXT_STAGE, type CategoryStageResults, type CompetitionStage,
  type CompetitionState, type StageRankedResult,
} from "./types.js";

type BatchWriteRequests = NonNullable<NonNullable<BatchWriteCommandInput["RequestItems"]>[string]>;

export { getCompetitionState } from "./state.js";
export type { CategoryStageResults as CategoryResults, StageRankedResult as RankedResult } from "./types.js";

async function scanCompetitors(): Promise<CompetitorRecord[]> {
  const items: CompetitorRecord[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await ddbDoc.send(new ScanCommand({
      TableName: TABLE_NAME, FilterExpression: "GSI1PK = :type",
      ExpressionAttributeValues: { ":type": "COMPETITOR" }, ExclusiveStartKey,
    }));
    items.push(...((result.Items ?? []) as CompetitorRecord[]));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function scoringInputs(): Promise<StageScoringInput[]> {
  const competitors = await scanCompetitors();
  return Promise.all(competitors.map(async (competitor) => {
    const [runs, corrections, penalties] = await Promise.all([
      listRuns(competitor.competitorId), listCorrections(competitor.competitorId), listAppliedPenalties(competitor.competitorId),
    ]);
    return { competitor, runs, corrections, penalties };
  }));
}

async function assertStageSettled(stage: CompetitionStage, eligible?: string[]): Promise<void> {
  const allowed = eligible ? new Set(eligible) : null;
  const inputs = await scoringInputs();
  const unresolved = inputs.flatMap((input) => {
    const corrected = new Set(input.corrections.map((item) => item.runId));
    return input.runs
    .filter((run) => (run.stage ?? "ROUND_1") === stage && (!allowed || allowed.has(input.competitor.competitorId)))
    .filter((run) => run.status === undefined || (run.status === "UNDER_REVIEW" && !corrected.has(run.runId)))
    .map((run) => `${input.competitor.competitorId}/${run.runId}`);
  });
  if (unresolved.length) throw new ApiError(409, "CONFLICT", `Resolve active or under-review runs before advancing: ${unresolved.join(", ")}`);
}

function publicize(results: CategoryStageResults[]): CategoryStageResults[] {
  return results.map((category) => ({
    ...category,
    ranked: category.ranked.map(({ competitorId: _id, ...item }) => item),
    unranked: category.unranked.map(({ competitorId: _id, ...item }) => item),
    disqualified: category.disqualified.map(({ competitorId: _id, ...item }) => item),
  }));
}

export async function calculateStageRankings(
  stage?: CompetitionStage,
  includeInternalIds = false,
): Promise<CategoryStageResults[]> {
  const state = await getCompetitionState();
  const selectedStage = stage ?? state.activeStage;
  let inputs = await scoringInputs();
  if (selectedStage !== "ROUND_1") {
    const eligible = new Set(state.activeStage === selectedStage
      ? (state.eligibleCompetitorIds ?? [])
      : (state.stageResults?.[selectedStage]?.flatMap((category) => category.ranked.map((item) => item.competitorId).filter(Boolean) as string[]) ?? []));
    inputs = inputs.filter((item) => eligible.has(item.competitor.competitorId));
  }
  return rankStageCategory(inputs, selectedStage, includeInternalIds);
}

/** Compatibility name used by existing routes; now returns only the active stage. */
export async function calculateRankings(includeInternalIds = false): Promise<CategoryStageResults[]> {
  return calculateStageRankings(undefined, includeInternalIds);
}

async function putOpenState(previous: CompetitionState, next: CompetitionState): Promise<void> {
  try {
    await ddbDoc.send(new PutCommand({
      TableName: TABLE_NAME, Item: { ...COMPETITION_STATE_KEY, ...next },
      ConditionExpression: "attribute_not_exists(PK) OR (#phase = :open AND (activeStage = :stage OR attribute_not_exists(activeStage)))",
      ExpressionAttributeNames: { "#phase": "phase" },
      ExpressionAttributeValues: { ":open": "OPEN", ":stage": previous.activeStage },
    }));
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) throw new ApiError(409, "CONFLICT", "Competition stage changed; reload and try again");
    throw error;
  }
}

export async function advanceCompetitionStage(byUser: string): Promise<CompetitionState> {
  const state = await getCompetitionState();
  if (state.phase !== "OPEN") throw new ApiError(409, "COMPETITION_CONCLUDED", "Competition is concluded");
  const nextStage = NEXT_STAGE[state.activeStage];
  if (!nextStage) throw new ApiError(409, "CONFLICT", "The Best must be concluded, not advanced");
  await assertStageSettled(state.activeStage, state.activeStage === "ROUND_1" ? undefined : state.eligibleCompetitorIds);
  const current = await calculateStageRankings(state.activeStage, true);
  const advanceCount = ADVANCEMENT_COUNT[state.activeStage]!;
  const eligibleCompetitorIds = current.flatMap((category) =>
    category.ranked.slice(0, advanceCount).map((item) => item.competitorId!).filter(Boolean)
  );
  if (eligibleCompetitorIds.length === 0) throw new ApiError(409, "CONFLICT", "No ranked competitors can advance");
  const now = new Date().toISOString();
  const next: CompetitionState = {
    ...state, phase: "OPEN", activeStage: nextStage, eligibleCompetitorIds,
    stageResults: { ...(state.stageResults ?? {}), [state.activeStage]: current },
    updatedAt: now, updatedBy: byUser,
  };
  await putOpenState(state, next);
  return next;
}

export function assembleFinalResults(snapshots: Partial<Record<CompetitionStage, CategoryStageResults[]>>): CategoryStageResults[] {
  const round1 = snapshots.ROUND_1 ?? [];
  const best4 = snapshots.BEST_OF_4 ?? [];
  const best2 = snapshots.BEST_OF_2 ?? [];
  const finals = snapshots.THE_BEST ?? [];
  const categories = [...new Set([...round1, ...best4, ...best2, ...finals].map((item) => item.category))].sort();
  return categories.map((category) => {
    const r1 = round1.find((item) => item.category === category);
    const b4 = best4.find((item) => item.category === category);
    const b2 = best2.find((item) => item.category === category);
    const final = finals.find((item) => item.category === category);
    const finalists = new Set((b2?.ranked ?? []).slice(0, 2).map((item) => item.competitorId));
    const eliminatedAtBest2 = new Set((b2?.ranked ?? []).filter((item) => !finalists.has(item.competitorId)).map((item) => item.competitorId));
    const podium34 = (b4?.ranked ?? []).filter((item) => eliminatedAtBest2.has(item.competitorId)).slice(0, 2);
    const bottom = (b4?.ranked ?? []).slice(4, 8);
    const ordered: StageRankedResult[] = [
      ...(final?.ranked ?? []).slice(0, 2), podium34[0], podium34[1], ...bottom,
    ].filter((item): item is StageRankedResult => Boolean(item));
    return {
      category, stage: "THE_BEST", scoringMode: "TIME_AVERAGE",
      ranked: ordered.map((item, index) => ({ ...item, rank: index + 1 })),
      unranked: [...(final?.unranked ?? []), ...(b2?.unranked ?? [])],
      disqualified: [...(final?.disqualified ?? []), ...(b2?.disqualified ?? []), ...(b4?.disqualified ?? []), ...(r1?.disqualified ?? [])]
        .filter((item, index, all) => all.findIndex((other) => other.competitorId === item.competitorId) === index),
    };
  });
}

async function deleteRankingSnapshots(categories: string[]): Promise<void> {
  for (const category of categories) {
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const found = await ddbDoc.send(new QueryCommand({
        TableName: TABLE_NAME, KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `RANKING#${category}` }, ProjectionExpression: "PK, SK", ExclusiveStartKey,
      }));
      const keys = found.Items ?? [];
      for (let i = 0; i < keys.length; i += 25) {
        let pending: BatchWriteRequests = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
        do {
          const result = await ddbDoc.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: pending } }));
          pending = result.UnprocessedItems?.[TABLE_NAME] ?? [];
        } while (pending.length > 0);
      }
      ExclusiveStartKey = found.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  }
}

export async function getCompetitorRank(category: string, competitorId: string): Promise<number | null> {
  const state = await getCompetitionState();
  if (state.phase !== "CONCLUDED") return null;
  const result = await ddbDoc.send(new QueryCommand({
    TableName: TABLE_NAME, KeyConditionExpression: "PK = :pk AND begins_with(SK, :rank)",
    ExpressionAttributeValues: { ":pk": `RANKING#${category}`, ":rank": "RANK#" },
  }));
  const item = result.Items?.find((entry) => entry.competitorId === competitorId);
  return typeof item?.rank === "number" ? item.rank : null;
}

export async function concludeCompetition(byUser: string): Promise<{ phase: "CONCLUDED"; concludedAt: string; results: CategoryStageResults[] }> {
  const state = await getCompetitionState();
  if (state.phase === "CONCLUDED") throw new ApiError(409, "CONFLICT", "Competition is already concluded");
  if (state.activeStage !== "THE_BEST") throw new ApiError(409, "CONFLICT", "Competition can conclude only after reaching The Best");
  await assertStageSettled("THE_BEST", state.eligibleCompetitorIds);
  const current = await calculateStageRankings("THE_BEST", true);
  const snapshots = { ...(state.stageResults ?? {}), THE_BEST: current };
  const internalResults = assembleFinalResults(snapshots);
  const publicResults = publicize(internalResults);
  const concludedAt = new Date().toISOString();
  await putOpenState(state, {
    ...state, phase: "CONCLUDED", stageResults: snapshots, results: publicResults,
    concludedAt, concludedBy: byUser, updatedAt: concludedAt, updatedBy: byUser,
  });
  try {
    for (const category of internalResults) for (const item of category.ranked) {
      await ddbDoc.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: `RANKING#${category.category}`, SK: `RANK#${String(item.rank).padStart(4, "0")}`, ...item, concludedAt },
      }));
    }
  } catch (error) {
    await deleteRankingSnapshots(internalResults.map((item) => item.category));
    await ddbDoc.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: COMPETITION_STATE_KEY,
      UpdateExpression: "SET #phase = :open REMOVE concludedAt, concludedBy, results",
      ConditionExpression: "concludedAt = :at", ExpressionAttributeNames: { "#phase": "phase" },
      ExpressionAttributeValues: { ":open": "OPEN", ":at": concludedAt },
    }));
    throw error;
  }
  return { phase: "CONCLUDED", concludedAt, results: publicResults };
}

export async function reopenCompetition(): Promise<void> {
  const state = await getCompetitionState();
  await deleteRankingSnapshots(state.results?.map((item) => item.category) ?? []);
  await ddbDoc.send(new UpdateCommand({
    TableName: TABLE_NAME, Key: COMPETITION_STATE_KEY,
    UpdateExpression: "SET #phase = :open REMOVE concludedAt, concludedBy, results",
    ExpressionAttributeNames: { "#phase": "phase" }, ExpressionAttributeValues: { ":open": "OPEN" },
  }));
}
