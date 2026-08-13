import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { SerialPort } from "serialport";
import { DurableSpool, deliverOne, type GateEvent } from "./serial-bridge-core.js";
import { eventTypeForLane, parseUnoLine } from "./uno-bridge-core.js";

const args = process.argv.slice(2);
const argument = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

if (args.includes("--list")) {
  console.log(JSON.stringify(await SerialPort.list(), null, 2));
  process.exit(0);
}

const api = (argument("api") ?? process.env.COMPETITION_API_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const deviceId = argument("device") ?? process.env.UNO_DEVICE_ID ?? "uno-lane1";
const laneId = argument("lane") ?? process.env.UNO_LANE_ID ?? "1";
const deviceKeys = JSON.parse(process.env.DEVICE_KEYS ?? "{}") as Record<string, string>;
const deviceKey = deviceKeys[deviceId];
if (!deviceKey) throw new Error(`DEVICE_KEYS has no key for ${deviceId}`);

let portPath = argument("port") ?? process.env.UNO_SERIAL_PORT;
if (!portPath) {
  const ports = await SerialPort.list();
  portPath = ports.find((port) => /arduino|uno|ttyacm|usb serial/i.test(`${port.manufacturer ?? ""} ${port.path}`))?.path;
}
if (!portPath) throw new Error("No Arduino found. Pass --port /dev/ttyACM0 or set UNO_SERIAL_PORT.");

const bridgeSession = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const spool = new DurableSpool(process.env.SERIAL_SPOOL_DIR ?? ".uno-spool");
await spool.init();
let sequence = 0;
let buffer = "";
let processing = Promise.resolve();

const request = async (path: string, body: object) => {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-key": deviceKey },
    body: JSON.stringify({ deviceId, laneId, ...body }),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(value)}`);
  return value as Record<string, unknown>;
};

const heartbeat = async (state: "CONNECTED" | "DISCONNECTED" | "ERROR", detail: string | null = null) => {
  await request("/device/heartbeat", { serialPort: portPath, bridgeSession, state, detail });
};

async function drain(): Promise<void> {
  const pending = await spool.pending();
  for (const stored of pending) {
    await deliverOne(spool, api, deviceKeys, stored);
  }
}

async function onLine(line: string): Promise<void> {
  const parsed = parseUnoLine(line, Math.floor(performance.now()) >>> 0);
  if (!parsed || parsed.command === "CLEAR") return;
  const lane = await request("/device/lane-state", {});
  const type = eventTypeForLane(String(lane.state));
  if (!type) {
    console.log(`${portPath}: trigger ignored while lane ${laneId} is ${String(lane.state)}`);
    return;
  }
  sequence += 1;
  const event: GateEvent = {
    eventId: `${deviceId}-${bridgeSession}-${sequence}`,
    deviceId,
    laneId,
    gateId: "finish-line",
    type,
    deviceTs: parsed.deviceTs,
  };
  await spool.persist(event);
  console.log(`${portPath}: queued ${event.type} ${event.eventId} at ${event.deviceTs}`);
  await drain();
}

const port = new SerialPort({ path: portPath, baudRate: 115200 });
port.on("open", () => {
  console.log(`UNO bridge connected: ${portPath} -> ${api}, device=${deviceId}, lane=${laneId}`);
  heartbeat("CONNECTED").catch((error) => console.error("Heartbeat failed:", error));
});
port.on("data", (chunk: Buffer) => {
  buffer += chunk.toString("utf8");
  if (buffer.length > 8192) buffer = buffer.slice(-2048);
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    processing = processing.then(() => onLine(line)).catch((error) => console.error(`${portPath}: line failed:`, error));
  }
});
port.on("error", (error) => {
  console.error(`${portPath}: serial error:`, error);
  heartbeat("ERROR", error.message).catch(() => {});
});
port.on("close", () => heartbeat("DISCONNECTED", "Serial port closed").catch(() => {}));

setInterval(() => heartbeat("CONNECTED").catch((error) => console.error("Heartbeat failed:", error)), 10_000).unref();
setInterval(() => drain().catch((error) => console.error("Spool drain failed:", error)), 500).unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    heartbeat("DISCONNECTED", signal).finally(() => port.close(() => process.exit(0)));
  });
}

await new Promise(() => {});
