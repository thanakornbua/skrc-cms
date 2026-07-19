import { BatchGetCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import { ApiError } from "../errors.js";
import { config } from "../config.js";
import { getCompetitor } from "../competitors/repo.js";
import type { LaneConfigEntry, LaneRecord } from "./types.js";
import { voidActiveRun } from "../runs/repo.js";
import { getAttemptState } from "../timing/repo.js";

function keyLane(laneId: string) {
  return { PK: `LANE#${laneId}`, SK: "STATE" };
}

function laneConfigEntry(laneId: string): LaneConfigEntry {
  const entry = config.lanes.find((l) => l.laneId === laneId);
  if (!entry) throw new ApiError(404, "NOT_FOUND", `Lane ${laneId} is not configured`);
  return entry;
}

async function ensureLane(entry: LaneConfigEntry): Promise<void> {
  try {
    await ddbDoc.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...keyLane(entry.laneId),
          laneId: entry.laneId,
          state: "IDLE",
          competitorId: null,
          deviceId: entry.deviceId,
          armedBy: null,
          updatedAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }
}

async function getLane(laneId: string): Promise<LaneRecord | null> {
  const result = await ddbDoc.send(
    new GetCommand({ TableName: TABLE_NAME, Key: keyLane(laneId) })
  );
  return (result.Item as LaneRecord | undefined) ?? null;
}

/** Lists every configured lane without writing on this hot read path. */
export async function listLanes(): Promise<LaneRecord[]> {
  const entries = config.lanes;
  let keys = entries.map((entry) => keyLane(entry.laneId));
  const items: LaneRecord[] = [];

  // There are at most a few configured lanes. Retry any throttled keys once
  // rather than making each normal read path issue individual GetItem calls.
  for (let attempt = 0; keys.length > 0 && attempt < 2; attempt += 1) {
    const result = await ddbDoc.send(
      new BatchGetCommand({
        RequestItems: { [TABLE_NAME]: { Keys: keys, ConsistentRead: true } },
      })
    );
    items.push(...((result.Responses?.[TABLE_NAME] ?? []) as LaneRecord[]));
    keys = (result.UnprocessedKeys?.[TABLE_NAME]?.Keys ?? []) as Array<ReturnType<typeof keyLane>>;
  }

  const byLaneId = new Map(items.map((item) => [item.laneId, item]));
  return entries.map((entry): LaneRecord => {
    const stored = byLaneId.get(entry.laneId);
    if (!stored) {
      return {
        laneId: entry.laneId,
        state: "IDLE",
        competitorId: null,
        deviceId: entry.deviceId,
        armedBy: null,
        updatedAt: null,
      };
    }
    // LANES is the provisioning source of truth for device mappings.
    return { ...stored, deviceId: entry.deviceId };
  });
}

/** The non-IDLE lane currently holding this competitor, if any. */
export async function getActiveLaneForCompetitor(
  competitorId: string
): Promise<{ laneId: string; state: LaneRecord["state"] } | null> {
  const lanes = await listLanes();
  const active = lanes.find(
    (l) => l.state !== "IDLE" && l.competitorId === competitorId
  );
  return active ? { laneId: active.laneId, state: active.state } : null;
}

export async function assignLane(
  laneId: string,
  competitorId: string
): Promise<LaneRecord> {
  const entry = laneConfigEntry(laneId);
  await ensureLane(entry);

  const competitor = await getCompetitor(competitorId);
  if (!competitor) throw new ApiError(404, "NOT_FOUND", "Competitor not found");
  if (competitor.disqualified.bool) {
    throw new ApiError(409, "DISQUALIFIED", "Competitor is disqualified and cannot be assigned a lane");
  }
  // STATES.md: assignment requires INSPECTED or later.
  if (competitor.status === "REGISTERED" || competitor.status === "CHECKED_IN") {
    throw new ApiError(409, "NOT_INSPECTED", "Competitor has not passed inspection yet");
  }
  const attempts = await getAttemptState(competitorId);
  if (attempts.unresolved) {
    throw new ApiError(409, "RUN_UNDER_REVIEW", `Run ${attempts.unresolved.runId} requires admin review before reassignment`);
  }
  if (attempts.consumed >= 3) {
    throw new ApiError(409, "CONFLICT", "Competitor has used all 3 attempts");
  }

  const activeElsewhere = await getActiveLaneForCompetitor(competitorId);
  if (activeElsewhere && activeElsewhere.laneId !== laneId) {
    throw new ApiError(
      409,
      "CONFLICT",
      `Competitor is already on lane ${activeElsewhere.laneId} (${activeElsewhere.state})`
    );
  }

  try {
    const result = await ddbDoc.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: keyLane(laneId),
        UpdateExpression:
          "SET #state = :assigned, competitorId = :competitorId, updatedAt = :at",
        ConditionExpression: "#state = :idle",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: {
          ":assigned": "ASSIGNED",
          ":idle": "IDLE",
          ":competitorId": competitorId,
          ":at": new Date().toISOString(),
        },
        ReturnValues: "ALL_NEW",
      })
    );
    const assigned = result.Attributes as LaneRecord;
    const lanes = await listLanes();
    const other = lanes.find(
      (lane) =>
        lane.laneId !== laneId &&
        lane.state !== "IDLE" &&
        lane.competitorId === competitorId
    );
    if (!other) return assigned;

    // Concurrent assignments resolve deterministically: the larger lane ID
    // yields, so both callers agree without a schema-changing transaction.
    if (laneId.localeCompare(other.laneId) > 0) {
      try {
        await ddbDoc.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: keyLane(laneId),
            UpdateExpression:
              "SET #state = :idle, competitorId = :none, armedBy = :none, updatedAt = :at",
            ConditionExpression: "#state = :assigned AND competitorId = :cid",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: {
              ":idle": "IDLE",
              ":assigned": "ASSIGNED",
              ":none": null,
              ":cid": competitorId,
              ":at": new Date().toISOString(),
            },
          })
        );
      } catch (err) {
        if (!(err instanceof ConditionalCheckFailedException)) throw err;
      }
      throw new ApiError(
        409,
        "CONFLICT",
        `Competitor was concurrently assigned to lane ${other.laneId}`
      );
    }
    return assigned;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      const current = await getLane(laneId);
      throw new ApiError(
        409,
        "CONFLICT",
        `Lane ${laneId} is ${current?.state ?? "unavailable"} — assignment requires IDLE`
      );
    }
    throw err;
  }
}

