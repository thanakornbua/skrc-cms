import { GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import { ApiError } from "../errors.js";
import type { CompetitorRecord } from "./types.js";

function keyComp(competitorId: string) {
  return { PK: `COMP#${competitorId}`, SK: "PROFILE" };
}

export async function getCompetitor(competitorId: string): Promise<CompetitorRecord | null> {
  const result = await ddbDoc.send(
    new GetCommand({ TableName: TABLE_NAME, Key: keyComp(competitorId) })
  );
  return (result.Item as CompetitorRecord | undefined) ?? null;
}

export async function recordPasswordResetRequest(
  competitorId: string,
  byUser: string,
  at: string
): Promise<void> {
  const deleteAt = new Date(Date.parse(at) + 180 * 24 * 60 * 60 * 1000);
  await ddbDoc.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `COMP#${competitorId}`,
        SK: `AUDIT#PASSWORD_RESET#${at}`,
        type: "PASSWORD_RESET_REQUESTED",
        byUser,
        at,
        deleteBy: deleteAt.toISOString(),
      },
      ConditionExpression: "attribute_not_exists(PK)",
    })
  );
}

export interface ListFilters {
  category?: string;
  status?: string;
  q?: string;
}

/**
 * Queries all Competitor items via GSI1 (small event scale, < 500 items) and
 * filters in memory — category/status/q don't share a single sort-key prefix
 * (GSI1SK is category#status#competitorId), so a server-side Query condition
 * can't cover every combination cheaply; an in-memory filter keeps this simple.
 */
export async function listCompetitors(filters: ListFilters): Promise<CompetitorRecord[]> {
  const search = filters.q?.trim() ?? "";

  // Badge/QR scans and typed competitor numbers are the common check-in path.
  // Resolve those with one keyed read rather than querying the whole GSI.
  if (/^C-\d+$/i.test(search)) {
    const item = await getCompetitor(search.toUpperCase());
    if (!item) return [];
    if (filters.category && item.category !== filters.category) return [];
    if (filters.status && item.status !== filters.status) return [];
    return [item];
  }

  const result = await ddbDoc.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "COMPETITOR" },
    })
  );

  let items = (result.Items as CompetitorRecord[] | undefined) ?? [];
  if (filters.category) {
    items = items.filter((i) => i.category === filters.category);
  }
  if (filters.status) {
    items = items.filter((i) => i.status === filters.status);
  }
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(
      (i) => i.teamName.toLowerCase().includes(q) || (i.name ?? "").toLowerCase().includes(q)
    );
  }
  return items;
}

/** Admin-only D18 raw export, paginated because DynamoDB Scan pages at 1 MB. */
export async function scanProfiles(entityType: "REGISTRATION" | "COMPETITOR"): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddbDoc.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "GSI1PK = :entityType",
      ExpressionAttributeValues: { ":entityType": entityType },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...((result.Items as Array<Record<string, unknown>>) ?? []));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items;
}

export interface CheckInResult {
  status: CompetitorStatusResult;
  checkedInAt: string;
  alreadyCheckedIn: boolean;
}

type CompetitorStatusResult = CompetitorRecord["status"];

export async function checkIn(competitorId: string, byUser: string): Promise<CheckInResult> {
  const existing = await getCompetitor(competitorId);
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Competitor not found");

  if (existing.status !== "REGISTERED") {
    return {
      status: existing.status,
      checkedInAt: existing.checkedInAt ?? new Date().toISOString(),
      alreadyCheckedIn: true,
    };
  }

  const checkedInAt = new Date().toISOString();
  try {
    await ddbDoc.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: keyComp(competitorId),
        UpdateExpression: "SET #status = :checkedIn, checkedInAt = :at, checkedInBy = :byUser, GSI1SK = :gsi1sk",
        ConditionExpression: "#status = :registered",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":checkedIn": "CHECKED_IN",
          ":at": checkedInAt,
          ":byUser": byUser,
          ":registered": "REGISTERED",
          ":gsi1sk": `${existing.category}#CHECKED_IN#${competitorId}`,
        },
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      const current = await getCompetitor(competitorId);
      if (!current) throw new ApiError(404, "NOT_FOUND", "Competitor not found");
      return {
        status: current.status,
        checkedInAt: current.checkedInAt ?? checkedInAt,
        alreadyCheckedIn: true,
      };
    }
    throw err;
  }

  return { status: "CHECKED_IN", checkedInAt, alreadyCheckedIn: false };
}

