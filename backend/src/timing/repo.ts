import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import { ApiError } from "../errors.js";
import { getCompetitor } from "../competitors/repo.js";
import { listRuns } from "../runs/repo.js";
import type { RunRecord } from "../runs/types.js";
import type { AppliedPenalty, CategoryTiming, PenaltyRule, TimeCorrection, TimeResult } from "./types.js";

const categoryKey = (category: string) => ({ PK: `CONFIG#CATEGORY#${category}`, SK: "PROFILE" });
const ruleKey = (ruleId: string) => ({ PK: `CONFIG#PENALTY#${ruleId}`, SK: "PROFILE" });
const runKey = (competitorId: string, runId: string) => ({ PK: `COMP#${competitorId}`, SK: `RUN#${runId}` });
const correctionKey = (competitorId: string, runId: string) => ({ PK: `COMP#${competitorId}`, SK: `CORRECTION#${runId}` });

export async function getCategoryTiming(category: string): Promise<CategoryTiming | null> {
  const result = await ddbDoc.send(new GetCommand({ TableName: TABLE_NAME, Key: categoryKey(category), ConsistentRead: true }));
  return (result.Item as CategoryTiming | undefined) ?? null;
}

export async function listCategoryTimings(): Promise<CategoryTiming[]> {
  const result = await ddbDoc.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: "begins_with(PK, :prefix) AND SK = :profile",
    ExpressionAttributeValues: { ":prefix": "CONFIG#CATEGORY#", ":profile": "PROFILE" },
  }));
  return ((result.Items ?? []) as CategoryTiming[]).sort((a, b) => a.category.localeCompare(b.category));
}

export async function putCategoryTiming(category: string, minTimeMs: number, maxTimeMs: number, byUser: string): Promise<CategoryTiming> {
  const item: CategoryTiming & { PK: string; SK: string } = {
    ...categoryKey(category), category, minTimeMs, maxTimeMs,
    updatedAt: new Date().toISOString(), updatedBy: byUser,
  };
  await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export async function listPenaltyRules(): Promise<PenaltyRule[]> {
  const result = await ddbDoc.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: "begins_with(PK, :prefix) AND SK = :profile",
    ExpressionAttributeValues: { ":prefix": "CONFIG#PENALTY#", ":profile": "PROFILE" },
  }));
  return ((result.Items ?? []) as PenaltyRule[]).sort((a, b) => a.label.localeCompare(b.label));
}

export async function createPenaltyRule(label: string, penaltyMs: number, byUser: string): Promise<PenaltyRule> {
  const ruleId = randomUUID();
  const item: PenaltyRule & { PK: string; SK: string } = {
    ...ruleKey(ruleId), ruleId, label, penaltyMs, active: true,
    updatedAt: new Date().toISOString(), updatedBy: byUser,
  };
  await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME, Item: item, ConditionExpression: "attribute_not_exists(PK)" }));
  return item;
}

export async function updatePenaltyRule(ruleId: string, input: { label: string; penaltyMs: number; active: boolean }, byUser: string): Promise<PenaltyRule> {
  const result = await ddbDoc.send(new UpdateCommand({
    TableName: TABLE_NAME, Key: ruleKey(ruleId),
    UpdateExpression: "SET label = :label, penaltyMs = :penalty, active = :active, updatedAt = :at, updatedBy = :by",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeValues: { ":label": input.label, ":penalty": input.penaltyMs, ":active": input.active, ":at": new Date().toISOString(), ":by": byUser },
    ReturnValues: "ALL_NEW",
  }));
  if (!result.Attributes) throw new ApiError(404, "NOT_FOUND", "Penalty rule not found");
  return result.Attributes as PenaltyRule;
}

export async function listAppliedPenalties(competitorId: string): Promise<AppliedPenalty[]> {
  const result = await ddbDoc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: { ":pk": `COMP#${competitorId}`, ":prefix": "PENALTY#" },
  }));
  return (result.Items ?? []) as AppliedPenalty[];
}

