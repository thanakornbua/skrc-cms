/**
 * Inspection happens at check-in, before the competition proper, and again
 * before each competition round — Rule 3.7(1) gives organizers standing
 * inspection authority rather than a single gate.
 */
export type InspectionStage =
  | "CHECK_IN"
  | "PRE_COMPETITION"
  | "ROUND_1"
  | "BEST_OF_4"
  | "BEST_OF_2"
  | "THE_BEST";

export const INSPECTION_STAGES: InspectionStage[] = [
  "CHECK_IN", "PRE_COMPETITION", "ROUND_1", "BEST_OF_4", "BEST_OF_2", "THE_BEST",
];

/**
 * Rule 3.2 fixes the maximum robot weight, battery included, at 4000 g. It is
 * a rule constant, not an organizer setting, so the system checks the inspector's
 * measurement against it instead of leaving pass/fail to an unaided judgement call.
 */
export const MAX_ROBOT_WEIGHT_GRAMS = 4000;
export type InspectionResult = "PASS" | "FAIL";

export interface WeightInspectionRecord {
  PK: string;
  SK: string;
  inspectionId: string;
  competitorId: string;
  stage: InspectionStage;
  weightGrams: number;
  /** Rule 3.2 — derived by the server from weightGrams, never sent by the client. */
  weightResult: InspectionResult;
  weightLimitGrams: number;
  /** Rule 3.1 — max 200 x 300 x 200 mm, judged by the inspector. */
  dimensionResult: InspectionResult;
  /** Rule 3.3 — 24 VDC ceiling, judged by the inspector. */
  voltageResult: InspectionResult;
  /** PASS only when every check above passed. Derived, never sent by the client. */
  result: InspectionResult;
  notes: string | null;
  byUser: string;
  byUserName?: string;
  at: string;
}

