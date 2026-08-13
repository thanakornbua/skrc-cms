import type { GateEventType } from "./serial-bridge-core.js";

export function parseUnoLine(line: string, fallbackClockMs: number): { command: "TRIGGER" | "CLEAR"; deviceTs: number } | null {
  const match = /^(TRIGGER|CLEAR)(?:\s+(\d+))?$/.exec(line.trim().toUpperCase());
  if (!match) return null;
  const parsed = match[2] === undefined ? fallbackClockMs : Number(match[2]);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffffffff) return null;
  return { command: match[1] as "TRIGGER" | "CLEAR", deviceTs: parsed };
}

export function eventTypeForLane(state: string): GateEventType | null {
  if (state === "ARMED") return "START";
  if (state === "RUNNING") return "STOP";
  return null;
}

