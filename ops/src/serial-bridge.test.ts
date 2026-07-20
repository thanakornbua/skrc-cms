import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableSpool, deliverOne, parseEventLine, type GateEvent } from "./serial-bridge-core.js";

const event: GateEvent = { eventId: "esp32-lane1-7-42", deviceId: "esp32-lane1", laneId: "1",
  gateId: "start", type: "START", deviceTs: 1234 };
if (!parseEventLine(`EVT ${JSON.stringify(event)}`) || parseEventLine("TRIGGER start") || parseEventLine("EVT {}")) throw new Error("frame validation failed");
const root = await mkdtemp(join(tmpdir(), "serial-spool-"));
const spool = new DurableSpool(root);
await spool.persist(event); await spool.persist(event);
if ((await spool.pending()).length !== 1) throw new Error("durable local dedup failed");

let status = 500;
const server = createServer((_request, response) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify({ accepted: status === 200 })); });
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); if (!address || typeof address === "string") throw new Error("test server failed");
const url = `http://127.0.0.1:${address.port}`;
if (await deliverOne(spool, url, { "esp32-lane1": "key" }, (await spool.pending())[0]) !== "retry") throw new Error("5xx was not retried");
status = 200;
if (await deliverOne(spool, url, { "esp32-lane1": "key" }, (await spool.pending())[0]) !== "final") throw new Error("200 was not final");
if ((await spool.pending()).length !== 0 || (await readdir(join(root, "archive"))).length !== 1) throw new Error("archive transition failed");
const archived = JSON.parse(await readFile(join(root, "archive", (await readdir(join(root, "archive")))[0]), "utf8"));
if (archived.event.eventId !== event.eventId) throw new Error("archive evidence failed");
const bad = { ...event, eventId: "esp32-lane1-7-43", type: "STOP" as const };
await spool.persist(bad); status = 401;
if (await deliverOne(spool, url, { "esp32-lane1": "wrong" }, (await spool.pending())[0]) !== "final") throw new Error("4xx was not final");
if ((await spool.status()).deadLetter !== 1) throw new Error("4xx dead letter failed");
await spool.replay(bad.eventId);
if ((await spool.status()).pending !== 1 || (await spool.status()).deadLetter !== 0) throw new Error("dead-letter replay failed");
server.close(); await rm(root, { recursive: true, force: true });
console.log("PASS frames durable-before-ack local-dedup retry-5xx archive-final dead-letter replay restart-spool");
