export interface RunSplit {
  gateId: string;
  deviceTs: number;
  splitMs: number;
}

export interface RunRecord {
  PK: string;
  SK: string;
  runId: string;
  laneId: string;
  startDeviceTs: number;
  stopDeviceTs: number | null;
  elapsedMs: number | null;
  splits: RunSplit[];
  // Absent while in flight.
  status?: "COMPLETE" | "TIMED_OUT" | "UNDER_REVIEW" | "INVALID" | "VOID";
  minTimeMs: number;
  maxTimeMs: number;
  reviewResolution?: "CONSUME" | "VOID" | "CORRECTED";
  reviewReason?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  createdAt: string;
}

export interface GateEventInput {
  eventId: string;
  deviceId: string;
  laneId: string;
  gateId: string;
  type: "START" | "CHECKPOINT" | "STOP";
  deviceTs: number;
}
