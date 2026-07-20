import { randomUUID } from "node:crypto";

type EventType = "START" | "CHECKPOINT" | "STOP";
interface GateEvent { eventId: string; deviceId: string; laneId: string; gateId: string; type: EventType; deviceTs: number }
interface Reply { accepted: boolean; reason?: string }

const api = (process.env.STRESS_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const lanes = JSON.parse(process.env.STRESS_LANES ?? "[]") as Array<{ laneId: string; deviceId: string; key: string }>;
if (lanes.length < 2) throw new Error("STRESS_LANES must contain at least two {laneId,deviceId,key} entries");

async function send(lane: typeof lanes[number], event: GateEvent): Promise<Reply> {
  const response = await fetch(`${api}/gate-events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-key": lane.key },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`${event.eventId}: HTTP ${response.status} ${await response.text()}`);
  return response.json() as Promise<Reply>;
}

function event(lane: typeof lanes[number], type: EventType, ts: number, id = randomUUID()): GateEvent {
  return { eventId: `${lane.deviceId}-stress-${id}`, deviceId: lane.deviceId, laneId: lane.laneId,
    gateId: type === "START" ? "start" : type === "STOP" ? "stop" : "cp1", type, deviceTs: ts };
}

const [a, b] = lanes;
const startA = event(a, "START", 10_000);
const startB = event(b, "START", 20_000);
const starts = await Promise.all([send(a, startA), send(b, startB)]);
if (starts.some((reply) => !reply.accepted)) throw new Error(`Both lanes must be ARMED: ${JSON.stringify(starts)}`);

const duplicate = event(a, "CHECKPOINT", 11_000);
const storm = await Promise.all(Array.from({ length: 25 }, () => send(a, duplicate)));
if (storm.filter((reply) => reply.accepted).length !== 1 || storm.filter((reply) => reply.reason === "duplicate").length !== 24) {
  throw new Error(`Duplicate storm invariant failed: ${JSON.stringify(storm)}`);
}
const mutatedReplay = await send(a, { ...duplicate, laneId: b.laneId, deviceTs: 99_999 });
if (mutatedReplay.accepted || mutatedReplay.reason !== "duplicate") throw new Error("Global mutated-replay dedup failed");

const stops = await Promise.all([send(a, event(a, "STOP", 12_000)), send(b, event(b, "STOP", 23_000))]);
if (stops.some((reply) => !reply.accepted)) throw new Error(`Simultaneous STOP failed: ${JSON.stringify(stops)}`);
console.log("PASS two-lane-start duplicate-storm mutated-replay simultaneous-stop no-cross-talk");
