import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { config } from "../config.js";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import type { GateEventInput, RunRecord, RunSplit } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_GRACE_MS = 100;

function scheduleTimeoutSweep(maxTimeMs: number): void {
  const timer = setTimeout(() => {
    sweepTimedOutRuns().catch((error) => console.error("Scheduled timeout sweep failed:", error));
  }, maxTimeMs + TIMEOUT_GRACE_MS);
  timer.unref();
}

function laneKey(laneId: string) { return { PK: `LANE#${laneId}`, SK: "STATE" }; }
function runKey(competitorId: string, runId: string) {
  return { PK: `COMP#${competitorId}`, SK: `RUN#${runId}` };
}

export async function listRuns(competitorId: string): Promise<RunRecord[]> {
  const result = await ddbDoc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :run)",
    ExpressionAttributeValues: { ":pk": `COMP#${competitorId}`, ":run": "RUN#" },
  }));
  return ((result.Items ?? []) as RunRecord[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function activeRun(competitorId: string): Promise<RunRecord | null> {
  return (await listRuns(competitorId)).find((run) => run.status === undefined) ?? null;
}

async function audit(event: GateEventInput): Promise<boolean> {
  try {
    await ddbDoc.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `LANE#${event.laneId}`, SK: `EVT#${event.deviceTs}#${event.eventId}`,
        eventId: event.eventId, type: event.type, gateId: event.gateId,
        deviceTs: event.deviceTs, receivedAt: new Date().toISOString(),
      },
      ConditionExpression: "attribute_not_exists(PK)",
    }));
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

export async function processGateEvent(
  event: GateEventInput
): Promise<{ accepted: boolean; reason?: "duplicate" | "invalid_state" | "clock_anomaly" }> {
  if (!(await audit(event))) return { accepted: false, reason: "duplicate" };

  const laneResult = await ddbDoc.send(new GetCommand({
    TableName: TABLE_NAME, Key: laneKey(event.laneId), ConsistentRead: true,
  }));
  const lane = laneResult.Item as { state?: string; competitorId?: string; deviceId?: string | null } | undefined;
  const configured = config.lanes.find((entry) => entry.laneId === event.laneId);
  if (!configured || (configured.deviceId && configured.deviceId !== event.deviceId)) {
    return { accepted: false, reason: "invalid_state" };
  }

  if (event.type === "START") {
    if (lane?.state !== "ARMED" || !lane.competitorId) return { accepted: false, reason: "invalid_state" };
    const competitorResult = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME, Key: { PK: `COMP#${lane.competitorId}`, SK: "PROFILE" }, ConsistentRead: true,
    }));
    const category = competitorResult.Item?.category as string | undefined;
    if (!category) return { accepted: false, reason: "invalid_state" };
    const timingResult = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME, Key: { PK: `CONFIG#CATEGORY#${category}`, SK: "PROFILE" }, ConsistentRead: true,
    }));
    const minTimeMs = timingResult.Item?.minTimeMs;
    const maxTimeMs = timingResult.Item?.maxTimeMs;
    if (typeof minTimeMs !== "number" || typeof maxTimeMs !== "number") {
      return { accepted: false, reason: "invalid_state" };
    }
    const now = new Date().toISOString();
    try {
      await ddbDoc.send(new TransactWriteCommand({ TransactItems: [
        { Update: {
          TableName: TABLE_NAME, Key: laneKey(event.laneId),
          UpdateExpression: "SET #state = :running, updatedAt = :at",
          ConditionExpression: "#state = :armed AND competitorId = :cid",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: { ":running": "RUNNING", ":armed": "ARMED", ":cid": lane.competitorId, ":at": now },
        } },
        { Put: {
          TableName: TABLE_NAME,
          Item: { ...runKey(lane.competitorId, event.eventId), runId: event.eventId,
            laneId: event.laneId, startDeviceTs: event.deviceTs, stopDeviceTs: null,
            elapsedMs: null, splits: [], minTimeMs, maxTimeMs, createdAt: now },
          ConditionExpression: "attribute_not_exists(PK)",
        } },
      ] }));
      // The normal timeout path is event-driven: one timer per accepted START,
      // avoiding a continuous DynamoDB lane read while the event is idle.
      scheduleTimeoutSweep(maxTimeMs);
      return { accepted: true };
    } catch { return { accepted: false, reason: "invalid_state" }; }
  }

  if (lane?.state !== "RUNNING" || !lane.competitorId) return { accepted: false, reason: "invalid_state" };
  const run = await activeRun(lane.competitorId);
  if (!run) return { accepted: false, reason: "invalid_state" };
  const lastSameGate = [...run.splits].reverse().find((split) => split.gateId === event.gateId);
  if (lastSameGate && event.deviceTs - lastSameGate.deviceTs < 500) {
    return { accepted: false, reason: "invalid_state" };
  }

  const elapsed = event.deviceTs - run.startDeviceTs;
  if (elapsed < 0 || elapsed > DAY_MS) return { accepted: false, reason: "clock_anomaly" };

  if (event.type === "CHECKPOINT") {
    const split: RunSplit = { gateId: event.gateId, deviceTs: event.deviceTs, splitMs: elapsed };
    await ddbDoc.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: runKey(lane.competitorId, run.runId),
      UpdateExpression: "SET splits = list_append(splits, :split)",
      ConditionExpression: "attribute_not_exists(#status)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":split": [split] },
    }));
    return { accepted: true };
  }

  const finalStatus = elapsed < run.minTimeMs
    ? "UNDER_REVIEW"
    : elapsed > run.maxTimeMs
      ? "TIMED_OUT"
      : "COMPLETE";
  const transactionItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
      { Update: {
        TableName: TABLE_NAME, Key: runKey(lane.competitorId, run.runId),
        UpdateExpression: "SET #status = :finalStatus, stopDeviceTs = :stop, elapsedMs = :elapsed",
        ConditionExpression: "attribute_not_exists(#status)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":finalStatus": finalStatus, ":stop": event.deviceTs, ":elapsed": elapsed },
      } },
      { Update: {
        TableName: TABLE_NAME, Key: laneKey(event.laneId),
        UpdateExpression: "SET #state = :idle, competitorId = :none, armedBy = :none, updatedAt = :at",
        ConditionExpression: "#state = :running AND competitorId = :cid",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":idle": "IDLE", ":running": "RUNNING", ":cid": lane.competitorId, ":none": null, ":at": new Date().toISOString() },
      } },
  ];
  if (finalStatus === "COMPLETE") transactionItems.push({ Update: {
        TableName: TABLE_NAME, Key: { PK: `COMP#${lane.competitorId}`, SK: "PROFILE" },
        UpdateExpression: "SET #status = :complete, GSI1SK = :gsi",
        ConditionExpression: "#status = :inspected OR #status = :complete",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":inspected": "INSPECTED", ":complete": "RUN_COMPLETE", ":gsi": `${(await ddbDoc.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: `COMP#${lane.competitorId}`, SK: "PROFILE" } }))).Item?.category}#RUN_COMPLETE#${lane.competitorId}` },
      } });
  try {
    await ddbDoc.send(new TransactWriteCommand({ TransactItems: transactionItems }));
    return { accepted: true };
  } catch { return { accepted: false, reason: "invalid_state" }; }
}

