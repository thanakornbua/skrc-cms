import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const endpoint = process.env.AWS_ENDPOINT_URL_DYNAMODB ?? "http://127.0.0.1:18000";
const table = `local-rehearsal-${Date.now()}`;
const credentials = { accessKeyId: "local", secretAccessKey: "local" };
const raw = new DynamoDBClient({ endpoint, region: "ap-southeast-7", credentials });
const ddb = DynamoDBDocumentClient.from(raw);
await raw.send(new CreateTableCommand({ TableName: table, BillingMode: "PAY_PER_REQUEST",
  AttributeDefinitions: [{ AttributeName: "PK", AttributeType: "S" }, { AttributeName: "SK", AttributeType: "S" },
    { AttributeName: "GSI1PK", AttributeType: "S" }, { AttributeName: "GSI1SK", AttributeType: "S" }],
  KeySchema: [{ AttributeName: "PK", KeyType: "HASH" }, { AttributeName: "SK", KeyType: "RANGE" }],
  GlobalSecondaryIndexes: [{ IndexName: "GSI1", Projection: { ProjectionType: "ALL" }, KeySchema:
    [{ AttributeName: "GSI1PK", KeyType: "HASH" }, { AttributeName: "GSI1SK", KeyType: "RANGE" }] }],
}));
const port = await new Promise<number>((done, reject) => { const server = createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") return reject(new Error("No free port")); server.close(() => done(address.port)); }); });
const devices = [{ laneId: "1", deviceId: "esp32-lane1", key: "local-key-1" }, { laneId: "2", deviceId: "esp32-lane2", key: "local-key-2" }];
const commonEnv = { ...process.env, AWS_ENDPOINT_URL_DYNAMODB: endpoint, AWS_REGION: "ap-southeast-7",
  AWS_ACCESS_KEY_ID: "local", AWS_SECRET_ACCESS_KEY: "local", DYNAMO_TABLE: table };
Object.assign(process.env, commonEnv);
const backend = spawn(process.execPath, [resolve("../backend/dist/index.js")], { env: { ...commonEnv,
  PORT: String(port), CORS_ORIGIN: "http://localhost", COGNITO_USER_POOL_ID: "ap-southeast-7_Example",
  COGNITO_CLIENT_ID: "exampleclient", DEVICE_KEYS: JSON.stringify(Object.fromEntries(devices.map((item) => [item.deviceId, item.key]))),
  LANES: JSON.stringify(devices.map(({ laneId, deviceId }) => ({ laneId, deviceId }))),
}, stdio: ["ignore", "pipe", "pipe"] });

try {
  for (const [id, team] of [["C-A", "Alpha"], ["C-B", "Beta"], ["C-C", "Gamma"], ["C-D", "Delta"]]) {
    await ddb.send(new PutCommand({ TableName: table, Item: { PK: `COMP#${id}`, SK: "PROFILE", competitorId: id,
      teamName: team, category: "Open", status: "INSPECTED", disqualified: { bool: false, reason: null, byUser: null, at: null },
      GSI1PK: "COMPETITOR", GSI1SK: `Open#INSPECTED#${id}` } }));
  }
  await ddb.send(new PutCommand({ TableName: table, Item: { PK: "CONFIG#CATEGORY#Open", SK: "PROFILE", category: "Open", minTimeMs: 1000, maxTimeMs: 5000,
    stageMaxTimeMs: { ROUND_1: 5000, BEST_OF_4: 5000, BEST_OF_2: 5000, THE_BEST: 5000 } } }));
  for (const [index, competitorId] of ["C-A", "C-B"].entries()) await ddb.send(new PutCommand({ TableName: table, Item: {
    PK: `LANE#${index + 1}`, SK: "STATE", laneId: String(index + 1), state: "ARMED", competitorId,
    deviceId: devices[index].deviceId, armedBy: "LOCAL_REHEARSAL" } }));
  for (let attempt = 0; attempt < 50; attempt++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* start */ }
    await new Promise((wait) => setTimeout(wait, 100)); if (attempt === 49) throw new Error("Backend did not start"); }

  const stress = spawn(process.execPath, [resolve("dist/stress-gates.js")], { env: { ...commonEnv,
    STRESS_API_URL: `http://127.0.0.1:${port}`, STRESS_LANES: JSON.stringify(devices) }, stdio: ["ignore", "pipe", "pipe"] });
  let stressOut = "", stressErr = ""; stress.stdout.on("data", (data) => stressOut += data); stress.stderr.on("data", (data) => stressErr += data);
  const stressCode = await new Promise<number | null>((done) => stress.on("close", done));
  if (stressCode !== 0 || !stressOut.includes("PASS")) throw new Error(`Stress failed: ${stressErr || stressOut}`);

  const runItem = (id: string, runId: string, elapsedMs: number, status: string, createdAt: string, stage = "ROUND_1") => ({
    PK: `COMP#${id}`, SK: `RUN#${runId}`, runId, laneId: "fixture", startDeviceTs: 0,
    stopDeviceTs: elapsedMs, elapsedMs, splits: [], minTimeMs: 1000, maxTimeMs: 5000, status, createdAt, stage });
  await ddb.send(new PutCommand({ TableName: table, Item: runItem("C-C", "under", 500, "UNDER_REVIEW", "2026-01-01T00:00:01.000Z") }));
  await ddb.send(new PutCommand({ TableName: table, Item: runItem("C-D", "fast", 1000, "COMPLETE", "2026-01-01T00:00:00.000Z") }));

  const timing = await import(pathToFileURL(resolve("../backend/dist/timing/repo.js")).href);
  const competitors = await import(pathToFileURL(resolve("../backend/dist/competitors/repo.js")).href);
  const competition = await import(pathToFileURL(resolve("../backend/dist/competition/repo.js")).href);
  await timing.correctRun("C-C", "under", 2500, "local rehearsal correction", "admin-local");
  const rule = await timing.createPenaltyRule("Local penalty", 1500, "admin-local");
  await timing.applyPenalty("C-A", rule.ruleId, "committee-local");
  await competitors.disqualifyCompetitor("C-D", "local rehearsal DQ", "committee-local");

  await ddb.send(new PutCommand({ TableName: table, Item: { PK: "LANE#2", SK: "STATE", laneId: "2", state: "ARMED",
    competitorId: "C-B", deviceId: "esp32-lane2", armedBy: "LOCAL_REHEARSAL" } }));
  const timeoutStart = { eventId: "esp32-lane2-timeout-1", deviceId: "esp32-lane2", laneId: "2", gateId: "start", type: "START", deviceTs: 50_000 };
  const timeoutResponse = await fetch(`http://127.0.0.1:${port}/gate-events`, { method: "POST",
    headers: { "content-type": "application/json", "x-device-key": "local-key-2" }, body: JSON.stringify(timeoutStart) });
  if (!(await timeoutResponse.json() as { accepted: boolean }).accepted) throw new Error("Timeout START was not accepted");
  await new Promise((wait) => setTimeout(wait, 5250));
  const timedOut = await ddb.send(new GetCommand({ TableName: table, Key: { PK: "COMP#C-B", SK: "RUN#esp32-lane2-timeout-1" }, ConsistentRead: true }));
  if (timedOut.Item?.status !== "TIMED_OUT") throw new Error("Timeout sweep failed");

  await competition.advanceCompetitionStage("admin-local");
  for (const [id, time] of [["C-A", 3000], ["C-B", 2500], ["C-C", 2000]] as Array<[string, number]>) {
    await ddb.send(new PutCommand({ TableName: table, Item: runItem(id, `best4-${id}`, time, "COMPLETE", `2026-01-01T01:00:0${time / 500}.000Z`, "BEST_OF_4") }));
  }
  await competition.advanceCompetitionStage("admin-local");
  for (const [id, times] of [["C-A", [4000, 4000]], ["C-B", [2400, 2600]], ["C-C", [2800, 3200]]] as Array<[string, number[]]>) {
    for (const [index, time] of times.entries()) await ddb.send(new PutCommand({ TableName: table, Item: runItem(id, `best2-${id}-${index}`, time, "COMPLETE", `2026-01-01T02:00:0${index}.000Z`, "BEST_OF_2") }));
  }
  await competition.advanceCompetitionStage("admin-local");
  for (const [id, times] of [["C-B", [2500, 2700]], ["C-C", [2800, 3000]]] as Array<[string, number[]]>) {
    for (const [index, time] of times.entries()) await ddb.send(new PutCommand({ TableName: table, Item: runItem(id, `final-${id}-${index}`, time, "COMPLETE", `2026-01-01T03:00:0${index}.000Z`, "THE_BEST") }));
  }
  const concluded = await competition.concludeCompetition("admin-local");
  const category = concluded.results.find((item: { category: string }) => item.category === "Open");
  if (!category || category.disqualified[0]?.teamName !== "Delta" || JSON.stringify(category).includes("competitorId")) throw new Error("Conclusion privacy/DQ failed");
  if (category.ranked.map((item: { teamName: string }) => item.teamName).join(",") !== "Beta,Gamma,Alpha") throw new Error(`Unexpected staged ranking: ${JSON.stringify(category.ranked)}`);
  await writeFile("/tmp/skrc-local-results.json", JSON.stringify({ categories: concluded.results }, null, 2));
  await competition.reopenCompetition();
  const snapshots = await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": "RANKING#Open" } }));
  if (snapshots.Count !== 0) throw new Error("Reopen did not remove snapshots");
  console.log(stressOut.trim());
  console.log("PASS timeout correction penalty dq staged-advancement final-placement privacy freeze-export reopen-cleanup");
  console.log("Static export: /tmp/skrc-local-results.json");
} finally {
  backend.kill("SIGTERM");
  await raw.send(new DeleteTableCommand({ TableName: table }));
}
