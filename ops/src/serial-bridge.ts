import { SerialPort } from "serialport";
import { DurableSpool, deliverOne, parseEventLine } from "./serial-bridge-core.js";

const args = process.argv.slice(2);
const values = (name: string) => args.flatMap((arg, index) => arg === `--${name}` ? [args[index + 1]] : []).filter(Boolean);
if (args.includes("--list")) {
  console.log(JSON.stringify(await SerialPort.list(), null, 2));
  process.exit(0);
}
const spool = new DurableSpool(process.env.SERIAL_SPOOL_DIR ?? ".serial-spool");
if (args.includes("--status")) { console.log(JSON.stringify(await spool.status(), null, 2)); process.exit(0); }
const replay = values("replay")[0];
if (replay) { await spool.replay(replay); console.log(`Requeued ${replay}`); process.exit(0); }
const paths = values("port");
if (!paths.length) throw new Error("Pass one or more --port values, or use --list");
const api = process.env.SERIAL_API_URL ?? (() => { throw new Error("SERIAL_API_URL is required"); })();
const keys = JSON.parse(process.env.DEVICE_KEYS ?? "{}") as Record<string, string>;
const lanes = JSON.parse(process.env.SERIAL_LANES ?? "{}") as Record<string, string>;
await spool.init();

for (const path of paths) {
  const port = new SerialPort({ path, baudRate: 115200 });
  let buffer = "";
  let processing = Promise.resolve();
  const processLine = async (line: string) => {
    const event = parseEventLine(line);
    if (!event) return;
    if (!keys[event.deviceId] || (lanes[event.deviceId] && lanes[event.deviceId] !== event.laneId)) {
      console.error(`${path}: rejected unknown device or lane: ${event.deviceId}/${event.laneId}`); return;
    }
    try { await spool.persist(event); port.write(`ACK ${event.eventId}\n`); console.log(`${path}: queued ${event.eventId}`); }
    catch (error) { console.error(`${path}: spool failed`, error); }
  };
  port.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    if (buffer.length > 8192) buffer = buffer.slice(-2048);
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).replace(/\r$/, ""); buffer = buffer.slice(newline + 1);
      processing = processing.then(() => processLine(line)).catch((error) => console.error(`${path}: frame failed`, error));
    }
  });
  port.on("error", (error) => console.error(`${path}: serial error`, error));
}

const backoff = new Map<string, { next: number; delay: number }>();
async function drain(): Promise<void> {
  const pending = await spool.pending();
  const firstByDevice = new Map<string, typeof pending[number]>();
  for (const stored of pending) if (!firstByDevice.has(stored.event.deviceId)) firstByDevice.set(stored.event.deviceId, stored);
  await Promise.all([...firstByDevice.values()].map(async (stored) => {
    const state = backoff.get(stored.event.eventId) ?? { next: 0, delay: 1000 };
    if (Date.now() < state.next) return;
    if (await deliverOne(spool, api, keys, stored) === "final") backoff.delete(stored.event.eventId);
    else backoff.set(stored.event.eventId, { next: Date.now() + state.delay, delay: Math.min(state.delay * 2, 30_000) });
  }));
}
setInterval(() => drain().catch((error) => console.error("bridge drain failed", error)), 250).unref();
console.log(`Serial bridge running: ${paths.join(", ")} -> ${api}; spool=${spool.root}`);
await new Promise(() => {});
