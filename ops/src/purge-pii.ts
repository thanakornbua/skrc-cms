import { AdminDeleteUserCommand, CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const allowEarly = args.has("--allow-early");
const confirmIndex = process.argv.indexOf("--confirm");
if (execute && process.argv[confirmIndex + 1] !== "PURGE-PII") throw new Error("Execution requires --confirm PURGE-PII");

const table = process.env.DYNAMO_TABLE ?? "robo-compet";
const poolId = process.env.COGNITO_USER_POOL_ID;
if (!poolId) throw new Error("COGNITO_USER_POOL_ID is required");
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const state = await ddb.send(new GetCommand({ TableName: table, Key: { PK: "CONFIG#COMPETITION", SK: "STATE" }, ConsistentRead: true }));
const concludedAt = state.Item?.concludedAt as string | undefined;
if (!concludedAt) throw new Error("Competition has no concludedAt; conclude and export results before purging");
const deadline = new Date(concludedAt);
deadline.setUTCMonth(deadline.getUTCMonth() + 6);
if (execute && !allowEarly && Date.now() < deadline.getTime()) throw new Error(`Retention deadline is ${deadline.toISOString()}; use --allow-early only with operator approval`);

const directFields = new Set(["competitorId", "GSI1PK", "GSI1SK", "name", "contactEmail", "contactPhone", "cognitoSub", "pdpaConsent",
  "student1NameThai", "student1NameEnglish", "student2NameThai", "student2NameEnglish",
  "student3NameThai", "student3NameEnglish"]);
const attributionFields = new Set(["byUser", "updatedBy", "reviewedBy", "armedBy", "concludedBy"]);
function anonymize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(anonymize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) =>
    [key, attributionFields.has(key) && child != null ? "ANONYMIZED" : anonymize(child)]));
}

let registrations = 0, competitors = 0, audits = 0, rankingSnapshots = 0, anonymized = 0, users = 0;
let startKey: Record<string, unknown> | undefined;
do {
  const page = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: startKey }));
  for (const original of page.Items ?? []) {
    const item = { ...original };
    const pk = String(item.PK), sk = String(item.SK);
    if (pk.startsWith("REG#")) {
      registrations++;
      if (execute) await ddb.send(new DeleteCommand({ TableName: table, Key: { PK: pk, SK: sk } }));
      continue;
    }
    if (pk.startsWith("RANKING#")) {
      rankingSnapshots++;
      if (execute) await ddb.send(new DeleteCommand({ TableName: table, Key: { PK: pk, SK: sk } }));
      continue;
    }
    if (sk.startsWith("AUDIT#PASSWORD_RESET#")) {
      audits++;
      if (execute) await ddb.send(new DeleteCommand({ TableName: table, Key: { PK: pk, SK: sk } }));
      continue;
    }
    if (pk.startsWith("COMP#") && sk === "PROFILE") {
      competitors++;
      for (const field of directFields) delete item[field];
    }
    const cleaned = anonymize(item) as Record<string, unknown>;
    if (JSON.stringify(cleaned) !== JSON.stringify(original)) {
      anonymized++;
      if (execute) await ddb.send(new PutCommand({ TableName: table, Item: cleaned }));
    }
  }
  startKey = page.LastEvaluatedKey;
} while (startKey);

let token: string | undefined;
do {
  const page = await cognito.send(new ListUsersCommand({ UserPoolId: poolId, PaginationToken: token }));
  for (const user of page.Users ?? []) {
    if (!user.Username) continue;
    users++;
    if (execute) await cognito.send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: user.Username }));
  }
  token = page.PaginationToken;
} while (token);

console.log(JSON.stringify({ mode: execute ? "EXECUTED" : "PREVIEW", concludedAt, deadline: deadline.toISOString(),
  registrationsDeleted: registrations, competitorProfilesScrubbed: competitors, passwordAuditsDeleted: audits,
  internalRankingSnapshotsDeleted: rankingSnapshots, recordsAnonymized: anonymized, cognitoUsersDeleted: users }, null, 2));
