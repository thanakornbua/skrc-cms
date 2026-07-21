import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { BatchWriteCommandInput } from "@aws-sdk/lib-dynamodb";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const confirmIndex = args.indexOf("--confirm");
// Defaults to the real production table name (same convention as purge-pii.ts) —
// set DYNAMO_TABLE to point this at staging/local instead.
if (execute && args[confirmIndex + 1] !== "WIPE-COMPETITORS") throw new Error("Execution requires --confirm WIPE-COMPETITORS");

const table = process.env.DYNAMO_TABLE ?? "robo-compet";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type BatchWriteRequests = NonNullable<NonNullable<BatchWriteCommandInput["RequestItems"]>[string]>;

/**
 * Competitor profiles, registrations, runs, time corrections, applied penalties,
 * ranking snapshots, and the notification ledger are all competitor-scoped and must
 * be cleared together. The competitorId counter and competition state both revert to
 * their starting values once deleted (see mintCompetitorId in backend/src/regweek/repo.ts
 * and getCompetitionState in backend/src/competition/state.ts), so deleting them resets
 * numbering and stage progress for the next competition. Category config, penalty
 * rules, and lane records are event infrastructure, not competitor data — left alone.
 */
function isWipeTarget(pk: string, sk: string): boolean {
  if (pk.startsWith("COMP#")) return true;
  if (pk.startsWith("REG#")) return true;
  if (pk.startsWith("RANKING#")) return true;
  if (pk.startsWith("NOTIFY#")) return true;
  if (pk === "CONFIG#COMPETITION" && sk === "STATE") return true;
  if (pk === "CONFIG#COUNTER" && sk === "COMPETITORID") return true;
  return false;
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

async function main(): Promise<void> {
  const toDelete: Array<{ PK: string; SK: string }> = [];
  let skipped = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey }));
    for (const item of page.Items ?? []) {
      const pk = String(item.PK), sk = String(item.SK);
      if (isWipeTarget(pk, sk)) toDelete.push({ PK: pk, SK: sk });
      else skipped++;
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (execute) await deleteBatch(toDelete);

  console.log(JSON.stringify({
    mode: execute ? "EXECUTED" : "PREVIEW",
    table,
    itemsDeleted: toDelete.length,
    itemsLeftUntouched: skipped,
  }, null, 2));
}

main().catch((err) => {
  console.error("wipe-competitors failed:", err);
  process.exit(1);
});
