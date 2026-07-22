import { CognitoIdentityProviderClient, AdminDeleteUserCommand, ListUsersCommand, ListUsersInGroupCommand } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { BatchWriteCommandInput } from "@aws-sdk/lib-dynamodb";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const deleteNonStaffUsers = args.includes("--delete-non-staff-users");
const prefixIndex = args.indexOf("--cognito-user-prefix");
const cognitoUserPrefix = prefixIndex >= 0 ? args[prefixIndex + 1] : undefined;
const confirmIndex = args.indexOf("--confirm");
// Defaults to the real production table name (same convention as purge-pii.ts) —
// set DYNAMO_TABLE to point this at staging/local instead.
if (execute && args[confirmIndex + 1] !== "WIPE-COMPETITORS") throw new Error("Execution requires --confirm WIPE-COMPETITORS");

const table = process.env.DYNAMO_TABLE ?? "robo-compet";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const userPoolId = process.env.COGNITO_USER_POOL_ID;
if (deleteNonStaffUsers && !userPoolId) throw new Error("COGNITO_USER_POOL_ID is required with --delete-non-staff-users");
if (deleteNonStaffUsers && (!cognitoUserPrefix || cognitoUserPrefix.length < 8)) {
  throw new Error("--delete-non-staff-users requires --cognito-user-prefix with at least 8 characters");
}
const cognito = new CognitoIdentityProviderClient({});

type BatchWriteRequests = NonNullable<NonNullable<BatchWriteCommandInput["RequestItems"]>[string]>;

/**
 * Competitor profiles, registrations, runs, time corrections, applied penalties,
 * ranking snapshots, and the notification ledger are all competitor-scoped and must
 * be cleared together. The competitorId counter and competition state both revert to
 * their starting values once deleted (see mintCompetitorId in backend/src/regweek/repo.ts
 * and getCompetitionState in backend/src/competition/state.ts), so deleting them resets
 * numbering and stage progress for the next competition. Category config, penalty
 * rules, and lane configuration are event infrastructure. Lane state is reset to IDLE,
 * while gate audit rows and global event claims are removed because they belong only to
 * the discarded mock competition.
 */
function isWipeTarget(pk: string, sk: string): boolean {
  if (pk.startsWith("COMP#")) return true;
  if (pk.startsWith("REG#")) return true;
  if (pk.startsWith("RANKING#")) return true;
  if (pk.startsWith("NOTIFY#")) return true;
  if (pk.startsWith("EVENT#")) return true;
  if (pk.startsWith("LANE#") && sk.startsWith("EVT#")) return true;
  if (pk === "CONFIG#COMPETITION" && sk === "STATE") return true;
  if (pk === "CONFIG#COUNTER" && sk === "COMPETITORID") return true;
  return false;
}

function isLaneState(pk: string, sk: string): boolean {
  return pk.startsWith("LANE#") && sk === "STATE";
}

async function deleteBatch(keys: Array<{ PK: string; SK: string }>): Promise<void> {
  for (let i = 0; i < keys.length; i += 25) {
    let pending: BatchWriteRequests = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
    do {
      const result = await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: pending } }));
      pending = result.UnprocessedItems?.[table] ?? [];
    } while (pending.length > 0);
  }
}

async function resetLaneStates(keys: Array<{ PK: string; SK: string }>): Promise<void> {
  if (!execute) return;
  await Promise.all(keys.map((Key) => ddb.send(new UpdateCommand({
    TableName: table,
    Key,
    UpdateExpression: "SET #state = :idle, competitorId = :none, armedBy = :none, runStartedAt = :none, updatedAt = :at",
    ExpressionAttributeNames: { "#state": "state" },
    ExpressionAttributeValues: { ":idle": "IDLE", ":none": null, ":at": new Date().toISOString() },
  }))));
}

async function listStaffUsernames(groupName: "admin" | "committee"): Promise<Set<string>> {
  const usernames = new Set<string>();
  let nextToken: string | undefined;
  do {
    const page = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: userPoolId!, GroupName: groupName, NextToken: nextToken }));
    for (const user of page.Users ?? []) if (user.Username) usernames.add(user.Username);
    nextToken = page.NextToken;
  } while (nextToken);
  return usernames;
}

async function deleteNonStaffCognitoUsers(): Promise<number> {
  if (!deleteNonStaffUsers) return 0;
  const staff = new Set([...(await listStaffUsernames("admin")), ...(await listStaffUsernames("committee"))]);
  const nonStaff: string[] = [];
  let paginationToken: string | undefined;
  do {
    const page = await cognito.send(new ListUsersCommand({ UserPoolId: userPoolId!, PaginationToken: paginationToken }));
    for (const user of page.Users ?? []) {
      if (user.Username && !staff.has(user.Username) && user.Username.startsWith(cognitoUserPrefix!)) nonStaff.push(user.Username);
    }
    paginationToken = page.PaginationToken;
  } while (paginationToken);
  if (execute) await Promise.all(nonStaff.map((Username) => cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId!, Username }))));
  return nonStaff.length;
}

async function main(): Promise<void> {
  const toDelete: Array<{ PK: string; SK: string }> = [];
  const lanesToReset: Array<{ PK: string; SK: string }> = [];
  let skipped = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey }));
    for (const item of page.Items ?? []) {
      const pk = String(item.PK), sk = String(item.SK);
      if (isWipeTarget(pk, sk)) toDelete.push({ PK: pk, SK: sk });
      else if (isLaneState(pk, sk)) lanesToReset.push({ PK: pk, SK: sk });
      else skipped++;
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (execute) await deleteBatch(toDelete);
  await resetLaneStates(lanesToReset);
  const cognitoUsersDeleted = await deleteNonStaffCognitoUsers();

  console.log(JSON.stringify({
    mode: execute ? "EXECUTED" : "PREVIEW",
    table,
    itemsDeleted: toDelete.length,
    laneStatesReset: lanesToReset.length,
    cognitoNonStaffUsersDeleted: cognitoUsersDeleted,
    cognitoUserPrefix: deleteNonStaffUsers ? cognitoUserPrefix : null,
    itemsLeftUntouched: skipped,
  }, null, 2));
}

main().catch((err) => {
  console.error("wipe-competitors failed:", err);
  process.exit(1);
});
