import assert from "node:assert/strict";
import test from "node:test";
import { marshall } from "@aws-sdk/util-dynamodb";
import type { DynamoDBRecord } from "aws-lambda";
import { buildEmail, classifyRecord, notificationKey } from "./core.js";

const registration = {
  PK: "REG#sub-123", SK: "PROFILE", status: "PENDING_APPROVAL",
  contactEmail: "Leader@Example.com", teamName: "A&B <Robots>", category: "Line Tracing - Open",
  createdAt: "2026-07-21T00:00:00.000Z", pdpaConsent: { deleteBy: "2027-01-21T00:00:00.000Z" },
};

function record(eventName: DynamoDBRecord["eventName"], next: object, previous?: object): DynamoDBRecord {
  return { eventID: "event-1", eventName, dynamodb: {
    NewImage: marshall(next), ...(previous ? { OldImage: marshall(previous) } : {}),
  } } as DynamoDBRecord;
}

test("classifies a registration insert", () => {
  const event = classifyRecord(record("INSERT", registration));
  assert.equal(event?.type, "REGISTRATION_RECEIVED");
  assert.equal(event?.contactEmail, "leader@example.com");
  assert.deepEqual(notificationKey(event!), { PK: "NOTIFY#sub-123", SK: "REGISTRATION_RECEIVED" });
});

test("classifies only a real approval transition", () => {
  const approved = { ...registration, status: "APPROVED", approval: { competitorId: "C-0042" } };
  assert.equal(classifyRecord(record("MODIFY", approved, registration))?.type, "REGISTRATION_APPROVED");
  assert.equal(classifyRecord(record("MODIFY", approved, approved)), null);
});

test("ignores notification ledger records", () => {
  assert.equal(classifyRecord(record("INSERT", { PK: "NOTIFY#sub-123", SK: "REGISTRATION_RECEIVED" })), null);
});

test("builds bilingual escaped HTML and plain text", () => {
  const event = classifyRecord(record("INSERT", registration))!;
  const email = buildEmail(event, "https://staging.skrc.suankularb.space/portal", "thanakorn@thanakorn.site");
  assert.match(email.subject, /Registration received/);
  assert.match(email.text, /ได้รับใบสมัคร/);
  assert.match(email.text, /thanakorn@thanakorn\.site/);
  assert.match(email.html, /A&amp;B &lt;Robots&gt;/);
  assert.doesNotMatch(email.html, /A&B <Robots>/);
});
