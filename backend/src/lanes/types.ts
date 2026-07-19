export type LaneState = "IDLE" | "ASSIGNED" | "ARMED" | "RUNNING";

export interface LaneRecord {
  laneId: string;
  state: LaneState;
  competitorId: string | null;
  deviceId: string | null;
  armedBy: string | null;
  updatedAt: string | null;
}

export interface LaneConfigEntry {
  laneId: string;
  deviceId: string | null;
}
