import { mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type GateEventType = "START" | "CHECKPOINT" | "STOP";
export interface GateEvent {
  eventId: string; deviceId: string; laneId: string; gateId: string;
  type: GateEventType; deviceTs: number;
}
interface StoredEvent { event: GateEvent; receivedAt: string }

const idPattern = /^[A-Za-z0-9._:-]{1,160}$/;
function nonEmpty(value: unknown, max = 160): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function parseEventLine(line: string): GateEvent | null {
  if (!line.startsWith("EVT ") || line.length > 2048) return null;
  try {
    const value = JSON.parse(line.slice(4)) as Record<string, unknown>;
    if (!nonEmpty(value.eventId) || !idPattern.test(value.eventId) || !nonEmpty(value.deviceId, 96) ||
        !nonEmpty(value.laneId, 32) || !nonEmpty(value.gateId, 64) ||
        !["START", "CHECKPOINT", "STOP"].includes(String(value.type)) ||
        !Number.isInteger(value.deviceTs) || Number(value.deviceTs) < 0 || Number(value.deviceTs) > 0xffffffff) return null;
    return { eventId: value.eventId, deviceId: value.deviceId, laneId: value.laneId,
      gateId: value.gateId, type: value.type as GateEventType, deviceTs: Number(value.deviceTs) };
  } catch { return null; }
}

const filename = (eventId: string) => `${Buffer.from(eventId).toString("base64url")}.json`;

export class DurableSpool {
  constructor(readonly root: string) {}
  private dir(name: "pending" | "archive" | "dead-letter") { return join(this.root, name); }
  async init(): Promise<void> { await Promise.all(["pending", "archive", "dead-letter"].map((name) => mkdir(join(this.root, name), { recursive: true }))); }

  async persist(event: GateEvent): Promise<void> {
    await this.init();
    const target = join(this.dir("pending"), filename(event.eventId));
    try { await stat(target); return; } catch { /* first receipt */ }
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify({ event, receivedAt: new Date().toISOString() } satisfies StoredEvent)); await handle.sync(); }
    finally { await handle.close(); }
    try { await rename(temporary, target); } catch (error) {
      try { await stat(target); } catch { throw error; }
    }
  }

  async pending(): Promise<StoredEvent[]> {
    await this.init();
    const entries = await readdir(this.dir("pending"));
    const events = await Promise.all(entries.filter((name) => name.endsWith(".json")).map(async (name) =>
      JSON.parse(await readFile(join(this.dir("pending"), name), "utf8")) as StoredEvent));
    return events.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.event.eventId.localeCompare(b.event.eventId));
  }

  async status(): Promise<Record<"pending" | "archive" | "deadLetter", number>> {
    await this.init();
    const count = async (name: "pending" | "archive" | "dead-letter") =>
      (await readdir(this.dir(name))).filter((entry) => entry.endsWith(".json")).length;
    return { pending: await count("pending"), archive: await count("archive"), deadLetter: await count("dead-letter") };
  }

  async replay(eventId: string): Promise<void> {
    if (!idPattern.test(eventId)) throw new Error("Invalid eventId");
    await this.init();
    const source = join(this.dir("dead-letter"), filename(eventId));
    const dead = JSON.parse(await readFile(source, "utf8")) as StoredEvent;
    const target = join(this.dir("pending"), filename(eventId));
    const handle = await open(`${target}.tmp`, "w", 0o600);
    try { await handle.writeFile(JSON.stringify({ event: dead.event, receivedAt: dead.receivedAt } satisfies StoredEvent)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(`${target}.tmp`, target);
    await unlink(source);
  }

  async finish(eventId: string, destination: "archive" | "dead-letter", result: unknown): Promise<void> {
    const source = join(this.dir("pending"), filename(eventId));
    const target = join(this.dir(destination), filename(eventId));
    const stored = JSON.parse(await readFile(source, "utf8")) as StoredEvent;
    const handle = await open(`${target}.tmp`, "w", 0o600);
    try { await handle.writeFile(JSON.stringify({ ...stored, result, finishedAt: new Date().toISOString() })); await handle.sync(); }
    finally { await handle.close(); }
    await rename(`${target}.tmp`, target);
    await unlink(source);
  }
}

export async function deliverOne(spool: DurableSpool, apiBase: string, keys: Record<string, string>, stored: StoredEvent): Promise<"final" | "retry"> {
  const key = keys[stored.event.deviceId];
  if (!key) return "retry";
  try {
    const response = await fetch(`${apiBase.replace(/\/+$/, "")}/gate-events`, {
      method: "POST", headers: { "content-type": "application/json", "x-device-key": key },
      body: JSON.stringify(stored.event),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status >= 500) return "retry";
    await spool.finish(stored.event.eventId, response.ok ? "archive" : "dead-letter",
      { httpStatus: response.status, body });
    return "final";
  } catch { return "retry"; }
}
