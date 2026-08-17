export const COMPETITION_STAGES = ["ROUND_1", "BEST_OF_4", "BEST_OF_2", "THE_BEST"] as const;
export type CompetitionStage = (typeof COMPETITION_STAGES)[number];
export type CompetitionPhase = "OPEN" | "CONCLUDED";
export type ScoringMode = "CHECKPOINT_LAP" | "TIME_AVERAGE";
export const ATTEMPTS_PER_ROUND = 3;

export const STAGE_LABELS: Record<CompetitionStage, string> = {
  ROUND_1: "Qualifying round",
  BEST_OF_4: "Quarterfinals",
  BEST_OF_2: "Semifinals",
  THE_BEST: "Finals",
};

export const STAGE_SCORING: Record<CompetitionStage, ScoringMode> = {
  ROUND_1: "TIME_AVERAGE",
  BEST_OF_4: "TIME_AVERAGE",
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
  // Both semifinal winners and losers continue: final + third-place match.
  BEST_OF_2: 4,
};

export interface StageRankedResult {
  rank: number;
  competitorId?: string;
  teamName: string;
  stage: CompetitionStage;
  scoringMode: ScoringMode;
  completedLap: boolean;
  completedRunCount: number;
  lapTimeMs: number | null;
  secondBestTimeMs: number | null;
  furthestCheckpoint: number;
  aggregateTimeMs: number | null;
  penaltyTimeMs: number;
  finalTimeMs: number | null;
  tieTimestamp: string | null;
}

export type BracketRound = "QUARTERFINAL" | "SEMIFINAL" | "FINAL" | "THIRD_PLACE";

/**
 * One Rule 6.6 sudden-death round. Each round grants both teams a single extra
 * attempt and re-randomises who runs first (6.6(2)); rounds repeat until one
 * team wins (6.6(5)), so this is a list rather than a flag.
 */
export interface SuddenDeathRound {
  round: number;
  startsFirstId: string;
  openedAt: string;
  openedBy: string;
  openedByName?: string;
}

/** Rule 6.6(6): the match could not continue, so it was settled off the track. */
export interface AdministrativeDecision {
  winnerId: string;
  reason: string;
  byUser: string;
  byUserName?: string;
  at: string;
}

export interface BracketMatch {
  matchId: string;
  round: BracketRound;
  order: number;
  teamAId: string;
  teamBId: string;
  startsFirstId: string;
  winnerId: string | null;
  completedAt: string | null;
  suddenDeath?: SuddenDeathRound[];
  administrativeDecision?: AdministrativeDecision;
}

export interface CompetitionBracket {
  category: string;
  drawnAt: string;
  drawnBy: string;
  positions: Array<{ position: number; competitorId: string; teamName: string }>;
  matches: BracketMatch[];
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
  brackets?: CompetitionBracket[];
  concludedAt?: string;
  concludedBy?: string;
  concludedByName?: string;
  results?: CategoryStageResults[];
  updatedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
}
