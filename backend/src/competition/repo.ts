import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { BatchWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import { ApiError } from "../errors.js";
import type { CompetitorRecord } from "../competitors/types.js";
import { calculateTimeResult } from "../timing/repo.js";

const STATE_KEY = { PK: "CONFIG#COMPETITION", SK: "STATE" };
type BatchWriteRequests = NonNullable<NonNullable<BatchWriteCommandInput["RequestItems"]>[string]>;

export interface RankedResult {
  rank: number;
  teamName: string;
  aggregateTimeMs: number;
  penaltyTimeMs: number;
  finalTimeMs: number;
  competitorId?: string;
}

export interface CategoryResults {
  category: string;
  ranked: RankedResult[];
  disqualified: Array<{ teamName: string; competitorId?: string }>;
}

export async function getCompetitionState(): Promise<{ phase: "OPEN" | "CONCLUDED"; concludedAt?: string; results?: CategoryResults[] }> {
  const result = await ddbDoc.send(new GetCommand({ TableName: TABLE_NAME, Key: STATE_KEY, ConsistentRead: true }));
  return (result.Item as { phase: "OPEN" | "CONCLUDED"; concludedAt?: string; results?: CategoryResults[] } | undefined) ?? { phase: "OPEN" };
}

export async function getCompetitorRank(category: string, competitorId: string): Promise<number | null> {
  const state = await getCompetitionState();
  if (state.phase !== "CONCLUDED") return null;
  const result = await ddbDoc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :rank)",
    ExpressionAttributeValues: { ":pk": `RANKING#${category}`, ":rank": "RANK#" },
  }));
  const item = result.Items?.find((entry) => entry.competitorId === competitorId);
  return typeof item?.rank === "number" ? item.rank : null;
}

async function scanCompetitors(): Promise<CompetitorRecord[]> {
  const items: CompetitorRecord[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await ddbDoc.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "GSI1PK = :type",
      ExpressionAttributeValues: { ":type": "COMPETITOR" },
      ExclusiveStartKey,
    }));
    items.push(...((result.Items ?? []) as CompetitorRecord[]));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function deleteRankingSnapshots(categories: string[]): Promise<void> {
  for (const category of categories) {
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const found = await ddbDoc.send(new QueryCommand({
        TableName: TABLE_NAME, KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `RANKING#${category}` },
        ProjectionExpression: "PK, SK", ExclusiveStartKey,
      }));
      const keys = found.Items ?? [];
      for (let i = 0; i < keys.length; i += 25) {
        let pending: BatchWriteRequests = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
        do {
          const result = await ddbDoc.send(new BatchWriteCommand({
            RequestItems: { [TABLE_NAME]: pending },
          }));
          pending = result.UnprocessedItems?.[TABLE_NAME] ?? [];
        } while (pending.length > 0);
      }
      ExclusiveStartKey = found.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  }
}

export async function calculateRankings(includeInternalIds = false): Promise<CategoryResults[]> {
  const competitors = await scanCompetitors();
  const enriched = await Promise.all(competitors.map(async (competitor) => ({
    competitor,
    time: await calculateTimeResult(competitor.competitorId),
  })));
  const categories = [...new Set(competitors.map((item) => item.category))].sort();
  return categories.map((category) => {
    const categoryEntries = enriched.filter((item) => item.competitor.category === category);
    const rankable = categoryEntries
      .filter((item) => !item.competitor.disqualified.bool && item.time.finalTimeMs !== null)
      .sort((a, b) =>
        a.time.finalTimeMs! - b.time.finalTimeMs! ||
        (a.time.tieTimestamp ?? "").localeCompare(b.time.tieTimestamp ?? "") ||
        a.competitor.competitorId.localeCompare(b.competitor.competitorId)
      );
    return {
      category,
      ranked: rankable.map((item, index) => ({
        rank: index + 1,
        teamName: item.competitor.teamName,
        aggregateTimeMs: item.time.aggregateTimeMs!,
        penaltyTimeMs: item.time.penaltyTimeMs,
        finalTimeMs: item.time.finalTimeMs!,
        ...(includeInternalIds ? { competitorId: item.competitor.competitorId } : {}),
      })),
      disqualified: categoryEntries
        .filter((item) => item.competitor.disqualified.bool)
        .map((item) => ({ teamName: item.competitor.teamName, ...(includeInternalIds ? { competitorId: item.competitor.competitorId } : {}) })),
    };
  });
}

export async function concludeCompetition(byUser: string): Promise<{ phase: "CONCLUDED"; concludedAt: string; results: CategoryResults[] }> {
  const state = await getCompetitionState();
  if (state.phase === "CONCLUDED") throw new ApiError(409, "CONFLICT", "Competition is already concluded");
  const internalResults = await calculateRankings(true);
  const publicResults = internalResults.map((category) => ({
    ...category,
    ranked: category.ranked.map(({ competitorId: _competitorId, ...item }) => item),
    disqualified: category.disqualified.map(({ competitorId: _competitorId, ...item }) => item),
  }));
  const concludedAt = new Date().toISOString();
  try {
    await ddbDoc.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...STATE_KEY, phase: "CONCLUDED", concludedAt, concludedBy: byUser, results: publicResults },
      ConditionExpression: "attribute_not_exists(#phase) OR #phase = :open",
      ExpressionAttributeNames: { "#phase": "phase" },
      ExpressionAttributeValues: { ":open": "OPEN" },
    }));
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new ApiError(409, "CONFLICT", "Competition is already concluded");
    }
    throw error;
  }
  try {
    for (const category of internalResults) {
      for (const item of category.ranked) {
        await ddbDoc.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: { PK: `RANKING#${category.category}`, SK: `RANK#${String(item.rank).padStart(4, "0")}`, ...item, concludedAt },
        }));
      }
      for (const item of category.disqualified) {
        if (!item.competitorId) continue;
        await ddbDoc.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: { PK: `RANKING#${category.category}`, SK: `DQ#${item.competitorId}`, competitorId: item.competitorId, teamName: item.teamName, concludedAt },
        }));
      }
    }
  } catch (error) {
    // Do not leave a FINAL competition whose per-competitor rank snapshot is
    // incomplete. Keep mutations frozen while cleaning up, then reopen only
    // the conclusion attempt that this call created.
    await deleteRankingSnapshots(internalResults.map((item) => item.category));
    await ddbDoc.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: STATE_KEY,
      UpdateExpression: "SET #phase = :open REMOVE concludedAt, concludedBy, results",
      ConditionExpression: "concludedAt = :concludedAt",
      ExpressionAttributeNames: { "#phase": "phase" },
      ExpressionAttributeValues: { ":open": "OPEN", ":concludedAt": concludedAt },
    }));
    throw error;
  }
  return { phase: "CONCLUDED", concludedAt, results: publicResults };
}

export async function reopenCompetition(): Promise<void> {
  const state = await getCompetitionState();
  const categories = state.results?.map((item) => item.category) ?? [];
  await deleteRankingSnapshots(categories);
  await ddbDoc.send(new UpdateCommand({
    TableName: TABLE_NAME, Key: STATE_KEY,
    UpdateExpression: "SET phase = :open REMOVE concludedAt, concludedBy, results",
    ExpressionAttributeValues: { ":open": "OPEN" },
  }));
}
