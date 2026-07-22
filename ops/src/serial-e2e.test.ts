import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DurableSpool, deliverOne, parseEventLine } from "./serial-bridge-core.js";

const endpoint = process.env.AWS_ENDPOINT_URL_DYNAMODB ?? "http://127.0.0.1:18000";
const table = `serial-e2e-${Date.now()}`;
const raw = new DynamoDBClient({ endpoint, region: "ap-southeast-7", credentials: { accessKeyId: "local", secretAccessKey: "local" } });
const ddb = DynamoDBDocumentClient.from(raw);
await raw.send(new CreateTableCommand({ TableName: table, BillingMode: "PAY_PER_REQUEST",
  AttributeDefinitions: [{ AttributeName: "PK", AttributeType: "S" }, { AttributeName: "SK", AttributeType: "S" },
    { AttributeName: "GSI1PK", AttributeType: "S" }, { AttributeName: "GSI1SK", AttributeType: "S" }],
  KeySchema: [{ AttributeName: "PK", KeyType: "HASH" }, { AttributeName: "SK", KeyType: "RANGE" }],
  GlobalSecondaryIndexes: [{ IndexName: "GSI1", Projection: { ProjectionType: "ALL" }, KeySchema:
    [{ AttributeName: "GSI1PK", KeyType: "HASH" }, { AttributeName: "GSI1SK", KeyType: "RANGE" }] }],
}));

const port = await new Promise<number>((resolvePort, reject) => {
  const server = createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") return reject(new Error("No port")); server.close(() => resolvePort(address.port)); });
});
const spoolRoot = await mkdtemp(join(tmpdir(), "serial-e2e-"));
const backend = spawn(process.execPath, [resolve("../backend/dist/index.js")], { env: {
  ...process.env, AWS_ENDPOINT_URL_DYNAMODB: endpoint, AWS_REGION: "ap-southeast-7",
  AWS_ACCESS_KEY_ID: "local", AWS_SECRET_ACCESS_KEY: "local", DYNAMO_TABLE: table,
  PORT: String(port), CORS_ORIGIN: "http://localhost", COGNITO_USER_POOL_ID: "ap-southeast-7_Example",
  COGNITO_CLIENT_ID: "exampleclient", DEVICE_KEYS: JSON.stringify({ "esp32-lane1": "device-secret" }),
  LANES: JSON.stringify([{ laneId: "1", deviceId: "esp32-lane1" }]),
}, stdio: ["ignore", "pipe", "pipe"] });

try {
  await ddb.send(new PutCommand({ TableName: table, Item: { PK: "COMP#C-E2E", SK: "PROFILE", competitorId: "C-E2E",
    teamName: "Serial", category: "Open", status: "INSPECTED", disqualified: { bool: false },
    GSI1PK: "COMPETITOR", GSI1SK: "Open#INSPECTED#C-E2E" } }));
  await ddb.send(new PutCommand({ TableName: table, Item: { PK: "CONFIG#CATEGORY#Open", SK: "PROFILE", category: "Open", minTimeMs: 1000, maxTimeMs: 5000 } }));
  await ddb.send(new PutCommand({ TableName: table, Item: { PK: "LANE#1", SK: "STATE", laneId: "1", state: "ARMED", competitorId: "C-E2E", deviceId: "esp32-lane1" } }));
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    if (attempt === 49) throw new Error("Backend did not start");
  }
  const spool = new DurableSpool(spoolRoot);
  const lines = [
    `EVT ${JSON.stringify({ eventId: "esp32-lane1-9-1", deviceId: "esp32-lane1", laneId: "1", gateId: "start", type: "START", deviceTs: 10_000 })}`,
    `EVT ${JSON.stringify({ eventId: "esp32-lane1-9-2", deviceId: "esp32-lane1", laneId: "1", gateId: "stop", type: "STOP", deviceTs: 12_345 })}`,
  ];
  for (const line of lines) {
    const event = parseEventLine(line); if (!event) throw new Error("Serial frame failed validation");
    await spool.persist(event);
    const stored = (await spool.pending())[0];
    if (await deliverOne(spool, `http://127.0.0.1:${port}`, { "esp32-lane1": "device-secret" }, stored) !== "final") throw new Error("Bridge delivery did not finalize");
  }
  const run = await ddb.send(new GetCommand({ TableName: table, Key: { PK: "COMP#C-E2E", SK: "RUN#esp32-lane1-9-1" }, ConsistentRead: true }));
  if (run.Item?.status !== "COMPLETE" || run.Item.elapsedMs !== 2345) {
    const archives = await readdir(join(spoolRoot, "archive"));
    throw new Error(`Exact serial timing failed: ${JSON.stringify(run.Item)} archives=${JSON.stringify(await Promise.all(archives.map((name) => readFile(join(spoolRoot, "archive", name), "utf8"))))}`);
  }
  console.log("PASS serial-frame durable-spool real-gate-api exact-device-clock global-dedup");
} finally {
  backend.kill("SIGTERM");
  await raw.send(new DeleteTableCommand({ TableName: table }));
  await rm(spoolRoot, { recursive: true, force: true });
}
