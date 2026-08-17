import { MAX_ROBOT_WEIGHT_GRAMS, type InspectionResult, type InspectionStage } from "./types.js";
import type { CompetitorStatus } from "../competitors/types.js";

export function requiresPassedCheckIn(stage: InspectionStage): boolean {
  return stage === "PRE_COMPETITION";
}

export function advancesToInspected(
  status: CompetitorStatus,
  stage: InspectionStage,
  result: InspectionResult,
  checkInPassed: boolean
): boolean {
  return status === "CHECKED_IN" && stage === "PRE_COMPETITION" && result === "PASS" && checkInPassed;
}


/** Rule 3.2: at or under the limit passes; over it fails. */
export function weightResultFor(weightGrams: number, limitGrams = MAX_ROBOT_WEIGHT_GRAMS): InspectionResult {
  return weightGrams <= limitGrams ? "PASS" : "FAIL";
}

/**
 * An inspection passes only if every individual check passed. Derived on the
 * server so a measured 4500 g cannot be recorded as an overall PASS, which was
 * possible while the verdict was a free-standing button.
 */
export function overallInspectionResult(parts: {
  weightResult: InspectionResult;
  dimensionResult: InspectionResult;
  voltageResult: InspectionResult;
}): InspectionResult {
  return parts.weightResult === "PASS" && parts.dimensionResult === "PASS" && parts.voltageResult === "PASS"
    ? "PASS" : "FAIL";
}
