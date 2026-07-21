export type LaneState = "IDLE" | "ASSIGNED" | "ARMED" | "RUNNING";

export interface LaneRecord {
  laneId: string;
  state: LaneState;
  competitorId: string | null;
  deviceId: string | null;
  armedBy: string | null;
  /** Server time the lane entered RUNNING from a device START event; null outside RUNNING. */
  runStartedAt: string | null;
  updatedAt: string | null;
}

export interface LaneConfigEntry {
  laneId: string;
  deviceId: string | null;
}