export async function armLane(laneId: string, byUser: string): Promise<LaneRecord> {
  laneConfigEntry(laneId);
  try {
    const result = await ddbDoc.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: keyLane(laneId),
        UpdateExpression: "SET #state = :armed, armedBy = :byUser, updatedAt = :at",
        ConditionExpression: "#state = :assigned",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: {
          ":armed": "ARMED",
          ":assigned": "ASSIGNED",
          ":byUser": byUser,
          ":at": new Date().toISOString(),
        },
        ReturnValues: "ALL_NEW",
      })
    );
    return result.Attributes as LaneRecord;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      const current = await getLane(laneId);
      throw new ApiError(
        409,
        "CONFLICT",
        `Lane ${laneId} is ${current?.state ?? "unavailable"} — arming requires ASSIGNED`
      );
    }
    throw err;
  }
}

/**
 * Valid from any state per STATES.md. Voiding an in-flight Run lands with
 * Phase 7 (Run items don't exist before it) — this transition is where that
 * hook goes.
 */
export async function resetLane(laneId: string): Promise<LaneRecord> {
  const entry = laneConfigEntry(laneId);
  await ensureLane(entry);
  const before = await getLane(laneId);
  if (before?.state === "RUNNING" && before.competitorId) {
    await voidActiveRun(before.competitorId);
  }
  const result = await ddbDoc.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keyLane(laneId),
      UpdateExpression:
        "SET #state = :idle, competitorId = :none, armedBy = :none, updatedAt = :at",
      ExpressionAttributeNames: { "#state": "state" },
      ExpressionAttributeValues: {
        ":idle": "IDLE",
        ":none": null,
        ":at": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    })
  );
  return result.Attributes as LaneRecord;
}
