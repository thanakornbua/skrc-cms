export interface CategoryTiming {
  category: string;
  minTimeMs: number;
  maxTimeMs: number;
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
  revocation?: { reason: string; byUser: string; at: string };
}

export interface TimeCorrection {
  runId: string;
  elapsedMs: number;
  reason: string;
  byUser: string;
  at: string;
}

export interface TimeResult {
  aggregateTimeMs: number | null;
  penaltyTimeMs: number;
  finalTimeMs: number | null;
  qualifyingRunIds: string[];
  tieTimestamp: string | null;
}
