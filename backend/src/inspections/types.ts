export type InspectionStage = "CHECK_IN" | "PRE_COMPETITION";
export type InspectionResult = "PASS" | "FAIL";

export interface WeightInspectionRecord {
  PK: string;
  SK: string;
  inspectionId: string;
  competitorId: string;
  stage: InspectionStage;
  weightGrams: number;
  result: InspectionResult;
  notes: string | null;
  byUser: string;
  at: string;
}

