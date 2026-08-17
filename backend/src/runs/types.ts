/**
 * Why a run ended at the stage maximum instead of at a STOP. Each value maps to
 * the rule that requires the attempt to be consumed rather than refunded.
 */
export type EndRunResolution =
  | "INTERVENTION_LIMIT"
  | "RESTART_LIMIT"
  | "STALLED"
  | "FORFEIT"
  | "GRACE_EXPIRED"
  | "NO_SHOW"
  | "OFFICIAL_STOP";

export interface RunSplit {
  gateId: string;
  deviceTs: number;
  splitMs: number;
}

export interface RunRecord {
  PK: string;
  SK: string;
  runId: string;
  /** Absent only on legacy records, which are interpreted as ROUND_1. */
  stage?: CompetitionStage;
  /**
   * Set when this run is a Rule 6.6 sudden-death attempt, holding the round it
   * belongs to. Such a run is granted on top of the three per stage, so it is
   * excluded from the consumed-attempt count and never folded into the stage
   * average — it only decides its own head-to-head.
   */
  suddenDeathRound?: number;
  laneId: string;
  startDeviceTs: number;
  stopDeviceTs: number | null;
  elapsedMs: number | null;
  splits: RunSplit[];
  /** Internal per-gate accepted timestamp used for atomic server debounce. */
  debounce: Record<string, number>;
  // Absent while in flight.
  status?: "COMPLETE" | "TIMED_OUT" | "UNDER_REVIEW" | "INVALID" | "VOID";
  minTimeMs: number;
  maxTimeMs: number;
  reviewResolution?: "CONSUME" | "VOID" | "CORRECTED" | "ADMIN_VOID" | EndRunResolution;
  reviewReason?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewedByName?: string;
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
import type { CompetitionStage } from "../competition/types.js";