export async function applyPenalty(competitorId: string, ruleId: string, byUser: string): Promise<AppliedPenalty> {
  if (!(await getCompetitor(competitorId))) throw new ApiError(404, "NOT_FOUND", "Competitor not found");
  const result = await ddbDoc.send(new GetCommand({ TableName: TABLE_NAME, Key: ruleKey(ruleId), ConsistentRead: true }));
  const rule = result.Item as PenaltyRule | undefined;
  if (!rule) throw new ApiError(404, "NOT_FOUND", "Penalty rule not found");
  if (!rule.active) throw new ApiError(409, "CONFLICT", "Penalty rule is inactive");
  const at = new Date().toISOString();
  const item: AppliedPenalty & { PK: string } = {
    PK: `COMP#${competitorId}`, SK: `PENALTY#${at}#${ruleId}`,
    ruleId, label: rule.label, penaltyMs: rule.penaltyMs, byUser, at,
  };
  try {
    await ddbDoc.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: {
        TableName: TABLE_NAME, Key: ruleKey(ruleId),
        ConditionExpression: "active = :active AND label = :label AND penaltyMs = :penalty",
        ExpressionAttributeValues: { ":active": true, ":label": rule.label, ":penalty": rule.penaltyMs },
      } },
      { Put: {
        TableName: TABLE_NAME, Item: item,
        ConditionExpression: "attribute_not_exists(PK)",
      } },
    ] }));
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      throw new ApiError(409, "CONFLICT", "Penalty rule changed or became inactive; reload and try again");
    }
    throw error;
  }
  return item;
}

export async function revokePenalty(competitorId: string, penaltySk: string, reason: string, byUser: string): Promise<AppliedPenalty> {
  try {
    const result = await ddbDoc.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: { PK: `COMP#${competitorId}`, SK: penaltySk },
      UpdateExpression: "SET revocation = :revocation",
      ConditionExpression:
        "attribute_exists(PK) AND begins_with(SK, :penaltyPrefix) AND attribute_not_exists(revocation)",
      ExpressionAttributeValues: {
        ":penaltyPrefix": "PENALTY#",
        ":revocation": { reason, byUser, at: new Date().toISOString() },
      },
      ReturnValues: "ALL_NEW",
    }));
    return result.Attributes as AppliedPenalty;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new ApiError(409, "CONFLICT", "Applied penalty was not found or is already revoked");
    }
    throw error;
  }
}

export async function getCorrection(competitorId: string, runId: string): Promise<TimeCorrection | null> {
  const result = await ddbDoc.send(new GetCommand({ TableName: TABLE_NAME, Key: correctionKey(competitorId, runId), ConsistentRead: true }));
  return (result.Item as TimeCorrection | undefined) ?? null;
}

export async function listCorrections(competitorId: string): Promise<TimeCorrection[]> {
  const result = await ddbDoc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: { ":pk": `COMP#${competitorId}`, ":prefix": "CORRECTION#" },
  }));
  return (result.Items ?? []) as TimeCorrection[];
}

export async function correctRun(competitorId: string, runId: string, elapsedMs: number, reason: string, byUser: string): Promise<TimeCorrection> {
  const result = await ddbDoc.send(new GetCommand({ TableName: TABLE_NAME, Key: runKey(competitorId, runId), ConsistentRead: true }));
  const run = result.Item as RunRecord | undefined;
  if (!run) throw new ApiError(404, "NOT_FOUND", "Run not found");
  if (run.status !== "UNDER_REVIEW" && run.status !== "TIMED_OUT") throw new ApiError(409, "CONFLICT", "Only under-review or timed-out runs can be corrected");
  if (typeof run.minTimeMs !== "number" || typeof run.maxTimeMs !== "number" || elapsedMs < run.minTimeMs || elapsedMs > run.maxTimeMs) {
    throw new ApiError(400, "VALIDATION_ERROR", "Corrected time must be within the run's snapshotted limits");
  }
  const item: TimeCorrection & { PK: string; SK: string } = {
    ...correctionKey(competitorId, runId), runId, elapsedMs, reason, byUser, at: new Date().toISOString(),
  };
  try {
    await ddbDoc.send(new TransactWriteCommand({ TransactItems: [
      { Put: {
        TableName: TABLE_NAME, Item: item,
        ConditionExpression: "attribute_not_exists(PK)",
      } },
      { Update: {
        TableName: TABLE_NAME, Key: runKey(competitorId, runId),
        UpdateExpression: "SET reviewResolution = :resolution, reviewedAt = :at, reviewedBy = :by",
        ConditionExpression:
          "(#status = :underReview OR #status = :timedOut) AND attribute_not_exists(reviewResolution)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":underReview": "UNDER_REVIEW", ":timedOut": "TIMED_OUT",
          ":resolution": "CORRECTED", ":at": item.at, ":by": byUser,
        },
      } },
    ] }));
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      throw new ApiError(409, "CONFLICT", "Run was already corrected or resolved");
    }
    throw error;
  }
  const competitor = await getCompetitor(competitorId);
  if (competitor?.status === "INSPECTED") {
    try {
      await ddbDoc.send(new UpdateCommand({
        TableName: TABLE_NAME, Key: { PK: `COMP#${competitorId}`, SK: "PROFILE" },
        UpdateExpression: "SET #status = :complete, GSI1SK = :gsi",
        ConditionExpression: "#status = :inspected",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":complete": "RUN_COMPLETE", ":inspected": "INSPECTED",
          ":gsi": `${competitor.category}#RUN_COMPLETE#${competitorId}`,
        },
      }));
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    }
  }
  return item;
}

