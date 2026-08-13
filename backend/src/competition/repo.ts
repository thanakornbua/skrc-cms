import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { BatchWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import { ApiError } from "../errors.js";
import type { CompetitorRecord } from "../competitors/types.js";
import { listRuns } from "../runs/repo.js";
import { listAppliedPenalties, listCorrections } from "../timing/repo.js";
import { rankStageCategory, type StageScoringInput } from "./scoring.js";
import { addFinals, addSemifinals, drawBrackets, settleRound } from "./bracket.js";
import { COMPETITION_STATE_KEY, getCompetitionState } from "./state.js";
import {
  COMPETITION_STAGES, NEXT_STAGE, type CategoryStageResults, type CompetitionBracket, type CompetitionStage,
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
  const incomplete = inputs
    .filter((input) => !allowed || allowed.has(input.competitor.competitorId))
    .filter((input) => !input.competitor.disqualified.bool)
    .map((input) => {
      const corrected = new Set(input.corrections.filter((item) => (item.stage ?? "ROUND_1") === stage).map((item) => item.runId));
      const consumed = input.runs.filter((run) => (run.stage ?? "ROUND_1") === stage).filter((run) =>
        run.status === "COMPLETE" || run.status === "TIMED_OUT" || run.status === "INVALID" || corrected.has(run.runId)
      ).length;
      return { competitorId: input.competitor.competitorId, consumed };
    })
    .filter((item) => item.consumed < 3);
  if (incomplete.length) {
    throw new ApiError(409, "CONFLICT", `Every eligible team requires three attempts: ${incomplete.map((item) => `${item.competitorId} (${item.consumed}/3)`).join(", ")}`);
  }
}

function publicize(results: CategoryStageResults[]): CategoryStageResults[] {
  return results.map((category) => ({
    ...category,
    ranked: category.ranked.map(({ competitorId: _id, ...item }) => item),
    unranked: category.unranked.map(({ competitorId: _id, ...item }) => item),
    disqualified: category.disqualified.map(({ competitorId: _id, ...item }) => item),
  }));
}

/** Highest completed stage a competitor appears in (ranked or unranked); that stage is their elimination point. */
export function getFrozenStageResult(
  state: CompetitionState,
  category: string,
  competitorId: string,
): { stage: CompetitionStage; result: StageRankedResult | null; rank: number | null } | null {
  for (const stage of [...COMPETITION_STAGES].reverse()) {
    const snapshot = state.stageResults?.[stage]?.find((item) => item.category === category);
    if (!snapshot) continue;
    const ranked = snapshot.ranked.find((item) => item.competitorId === competitorId);
    if (ranked) return { stage, result: ranked, rank: ranked.rank };
    if (snapshot.unranked.some((item) => item.competitorId === competitorId)) return { stage, result: null, rank: null };
  }
  return null;
}

export async function calculateStageRankings(
  stage?: CompetitionStage,
  includeInternalIds = false,
): Promise<CategoryStageResults[]> {
  const state = await getCompetitionState();
  const selectedStage = stage ?? state.activeStage;
  if (stage !== undefined && stage !== state.activeStage && stage !== "ROUND_1" && state.stageResults?.[stage]) {
    const stored = state.stageResults[stage]!;
    return includeInternalIds ? stored : publicize(stored);
  }
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
  const now = new Date().toISOString();
  let brackets: CompetitionBracket[];
  let eligibleCompetitorIds: string[];
  if (state.activeStage === "ROUND_1") {
    brackets = drawBrackets(current, now, byUser);
    eligibleCompetitorIds = brackets.flatMap((bracket) => bracket.positions.map((item) => item.competitorId));
  } else if (state.activeStage === "BEST_OF_4") {
    brackets = (state.brackets ?? []).map((bracket) => {
      const result = current.find((item) => item.category === bracket.category);
      if (!result) throw new ApiError(409, "CONFLICT", `${bracket.category} has no quarterfinal result`);
      return addSemifinals(settleRound(bracket, "QUARTERFINAL", result, now));
    });
    eligibleCompetitorIds = brackets.flatMap((bracket) => bracket.matches.filter((item) => item.round === "SEMIFINAL").flatMap((item) => [item.teamAId, item.teamBId]));
  } else {
    brackets = (state.brackets ?? []).map((bracket) => {
      const result = current.find((item) => item.category === bracket.category);
      if (!result) throw new ApiError(409, "CONFLICT", `${bracket.category} has no semifinal result`);
      return addFinals(settleRound(bracket, "SEMIFINAL", result, now));
    });
    eligibleCompetitorIds = brackets.flatMap((bracket) => bracket.matches.filter((item) => item.round === "FINAL" || item.round === "THIRD_PLACE").flatMap((item) => [item.teamAId, item.teamBId]));
  }
  if (eligibleCompetitorIds.length === 0) throw new ApiError(409, "CONFLICT", "No ranked competitors can advance");
  const next: CompetitionState = {
    ...state, phase: "OPEN", activeStage: nextStage, eligibleCompetitorIds,
    brackets,
    stageResults: { ...(state.stageResults ?? {}), [state.activeStage]: current },
    updatedAt: now, updatedBy: byUser,
  };
  await putOpenState(state, next);
  return next;
}

function bracketFinalResults(
  snapshots: Partial<Record<CompetitionStage, CategoryStageResults[]>>,
  brackets: CompetitionBracket[],
): CategoryStageResults[] {
  return brackets.map((bracket) => {
    const final = bracket.matches.find((item) => item.round === "FINAL");
    const third = bracket.matches.find((item) => item.round === "THIRD_PLACE");
    if (!final?.winnerId || !third?.winnerId) throw new ApiError(409, "CONFLICT", `${bracket.category} final matches are incomplete`);
    const finalLoser = final.winnerId === final.teamAId ? final.teamBId : final.teamAId;
    const thirdLoser = third.winnerId === third.teamAId ? third.teamBId : third.teamAId;
    const quarterfinalLosers = bracket.matches
      .filter((item) => item.round === "QUARTERFINAL")
      .map((item) => item.winnerId === item.teamAId ? item.teamBId : item.teamAId);
    const resultMap = new Map<string, StageRankedResult>();
    for (const stage of COMPETITION_STAGES) for (const categoryResult of snapshots[stage] ?? []) {
      if (categoryResult.category !== bracket.category) continue;
      for (const item of categoryResult.ranked) if (item.competitorId) resultMap.set(item.competitorId, item);
    }
    const qfRank = new Map((snapshots.BEST_OF_4?.find((item) => item.category === bracket.category)?.ranked ?? []).map((item) => [item.competitorId, item.rank]));
    quarterfinalLosers.sort((a, b) => (qfRank.get(a) ?? 999) - (qfRank.get(b) ?? 999));
    const orderedIds = [final.winnerId, finalLoser, third.winnerId, thirdLoser, ...quarterfinalLosers];
    const ranked = orderedIds.map((competitorId, index) => {
      const result = resultMap.get(competitorId);
      if (!result) throw new ApiError(409, "CONFLICT", `Missing result for ${competitorId}`);
      return { ...result, rank: index + 1 };
    });
    return { category: bracket.category, stage: "THE_BEST", scoringMode: "TIME_AVERAGE", ranked, unranked: [], disqualified: [] };
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
  const concludedAt = new Date().toISOString();
  const brackets = (state.brackets ?? []).map((bracket) => {
    const result = current.find((item) => item.category === bracket.category);
    if (!result) throw new ApiError(409, "CONFLICT", `${bracket.category} has no final result`);
    return settleRound(settleRound(bracket, "FINAL", result, concludedAt), "THIRD_PLACE", result, concludedAt);
  });
  const internalResults = bracketFinalResults(snapshots, brackets);
  const publicResults = publicize(internalResults);
  await putOpenState(state, {
    ...state, phase: "CONCLUDED", stageResults: snapshots, brackets, results: publicResults,
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
