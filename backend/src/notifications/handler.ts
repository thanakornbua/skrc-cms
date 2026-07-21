import type { DynamoDBStreamEvent, DynamoDBRecord } from "aws-lambda";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import { buildEmail, classifyRecord, notificationKey, ttlFromDeleteBy, type NotificationEvent } from "./core.js";
import { createCloudflareEmailSender } from "./cloudflare-email.js";

const EMAIL_FROM = process.env.EMAIL_FROM ?? "no-reply@skrc.suankularb.space";
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO ?? "skrc@skrc.suankularb.space";
const PORTAL_URL = process.env.PORTAL_URL ?? "https://competitive.skrc.suankularb.space/portal";
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? "skrc@skrc.suankularb.space";
const EMAIL_ENABLED = process.env.EMAIL_ENABLED === "true";
const CLOUDFLARE_EMAIL_TOKEN_SECRET_ID = process.env.CLOUDFLARE_EMAIL_TOKEN_SECRET_ID;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLAIM_STALE_MS = 5 * 60 * 1000;

const ledger = ddbDoc as DynamoDBDocumentClient;
const sender = CLOUDFLARE_EMAIL_TOKEN_SECRET_ID && CLOUDFLARE_ACCOUNT_ID
  ? createCloudflareEmailSender({
      secretId: CLOUDFLARE_EMAIL_TOKEN_SECRET_ID,
      accountId: CLOUDFLARE_ACCOUNT_ID,
      from: EMAIL_FROM,
      replyTo: EMAIL_REPLY_TO,
    })
  : undefined;

async function claim(event: NotificationEvent): Promise<boolean> {
  const key = notificationKey(event);
  const now = new Date();
  try {
    await ledger.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...key,
        entityType: "EMAIL_NOTIFICATION",
        status: "PROCESSING",
        eventId: event.eventId,
        destination: event.contactEmail,
        attempts: 1,
        claimedAt: now.toISOString(),
        expiresAt: ttlFromDeleteBy(event.deleteBy),
      },
      ConditionExpression: "attribute_not_exists(PK)",
    }));
    return true;
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }

  const current = await ledger.send(new GetCommand({ TableName: TABLE_NAME, Key: key, ConsistentRead: true }));
  if (current.Item?.status === "ACCEPTED") return false;
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
  try {
    await ledger.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: key,
      UpdateExpression: "SET #status = :processing, eventId = :eventId, destination = :destination, claimedAt = :now, expiresAt = :expiresAt ADD attempts :one REMOVE lastError",
      ConditionExpression: "#status = :failed OR (#status = :processing AND claimedAt < :staleBefore)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":processing": "PROCESSING",
        ":failed": "FAILED",
        ":eventId": event.eventId,
        ":destination": event.contactEmail,
        ":now": now.toISOString(),
        ":staleBefore": staleBefore,
        ":expiresAt": ttlFromDeleteBy(event.deleteBy),
        ":one": 1,
      },
    }));
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new Error(`Notification ${key.PK}/${key.SK} is already being processed`);
    }
    throw err;
  }
}

async function markFailed(event: NotificationEvent, err: unknown): Promise<void> {
  await ledger.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: notificationKey(event),
    UpdateExpression: "SET #status = :failed, failedAt = :failedAt, lastError = :lastError",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":failed": "FAILED",
      ":failedAt": new Date().toISOString(),
      ":lastError": err instanceof Error ? err.message.slice(0, 500) : "Unknown email error",
    },
  }));
}

async function processRecord(record: DynamoDBRecord): Promise<void> {
  const event = classifyRecord(record);
  if (!event || !EMAIL_ENABLED) return;
  if (!sender) throw new Error("CLOUDFLARE_EMAIL_TOKEN_SECRET_ID and CLOUDFLARE_ACCOUNT_ID are required when EMAIL_ENABLED=true");
  if (!(await claim(event))) return;

  try {
    const content = buildEmail(event, PORTAL_URL, CONTACT_EMAIL);
    const messageId = await sender.send(event, content);
    await ledger.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: notificationKey(event),
      UpdateExpression: "SET #status = :accepted, acceptedAt = :acceptedAt, messageId = :messageId REMOVE lastError",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":accepted": "ACCEPTED",
        ":acceptedAt": new Date().toISOString(),
        ":messageId": messageId,
      },
    }));
  } catch (err) {
    await markFailed(event, err);
    throw err;
  }
}

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) await processRecord(record);
}
