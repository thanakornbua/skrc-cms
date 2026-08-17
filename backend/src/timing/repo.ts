import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import { ApiError } from "../errors.js";
import { getCompetitionState } from "../competition/state.js";
import type { CompetitionStage } from "../competition/types.js";
import { getCompetitor } from "../competitors/repo.js";
import { endRunAtMaxTime, listRuns, recordForfeitedAttempt } from "../runs/repo.js";
import type { EndRunResolution, RunRecord } from "../runs/types.js";
import type { AppliedPenalty, CategoryTiming, PenaltyRule, TimeCorrection, TimeResult } from "./types.js";
import { consumedStageBudgetMs } from "./budget.js";
import type { Actor } from "../auth/types.js";

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

export function stageMaximum(timing: CategoryTiming, stage: CompetitionStage): number {
  return timing.stageMaxTimeMs?.[stage] ?? timing.maxTimeMs;
}

export async function putCategoryTiming(
  category: string,
  minTimeMs: number,
  stageMaxTimeMs: Record<CompetitionStage, number>,
  byUser: Actor
): Promise<CategoryTiming> {
  const item: CategoryTiming & { PK: string; SK: string } = {
    ...categoryKey(category), category, minTimeMs,
    // Retained for old clients/readers; Round 1 is the migration fallback.
    maxTimeMs: stageMaxTimeMs.ROUND_1, stageMaxTimeMs,
    updatedAt: new Date().toISOString(), updatedBy: byUser.id, updatedByName: byUser.name,
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

export async function createPenaltyRule(label: string, penaltyMs: number, byUser: Actor, kind?: "INTERVENTION"): Promise<PenaltyRule> {
  const ruleId = randomUUID();
  const item: PenaltyRule & { PK: string; SK: string } = {
    ...ruleKey(ruleId), ruleId, label, penaltyMs, active: true, ...(kind ? { kind } : {}),
    updatedAt: new Date().toISOString(), updatedBy: byUser.id, updatedByName: byUser.name,
  };
  await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME, Item: item, ConditionExpression: "attribute_not_exists(PK)" }));
  return item;
}

