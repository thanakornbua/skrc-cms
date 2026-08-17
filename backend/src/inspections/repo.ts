import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import { ApiError } from "../errors.js";
import { getCompetitor } from "../competitors/repo.js";
import { MAX_ROBOT_WEIGHT_GRAMS, type InspectionResult, type InspectionStage, type WeightInspectionRecord } from "./types.js";
import { advancesToInspected, overallInspectionResult, requiresPassedCheckIn, weightResultFor } from "./workflow.js";
import type { Actor } from "../auth/types.js";

export interface RecordWeightInspectionInput {
  inspectionId?: string;
  stage: InspectionStage;
  weightGrams: number;
  dimensionResult: InspectionResult;
  voltageResult: InspectionResult;
  notes?: string;
}

function inspectionKey(competitorId: string, stage: InspectionStage, inspectionId: string) {
  return { PK: `COMP#${competitorId}`, SK: `INSPECTION#${stage}#${inspectionId}` };
}

export async function listWeightInspections(competitorId: string): Promise<WeightInspectionRecord[]> {
  const response = await ddbDoc.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: { ":pk": `COMP#${competitorId}`, ":prefix": "INSPECTION#" },
    ConsistentRead: true,
  }));
  return ((response.Items ?? []) as WeightInspectionRecord[])
    .sort((a, b) => a.at.localeCompare(b.at));
}

async function existingInspection(
  competitorId: string,
  stage: InspectionStage,
  inspectionId: string
): Promise<WeightInspectionRecord | null> {
  const response = await ddbDoc.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: inspectionKey(competitorId, stage, inspectionId),
    ConsistentRead: true,
  }));
  return (response.Item as WeightInspectionRecord | undefined) ?? null;
}

export async function recordWeightInspection(
  competitorId: string,
  input: RecordWeightInspectionInput,
  byUser: Actor
): Promise<{ inspection: WeightInspectionRecord; status: string; inspectedAt: string | null; duplicate: boolean }> {
  const competitor = await getCompetitor(competitorId);
  if (!competitor) throw new ApiError(404, "NOT_FOUND", "Competitor not found");
  if (competitor.status === "REGISTERED") {
    throw new ApiError(409, "NOT_CHECKED_IN", "Competitor must check in before weighing");
  }

  // Rule 3.2 is checked against the measurement rather than left to the
  // inspector's button press; 3.1 and 3.3 stay human judgements. The overall
  // verdict is the conjunction, so an over-weight robot cannot be passed.
  const weightResult = weightResultFor(input.weightGrams);
  const result = overallInspectionResult({
    weightResult, dimensionResult: input.dimensionResult, voltageResult: input.voltageResult,
  });

  const inspectionId = input.inspectionId ?? randomUUID();
  const key = inspectionKey(competitorId, input.stage, inspectionId);
  const inspection: WeightInspectionRecord = {
    ...key,
    inspectionId,
    competitorId,
    stage: input.stage,
    weightGrams: input.weightGrams,
    weightResult,
    weightLimitGrams: MAX_ROBOT_WEIGHT_GRAMS,
    dimensionResult: input.dimensionResult,
    voltageResult: input.voltageResult,
    result,
    notes: input.notes?.trim() || null,
    byUser: byUser.id,
    byUserName: byUser.name,
    at: new Date().toISOString(),
  };

  let checkInPassed = false;
  if (requiresPassedCheckIn(input.stage)) {
    const prior = await listWeightInspections(competitorId);
    checkInPassed = prior.some((item) => item.stage === "CHECK_IN" && item.result === "PASS");
    if (!checkInPassed) {
      throw new ApiError(
        409,
        "CHECK_IN_INSPECTION_REQUIRED",
        "A passed check-in weight inspection is required first"
      );
    }
  }

  const shouldAdvance = advancesToInspected(competitor.status, input.stage, result, checkInPassed);

  try {
    if (shouldAdvance) {
      await ddbDoc.send(new TransactWriteCommand({ TransactItems: [
        { Put: {
          TableName: TABLE_NAME,
          Item: inspection,
          ConditionExpression: "attribute_not_exists(PK)",
        } },
        { Update: {
          TableName: TABLE_NAME,
          Key: { PK: `COMP#${competitorId}`, SK: "PROFILE" },
          UpdateExpression: "SET #status = :inspected, inspectedAt = :at, GSI1SK = :gsi1sk",
          ConditionExpression: "#status = :checkedIn",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":inspected": "INSPECTED",
            ":checkedIn": "CHECKED_IN",
            ":at": inspection.at,
            ":gsi1sk": `${competitor.category}#INSPECTED#${competitorId}`,
          },
        } },
      ] }));
    } else {
      await ddbDoc.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: inspection,
        ConditionExpression: "attribute_not_exists(PK)",
      }));
    }
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException || error instanceof TransactionCanceledException) {
      const duplicate = await existingInspection(competitorId, input.stage, inspectionId);
      if (duplicate) {
        if (duplicate.weightGrams !== input.weightGrams || duplicate.result !== result ||
            duplicate.dimensionResult !== input.dimensionResult ||
            duplicate.voltageResult !== input.voltageResult ||
            duplicate.notes !== (input.notes?.trim() || null)) {
          throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "inspectionId was already used with different values");
        }
        const current = await getCompetitor(competitorId);
        return {
          inspection: duplicate,
          status: current?.status ?? competitor.status,
          inspectedAt: current?.inspectedAt ?? null,
          duplicate: true,
        };
      }
      if (shouldAdvance) {
        const current = await getCompetitor(competitorId);
        if (current && current.status !== "CHECKED_IN" && current.status !== "REGISTERED") {
          try {
            await ddbDoc.send(new PutCommand({
              TableName: TABLE_NAME,
              Item: inspection,
              ConditionExpression: "attribute_not_exists(PK)",
            }));
            return {
              inspection,
              status: current.status,
              inspectedAt: current.inspectedAt,
              duplicate: false,
            };
          } catch (putError) {
            if (!(putError instanceof ConditionalCheckFailedException)) throw putError;
          }
        }
      }
    }
    throw error;
  }

  return {
    inspection,
    status: shouldAdvance ? "INSPECTED" : competitor.status,
    inspectedAt: shouldAdvance ? inspection.at : competitor.inspectedAt,
    duplicate: false,
  };
}
