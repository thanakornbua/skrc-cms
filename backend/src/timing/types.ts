import type { CompetitionStage } from "../competition/types.js";

export interface CategoryTiming {
  category: string;
  minTimeMs: number;
  /** Legacy fallback retained while old configurations are migrated. */
  maxTimeMs: number;
  stageMaxTimeMs?: Record<CompetitionStage, number>;
  updatedAt: string;
  updatedBy: string;
}

export interface PenaltyRule {
  ruleId: string;
  label: string;
  penaltyMs: number;
  active: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface AppliedPenalty {
  SK: string;
  ruleId: string;
  label: string;
  penaltyMs: number;
  byUser: string;
  at: string;
  stage?: CompetitionStage;
  revocation?: { reason: string; byUser: string; at: string };
}

export interface TimeCorrection {
  runId: string;
  elapsedMs: number;
  reason: string;
  byUser: string;
  at: string;
  stage?: CompetitionStage;
}

export interface TimeResult {
  aggregateTimeMs: number | null;
  penaltyTimeMs: number;
  finalTimeMs: number | null;
  qualifyingRunIds: string[];
  tieTimestamp: string | null;
}
