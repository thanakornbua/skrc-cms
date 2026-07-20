export const COMPETITION_STAGES = ["ROUND_1", "BEST_OF_4", "BEST_OF_2", "THE_BEST"] as const;
export type CompetitionStage = (typeof COMPETITION_STAGES)[number];
export type CompetitionPhase = "OPEN" | "CONCLUDED";
export type ScoringMode = "CHECKPOINT_LAP" | "TIME_AVERAGE";

export const STAGE_LABELS: Record<CompetitionStage, string> = {
  ROUND_1: "Round 1",
  BEST_OF_4: "Best of 4",
  BEST_OF_2: "Best of 2",
  THE_BEST: "The Best",
};

export const STAGE_SCORING: Record<CompetitionStage, ScoringMode> = {
  ROUND_1: "CHECKPOINT_LAP",
  BEST_OF_4: "CHECKPOINT_LAP",
  BEST_OF_2: "TIME_AVERAGE",
  THE_BEST: "TIME_AVERAGE",
};

export const NEXT_STAGE: Partial<Record<CompetitionStage, CompetitionStage>> = {
  ROUND_1: "BEST_OF_4",
  BEST_OF_4: "BEST_OF_2",
  BEST_OF_2: "THE_BEST",
};

export const ADVANCEMENT_COUNT: Partial<Record<CompetitionStage, number>> = {
  ROUND_1: 8,
  BEST_OF_4: 4,
  BEST_OF_2: 2,
};

export interface StageRankedResult {
  rank: number;
  competitorId?: string;
  teamName: string;
  stage: CompetitionStage;
  scoringMode: ScoringMode;
  completedLap: boolean;
  lapTimeMs: number | null;
  furthestCheckpoint: number;
  aggregateTimeMs: number | null;
  penaltyTimeMs: number;
  finalTimeMs: number | null;
  tieTimestamp: string | null;
}
export interface CategoryStageResults {
  category: string;
  stage: CompetitionStage;
  scoringMode: ScoringMode;
  ranked: StageRankedResult[];
  unranked: Array<{ teamName: string; competitorId?: string }>;
  disqualified: Array<{ teamName: string; competitorId?: string }>;
}

export interface CompetitionState {
  phase: CompetitionPhase;
  activeStage: CompetitionStage;
  eligibleCompetitorIds?: string[];
  stageResults?: Partial<Record<CompetitionStage, CategoryStageResults[]>>;
  concludedAt?: string;
  concludedBy?: string;
  results?: CategoryStageResults[];
  updatedAt?: string;
  updatedBy?: string;
}
