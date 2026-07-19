/**
 * Gate simulator — impersonates one ESP32 lane device against the Phase 7
 * `POST /gate-events` contract, so every timer phase can be tested before
 * real hardware exists (and alongside it afterwards).
 *
 * Usage (from ops/):
 *   npm run simulate-gates -- run [--checkpoints 2] [--duration 8000]
 *   npm run simulate-gates -- send START [--gate start] [--dup]
 *   npm run simulate-gates -- send CHECKPOINT --gate cp1
 *   npm run simulate-gates -- send STOP [--gate stop]
 *   npm run simulate-gates -- reboot
 *
 * Common flags:
 *   --api    http://localhost:3000     EC2 API base URL
 *   --device esp32-lane1               deviceId (must be a key in DEVICE_KEYS)
 *   --key    <device key>              or env SIM_DEVICE_KEY
 *   --lane   1                         laneId
 *
 * Mirrors firmware semantics: eventId = <deviceId>-<bootCount>-<seq> with
 * bootCount persisted across invocations (NVS analog: a local state file),
 * deviceTs = ms since "boot", retry only on transport failure/5xx, and a 200
 * with accepted:false is final.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

type GateEventType = "START" | "CHECKPOINT" | "STOP";

interface SimState {
  bootCount: number;
  seq: number;
  bootEpochMs: number;
}

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

function stateFile(deviceId: string): string {
  return join(STATE_DIR, `.sim-state-${deviceId}.json`);
}

function loadState(deviceId: string): SimState {
  try {
    return JSON.parse(readFileSync(stateFile(deviceId), "utf-8")) as SimState;
  } catch {
    return { bootCount: 1, seq: 0, bootEpochMs: Date.now() };
  }
}

function saveState(deviceId: string, state: SimState): void {
  writeFileSync(stateFile(deviceId), JSON.stringify(state, null, 2) + "\n");
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

interface GateEvent {
  eventId: string;
  deviceId: string;
  laneId: string;
  gateId: string;
  type: GateEventType;
  deviceTs: number;
}

interface GateEventResponse {
  accepted: boolean;
  reason?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Firmware retry semantics: transport failure / 5xx retries with backoff; any 2xx/4xx is final. */
async function postEvent(
  apiBase: string,
  deviceKey: string,
  event: GateEvent
): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${apiBase}/gate-events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": deviceKey,
        },
        body: JSON.stringify(event),
      });

      if (res.status >= 500) {
        console.error(`  ${event.eventId}: HTTP ${res.status} — retrying`);
      } else {
        const body = (await res.json().catch(() => ({}))) as GateEventResponse & {
          error?: { code: string; message: string };
        };
        if (res.ok) {
          console.log(
            `  ${event.eventId} ${event.type}@${event.deviceTs}ms → accepted=${body.accepted}` +
              (body.reason ? ` reason=${body.reason}` : "")
          );
        } else {
          console.error(
            `  ${event.eventId}: HTTP ${res.status} ${body.error?.code ?? ""} ${body.error?.message ?? ""} (final, not retried)`
          );
        }
        return;
      }
    } catch (err) {
      console.error(
        `  ${event.eventId}: transport error (${err instanceof Error ? err.message : err}) — retrying`
      );
    }
    if (attempt < maxAttempts) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
  }
  console.error(`  ${event.eventId}: gave up after ${maxAttempts} attempts`);
}

function buildEvent(
  deviceId: string,
  laneId: string,
  state: SimState,
  type: GateEventType,
  gateId: string
): GateEvent {
  state.seq += 1;
  return {
    eventId: `${deviceId}-${state.bootCount}-${String(state.seq).padStart(5, "0")}`,
    deviceId,
    laneId,
    gateId,
    type,
    deviceTs: Date.now() - state.bootEpochMs,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  const apiBase = (flag(args, "api") ?? process.env.SIM_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const deviceId = flag(args, "device") ?? "esp32-lane1";
  const laneId = flag(args, "lane") ?? "1";
  const deviceKey = flag(args, "key") ?? process.env.SIM_DEVICE_KEY;

  if (command === "reboot") {
    const state = loadState(deviceId);
    saveState(deviceId, { bootCount: state.bootCount + 1, seq: 0, bootEpochMs: Date.now() });
    console.log(`${deviceId}: bootCount → ${state.bootCount + 1}, seq reset`);
    return;
  }

  if (!deviceKey) {
    console.error("Missing device key: pass --key or set SIM_DEVICE_KEY (must match the API's DEVICE_KEYS entry)");
    process.exit(1);
  }

  const state = loadState(deviceId);

  if (command === "send") {
    const type = args[1] as GateEventType;
    if (!["START", "CHECKPOINT", "STOP"].includes(type)) {
      console.error("send requires a type: START | CHECKPOINT | STOP");
      process.exit(1);
    }
    const defaultGate = type === "START" ? "start" : type === "STOP" ? "stop" : "cp1";
    const gateId = flag(args, "gate") ?? defaultGate;

    const event = buildEvent(deviceId, laneId, state, type, gateId);
    saveState(deviceId, state);
    console.log(`Sending ${type} on lane ${laneId} as ${deviceId}:`);
    await postEvent(apiBase, deviceKey, event);

    if (hasFlag(args, "dup")) {
      console.log("Replaying the identical event (dedup test — expect accepted=false reason=duplicate):");
      await postEvent(apiBase, deviceKey, event);
    }
    return;
  }

  if (command === "run") {
    const checkpoints = Number(flag(args, "checkpoints") ?? 2);
    const durationMs = Number(flag(args, "duration") ?? 8000);
    if (!Number.isFinite(checkpoints) || checkpoints < 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
      console.error("run requires --checkpoints >= 0 and --duration > 0 (ms)");
      process.exit(1);
    }

    console.log(
      `Simulating a full run on lane ${laneId} as ${deviceId}: START, ${checkpoints} checkpoint(s), STOP after ~${durationMs}ms`
    );
    console.log("(The lane must be ARMED first: assign + arm it in /admin/lanes.)");

    const start = buildEvent(deviceId, laneId, state, "START", "start");
    saveState(deviceId, state);
    await postEvent(apiBase, deviceKey, start);

    const interval = durationMs / (checkpoints + 1);
    for (let i = 1; i <= checkpoints; i++) {
      await sleep(interval);
      const cp = buildEvent(deviceId, laneId, state, "CHECKPOINT", `cp${i}`);
      saveState(deviceId, state);
      await postEvent(apiBase, deviceKey, cp);
    }

    await sleep(interval);
    const stop = buildEvent(deviceId, laneId, state, "STOP", "stop");
    saveState(deviceId, state);
    await postEvent(apiBase, deviceKey, stop);

    console.log(
      `Done. Expected elapsedMs ≈ ${stop.deviceTs - start.deviceTs} (exact — device-clock arithmetic).`
    );
    return;
  }

  console.error("Usage: simulate-gates <run|send|reboot> [flags] — see the header comment in ops/src/simulate-gates.ts");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