export async function updatePenaltyRule(ruleId: string, input: { label: string; penaltyMs: number; active: boolean; kind?: "INTERVENTION" }, byUser: Actor): Promise<PenaltyRule> {
  const result = await ddbDoc.send(new UpdateCommand({
    TableName: TABLE_NAME, Key: ruleKey(ruleId),
    UpdateExpression: input.kind
      ? "SET label = :label, penaltyMs = :penalty, active = :active, kind = :kind, updatedAt = :at, updatedBy = :by"
      : "SET label = :label, penaltyMs = :penalty, active = :active, updatedAt = :at, updatedBy = :by REMOVE kind",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeValues: {
      ":label": input.label, ":penalty": input.penaltyMs, ":active": input.active,
      ...(input.kind ? { ":kind": input.kind } : {}),
      ":at": new Date().toISOString(), ":by": byUser.id, ":byName": byUser.name,
    },
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

/**
 * Rule 7.3(3) counts unauthorized interventions per attempt, not per rule, so a
 * second organizer-defined intervention rule must not hand a team a fresh
 * allowance. `kind` is snapshotted on new rows; rows written before that
 * snapshot existed fall back to matching the rule being applied, which is what
 * the count used to do.
 */
export function interventionsAgainstRun(applied: AppliedPenalty[], runId: string, ruleId: string): number {
  return applied.filter((entry) => entry.runId === runId && !entry.revocation
    && (entry.kind === "INTERVENTION" || (entry.kind === undefined && entry.ruleId === ruleId))).length;
}

export type PenaltyApplication =
  | { outcome: "APPLIED"; penalty: AppliedPenalty }
  | { outcome: "RUN_ENDED"; penalty: null };

export async function applyPenalty(competitorId: string, ruleId: string, byUser: Actor, runId?: string): Promise<PenaltyApplication> {
  if (!(await getCompetitor(competitorId))) throw new ApiError(404, "NOT_FOUND", "Competitor not found");
  const result = await ddbDoc.send(new GetCommand({ TableName: TABLE_NAME, Key: ruleKey(ruleId), ConsistentRead: true }));
  const rule = result.Item as PenaltyRule | undefined;
  if (!rule) throw new ApiError(404, "NOT_FOUND", "Penalty rule not found");
  if (!rule.active) throw new ApiError(409, "CONFLICT", "Penalty rule is inactive");

  // Rule 7.3(2) charges five seconds for the first two interventions only;
  // 7.3(3) makes the third end the run at max time and says nothing about a
  // further charge. So the third is checked *before* the write and records no
  // penalty — the end-run resolution is what goes in the record instead.
  if (rule.kind === "INTERVENTION" && runId) {
    const prior = interventionsAgainstRun(await listAppliedPenalties(competitorId), runId, ruleId);
    if (prior >= 2) {
      await endRunAtMaxTime(competitorId, runId, "INTERVENTION_LIMIT",
        `Ended by the third unauthorized intervention (${rule.label})`, byUser);
      return { outcome: "RUN_ENDED", penalty: null };
    }
  }

  const at = new Date().toISOString();
  const stage = (await getCompetitionState()).activeStage;
  const item: AppliedPenalty & { PK: string } = {
    PK: `COMP#${competitorId}`, SK: `PENALTY#${at}#${ruleId}`,
    ruleId, label: rule.label, penaltyMs: rule.penaltyMs, byUser: byUser.id, byUserName: byUser.name, at, stage,
    ...(rule.kind ? { kind: rule.kind } : {}), ...(runId ? { runId } : {}),
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
  return { outcome: "APPLIED", penalty: item };
}

export async function revokePenalty(competitorId: string, penaltySk: string, reason: string, byUser: Actor): Promise<AppliedPenalty> {
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

export async function correctRun(competitorId: string, runId: string, elapsedMs: number, reason: string, byUser: Actor): Promise<TimeCorrection> {
  const result = await ddbDoc.send(new GetCommand({ TableName: TABLE_NAME, Key: runKey(competitorId, runId), ConsistentRead: true }));
  const run = result.Item as RunRecord | undefined;
  if (!run) throw new ApiError(404, "NOT_FOUND", "Run not found");
  const activeStage = (await getCompetitionState()).activeStage;
  if ((run.stage ?? "ROUND_1") !== activeStage) throw new ApiError(409, "CONFLICT", "A frozen earlier-stage run cannot be corrected");
  if (run.status !== "UNDER_REVIEW" && run.status !== "TIMED_OUT") throw new ApiError(409, "CONFLICT", "Only under-review or timed-out runs can be corrected");
  if (typeof run.minTimeMs !== "number" || typeof run.maxTimeMs !== "number" || elapsedMs < run.minTimeMs || elapsedMs > run.maxTimeMs) {
    throw new ApiError(400, "VALIDATION_ERROR", "Corrected time must be within the run's snapshotted limits");
  }
  const item: TimeCorrection & { PK: string; SK: string } = {
    ...correctionKey(competitorId, runId), runId, elapsedMs, reason, byUser: byUser.id, byUserName: byUser.name,
    at: new Date().toISOString(), stage: run.stage ?? "ROUND_1",
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

export async function resolveUnderReview(competitorId: string, runId: string, decision: "consume" | "void", reason: string, byUser: Actor): Promise<void> {
  const runResult = await ddbDoc.send(new GetCommand({ TableName: TABLE_NAME, Key: runKey(competitorId, runId), ConsistentRead: true }));
  const run = runResult.Item as RunRecord | undefined;
  if (!run) throw new ApiError(404, "NOT_FOUND", "Run not found");
  const activeStage = (await getCompetitionState()).activeStage;
  if ((run.stage ?? "ROUND_1") !== activeStage) throw new ApiError(409, "CONFLICT", "A frozen earlier-stage run cannot be resolved");
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

/**
 * Ends a competitor's current attempt at the stage maximum, consuming it.
 *
 * Covers both shapes the rules produce. If a run is in flight it is ended in
 * place (Rules 5.3(6), 5.4, 5.1(2)). If the robot was never released there is
 * no run to end, so one is synthesized as already timed out (Rules 8.4(4) and
 * 6.1(3)) — otherwise a no-show would simply be absent from the standings
 * instead of ranked last, which is what Rule 6.4(2) requires.
 *
 * Never a void: a void refunds the attempt, and every situation here is one the
 * rules say the team must be charged for.
 */
export async function endAttemptAtMaxTime(
  competitorId: string, resolution: EndRunResolution, reason: string, byUser: Actor,
): Promise<{ runId: string; status: "TIMED_OUT"; resolution: EndRunResolution; consumedExistingRun: boolean }> {
  const runs = await listRuns(competitorId);
  const activeStage = (await getCompetitionState()).activeStage;
  const inFlight = runs.find((run) => (run.stage ?? "ROUND_1") === activeStage && run.status === undefined);

  if (inFlight) {
    const ended = await endRunAtMaxTime(competitorId, inFlight.runId, resolution, reason, byUser);
    if (!ended) {
      // The run resolved on its own between the read and the write — most
      // likely a STOP arrived. Report the conflict rather than silently
      // charging a second attempt for the same event.
      throw new ApiError(409, "CONFLICT", "The run finished before it could be ended; re-check the result");
    }
    return { runId: inFlight.runId, status: "TIMED_OUT", resolution, consumedExistingRun: true };
  }

  const created = await recordForfeitedAttempt(competitorId, resolution, reason, byUser);
  return { runId: created.runId, status: "TIMED_OUT", resolution, consumedExistingRun: false };
}

/**
 * Administrative void of an already-finished run (Rule 5.5 — only officials may
 * declare a run VOID). Unlike `resolveUnderReview`, this covers any terminal run,
 * not just ones flagged UNDER_REVIEW — e.g. a completed run later found to be
 * unfair due to a field/sensor fault. A VOID run does not consume an attempt
 * (STATES.md §4), so this is also the mechanism behind "redo": voiding reopens an
 * attempt slot that lane assignment (`assignLane`) will accept again.
 *
 * Idempotent on an already-VOID run (returns without a further write) so that
 * committee flagging a run and admin subsequently calling `/redo` never race
 * each other into a spurious 409.
 */
export async function voidRun(competitorId: string, runId: string, reason: string, byUser: Actor): Promise<void> {
  const runResult = await ddbDoc.send(new GetCommand({ TableName: TABLE_NAME, Key: runKey(competitorId, runId), ConsistentRead: true }));
  const run = runResult.Item as RunRecord | undefined;
  if (!run) throw new ApiError(404, "NOT_FOUND", "Run not found");
  if (run.status === "VOID") return;
  const activeStage = (await getCompetitionState()).activeStage;
  if ((run.stage ?? "ROUND_1") !== activeStage) throw new ApiError(409, "CONFLICT", "A frozen earlier-stage run cannot be voided");
  const existingCorrection = await getCorrection(competitorId, runId);
  if (existingCorrection) throw new ApiError(409, "CONFLICT", "A corrected run cannot also be voided");
  try {
    await ddbDoc.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: runKey(competitorId, runId),
      UpdateExpression: "SET #status = :void, reviewResolution = :resolution, reviewReason = :reason, reviewedAt = :at, reviewedBy = :by",
      ConditionExpression:
        "(#status = :complete OR #status = :timedOut OR #status = :invalid OR #status = :underReview) AND attribute_not_exists(reviewResolution)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":void": "VOID", ":resolution": "ADMIN_VOID", ":reason": reason, ":at": new Date().toISOString(), ":by": byUser,
        ":complete": "COMPLETE", ":timedOut": "TIMED_OUT", ":invalid": "INVALID", ":underReview": "UNDER_REVIEW",
      },
    }));
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new ApiError(409, "CONFLICT", "Run is still in progress, already void, or already resolved");
    }
    throw error;
  }
}

export async function getAttemptState(competitorId: string, stage?: CompetitionStage): Promise<{ consumed: number; unresolved: RunRecord | null; consumedTimeMs: number }> {
  const [runs, corrections] = await Promise.all([listRuns(competitorId), listCorrections(competitorId)]);
  const selectedRuns = stage ? runs.filter((run) => (run.stage ?? "ROUND_1") === stage) : runs;
  const corrected = new Set(corrections.filter((item) => !stage || (item.stage ?? "ROUND_1") === stage).map((item) => item.runId));
  const unresolved = selectedRuns.find((run) => run.status === "UNDER_REVIEW" && !corrected.has(run.runId)) ?? null;
  const consumedRuns = selectedRuns.filter((run) =>
    run.status === "COMPLETE" || run.status === "TIMED_OUT" || run.status === "INVALID" || corrected.has(run.runId)
  );
  const consumedTimeMs = stage ? consumedStageBudgetMs(runs, corrections, stage) : 0;
  return { consumed: consumedRuns.length, unresolved, consumedTimeMs };
}

export async function calculateTimeResult(competitorId: string, stage?: CompetitionStage): Promise<TimeResult> {
  const [runs, corrections, penalties] = await Promise.all([
    listRuns(competitorId), listCorrections(competitorId), listAppliedPenalties(competitorId),
  ]);
  const activeStage = stage ?? (await getCompetitionState()).activeStage;
  const correctionByRun = new Map(corrections.filter((item) => (item.stage ?? "ROUND_1") === activeStage).map((item) => [item.runId, item]));
  const qualifying = runs.filter((run) => (run.stage ?? "ROUND_1") === activeStage).flatMap((run) => {
    const correction = correctionByRun.get(run.runId);
    const elapsedMs = correction?.elapsedMs ?? (run.status === "COMPLETE" ? run.elapsedMs : null);
    return typeof elapsedMs === "number" ? [{ runId: run.runId, elapsedMs, createdAt: run.createdAt }] : [];
  }).sort((a, b) => a.elapsedMs - b.elapsedMs || a.createdAt.localeCompare(b.createdAt));
  const best = qualifying.slice(0, 2);
  const aggregateTimeMs = best.length ? best.reduce((sum, item) => sum + item.elapsedMs, 0) / best.length : null;
  const penaltyTimeMs = penalties.filter((item) => !item.revocation && (item.stage ?? "ROUND_1") === activeStage).reduce((sum, item) => sum + item.penaltyMs, 0);
  return {
    aggregateTimeMs, penaltyTimeMs,
    finalTimeMs: aggregateTimeMs === null ? null : aggregateTimeMs + penaltyTimeMs,
    qualifyingRunIds: best.map((item) => item.runId),
    tieTimestamp: qualifying[0]?.createdAt ?? null,
  };
}