export async function voidActiveRun(competitorId: string): Promise<void> {
  const run = await activeRun(competitorId);
  if (!run) return;
  await ddbDoc.send(new UpdateCommand({
    TableName: TABLE_NAME, Key: runKey(competitorId, run.runId),
    UpdateExpression: "SET #status = :void", ConditionExpression: "attribute_not_exists(#status)",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: { ":void": "VOID" },
  }));
}

/** Closes missed-STOP runs at the snapshotted maximum allowed time. */
export async function sweepTimedOutRuns(nowMs = Date.now()): Promise<number> {
  // Lane IDs are configuration-owned, so avoid a table scan.
  let timedOut = 0;
  for (const entry of config.lanes) {
    const laneResult = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME, Key: laneKey(entry.laneId), ConsistentRead: true,
    }));
    const lane = laneResult.Item as { state?: string; competitorId?: string } | undefined;
    if (lane?.state !== "RUNNING" || !lane.competitorId) continue;
    const run = await activeRun(lane.competitorId);
    if (!run) continue;
    if (typeof run.maxTimeMs !== "number" || run.maxTimeMs <= 0) continue;
    if (nowMs - Date.parse(run.createdAt) < run.maxTimeMs) continue;
    try {
      await ddbDoc.send(new TransactWriteCommand({ TransactItems: [
        { Update: {
          TableName: TABLE_NAME, Key: runKey(lane.competitorId, run.runId),
          UpdateExpression: "SET #status = :timedOut",
          ConditionExpression: "attribute_not_exists(#status)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":timedOut": "TIMED_OUT" },
        } },
        { Update: {
          TableName: TABLE_NAME, Key: laneKey(entry.laneId),
          UpdateExpression: "SET #state = :idle, competitorId = :none, armedBy = :none, updatedAt = :at",
          ConditionExpression: "#state = :running AND competitorId = :cid",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: { ":idle": "IDLE", ":running": "RUNNING", ":cid": lane.competitorId, ":none": null, ":at": new Date(nowMs).toISOString() },
        } },
      ] }));
      timedOut += 1;
    } catch { /* another STOP/reset/sweep won the conditional race */ }
  }
  return timedOut;
}
