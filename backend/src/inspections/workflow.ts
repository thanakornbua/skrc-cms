import type { InspectionResult, InspectionStage } from "./types.js";
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

