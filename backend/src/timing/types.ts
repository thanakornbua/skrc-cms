import type { CompetitionStage } from "../competition/types.js";

export interface CategoryTiming {
  category: string;
  minTimeMs: number;
  /** Legacy fallback retained while old configurations are migrated. */
  maxTimeMs: number;
  stageMaxTimeMs?: Record<CompetitionStage, number>;
  updatedAt: string;
  updatedBy: string;
  updatedByName?: string;
}

export interface PenaltyRule {
  ruleId: string;
  label: string;
  penaltyMs: number;
  active: boolean;
  /**
   * "INTERVENTION" marks this rule as Rule 7.3's unauthorized-intervention
   * penalty. Applying it a third time against the same run auto-ends that run
   * (Rule 7.3(3)) instead of merely adding a fourth time charge. Unset for any
   * other, organizer-defined penalty, which never has that side effect.
   */
  kind?: "INTERVENTION";
  updatedAt: string;
  updatedBy: string;
  updatedByName?: string;
}

export interface AppliedPenalty {
  SK: string;
  ruleId: string;
  label: string;
  penaltyMs: number;
  byUser: string;
  byUserName?: string;
  at: string;
  stage?: CompetitionStage;
  /**
   * The rule's kind, snapshotted at application time like `label` and
   * `penaltyMs` (Rule 7.1(2)). Rule 7.3(3) counts interventions per attempt
   * however they were cited, so the count reads this rather than matching on
   * `ruleId` — two organizer-defined intervention rules still share one limit.
   */
  kind?: "INTERVENTION";
  /** The run this occurrence happened during, when applied while a run was active. Required to count Rule 7.3(3)'s per-attempt intervention limit. */
  runId?: string;
  revocation?: { reason: string; byUser: string; byUserName?: string; at: string };
}

export interface TimeCorrection {
  runId: string;
  elapsedMs: number;
  reason: string;
  byUser: string;
  byUserName?: string;
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