export async function resolveUnderReview(competitorId: string, runId: string, decision: "consume" | "void", reason: string, byUser: string): Promise<void> {
  try {
    await ddbDoc.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: {
        TableName: TABLE_NAME, Key: correctionKey(competitorId, runId),
        ConditionExpression: "attribute_not_exists(PK)",
      } },
      { Update: {
        TableName: TABLE_NAME, Key: runKey(competitorId, runId),
        UpdateExpression: "SET #status = :status, reviewResolution = :resolution, reviewReason = :reason, reviewedAt = :at, reviewedBy = :by",
        ConditionExpression: "#status = :underReview AND attribute_not_exists(reviewResolution)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": decision === "consume" ? "INVALID" : "VOID", ":resolution": decision.toUpperCase(),
          ":reason": reason, ":at": new Date().toISOString(), ":by": byUser, ":underReview": "UNDER_REVIEW",
        },
      } },
    ] }));
  } catch (error) {
    if (error instanceof TransactionCanceledException) throw new ApiError(409, "CONFLICT", "Run is not awaiting review");
    throw error;
  }
}

export async function getAttemptState(competitorId: string): Promise<{ consumed: number; unresolved: RunRecord | null }> {
  const [runs, corrections] = await Promise.all([listRuns(competitorId), listCorrections(competitorId)]);
  const corrected = new Set(corrections.map((item) => item.runId));
  const unresolved = runs.find((run) => run.status === "UNDER_REVIEW" && !corrected.has(run.runId)) ?? null;
  const consumed = runs.filter((run) =>
    run.status === "COMPLETE" || run.status === "TIMED_OUT" || run.status === "INVALID" || corrected.has(run.runId)
  ).length;
  return { consumed, unresolved };
}

export async function calculateTimeResult(competitorId: string): Promise<TimeResult> {
  const [runs, corrections, penalties] = await Promise.all([
    listRuns(competitorId), listCorrections(competitorId), listAppliedPenalties(competitorId),
  ]);
  const correctionByRun = new Map(corrections.map((item) => [item.runId, item]));
  const qualifying = runs.flatMap((run) => {
    const correction = correctionByRun.get(run.runId);
    const elapsedMs = correction?.elapsedMs ?? (run.status === "COMPLETE" ? run.elapsedMs : null);
    return typeof elapsedMs === "number" ? [{ runId: run.runId, elapsedMs, createdAt: run.createdAt }] : [];
  }).sort((a, b) => a.elapsedMs - b.elapsedMs || a.createdAt.localeCompare(b.createdAt));
  const best = qualifying.slice(0, 2);
  const aggregateTimeMs = best.length ? best.reduce((sum, item) => sum + item.elapsedMs, 0) / best.length : null;
  const penaltyTimeMs = penalties.filter((item) => !item.revocation).reduce((sum, item) => sum + item.penaltyMs, 0);
  return {
    aggregateTimeMs, penaltyTimeMs,
    finalTimeMs: aggregateTimeMs === null ? null : aggregateTimeMs + penaltyTimeMs,
    qualifyingRunIds: best.map((item) => item.runId),
    tieTimestamp: qualifying[0]?.createdAt ?? null,
  };
}
