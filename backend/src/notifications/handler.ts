import type { DynamoDBStreamEvent, DynamoDBRecord } from "aws-lambda";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import { buildEmail, classifyRecord, notificationKey, ttlFromDeleteBy, type NotificationEvent } from "./core.js";

const EMAIL_REGION = process.env.EMAIL_REGION ?? "ap-southeast-1";
const EMAIL_FROM = process.env.EMAIL_FROM ?? "registration@notify.suankularb.space";
const PORTAL_URL = process.env.PORTAL_URL ?? "https://competitive.skrc.suankularb.space/portal";
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? "thanakorn@thanakorn.site";
const EMAIL_ENABLED = process.env.EMAIL_ENABLED === "true";
const CLAIM_STALE_MS = 5 * 60 * 1000;

const ses = new SESv2Client({ region: EMAIL_REGION });
const ledger = ddbDoc as DynamoDBDocumentClient;

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
  if (!(await claim(event))) return;

  try {
    const content = buildEmail(event, PORTAL_URL, CONTACT_EMAIL);
    const response = await ses.send(new SendEmailCommand({
      FromEmailAddress: `SKRC Robotics Competition <${EMAIL_FROM}>`,
      Destination: { ToAddresses: [event.contactEmail] },
      Content: { Simple: {
        Subject: { Data: content.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: content.text, Charset: "UTF-8" },
          Html: { Data: content.html, Charset: "UTF-8" },
        },
      } },
    }));
    await ledger.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: notificationKey(event),
      UpdateExpression: "SET #status = :accepted, acceptedAt = :acceptedAt, messageId = :messageId REMOVE lastError",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":accepted": "ACCEPTED",
        ":acceptedAt": new Date().toISOString(),
        ":messageId": response.MessageId ?? "unknown",
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