export interface InspectResult {
  status: "INSPECTED";
  inspectedAt: string;
}

export async function inspectCompetitor(competitorId: string): Promise<InspectResult> {
  const existing = await getCompetitor(competitorId);
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Competitor not found");

  if (existing.status === "REGISTERED") {
    throw new ApiError(409, "NOT_CHECKED_IN", "Competitor has not checked in yet");
  }

  // Already INSPECTED or beyond (RUN_COMPLETE) — idempotent, nothing to change.
  if (existing.status !== "CHECKED_IN") {
    return { status: "INSPECTED", inspectedAt: existing.inspectedAt ?? new Date().toISOString() };
  }

  const inspectedAt = new Date().toISOString();
  try {
    await ddbDoc.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: keyComp(competitorId),
        UpdateExpression: "SET #status = :inspected, inspectedAt = :at, GSI1SK = :gsi1sk",
        ConditionExpression: "#status = :checkedIn",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":inspected": "INSPECTED",
          ":at": inspectedAt,
          ":checkedIn": "CHECKED_IN",
          ":gsi1sk": `${existing.category}#INSPECTED#${competitorId}`,
        },
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      const current = await getCompetitor(competitorId);
      if (!current) throw new ApiError(404, "NOT_FOUND", "Competitor not found");
      if (current.status === "REGISTERED") {
        throw new ApiError(409, "NOT_CHECKED_IN", "Competitor has not checked in yet");
      }
      return { status: "INSPECTED", inspectedAt: current.inspectedAt ?? inspectedAt };
    }
    throw err;
  }

  return { status: "INSPECTED", inspectedAt };
}

export async function disqualifyCompetitor(competitorId: string, reason: string, byUser: string): Promise<CompetitorRecord["disqualified"]> {
  const disqualified = { bool: true, reason, byUser, at: new Date().toISOString() };
  try {
    await ddbDoc.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: keyComp(competitorId),
      UpdateExpression: "SET disqualified = :disqualified",
      ConditionExpression:
        "attribute_exists(PK) AND (attribute_not_exists(disqualified.#bool) OR disqualified.#bool = :false)",
      ExpressionAttributeNames: { "#bool": "bool" },
      ExpressionAttributeValues: { ":disqualified": disqualified, ":false": false },
    }));
    return disqualified;
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    const current = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME, Key: keyComp(competitorId), ConsistentRead: true,
    }));
    if (!current.Item) throw new ApiError(404, "NOT_FOUND", "Competitor not found");
    return (current.Item as CompetitorRecord).disqualified;
  }
}

export async function reinstateCompetitor(competitorId: string, reason: string, byUser: string): Promise<CompetitorRecord["disqualified"]> {
  const disqualified = { bool: false, reason, byUser, at: new Date().toISOString() };
  try {
    await ddbDoc.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: keyComp(competitorId),
      UpdateExpression: "SET disqualified = :disqualified",
      ConditionExpression: "attribute_exists(PK) AND disqualified.#bool = :true",
      ExpressionAttributeNames: { "#bool": "bool" },
      ExpressionAttributeValues: { ":disqualified": disqualified, ":true": true },
    }));
    return disqualified;
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    const current = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME, Key: keyComp(competitorId), ConsistentRead: true,
    }));
    if (!current.Item) throw new ApiError(404, "NOT_FOUND", "Competitor not found");
    return (current.Item as CompetitorRecord).disqualified;
  }
}
