import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddbDoc, TABLE_NAME } from "../db/client.js";
import { ApiError } from "../errors.js";
import { stampCompetitorId } from "./cognito.js";
import type {
  ApprovalInfo,
  Category,
  CertificateLanguage,
  CompetitorRecord,
  PdpaConsent,
  RegistrationRecord,
  StudentFoodAllergies,
  StudentNames,
} from "./types.js";

const CLAIM_STALE_AFTER_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function keyReg(sub: string) {
  return { PK: `REG#${sub}`, SK: "PROFILE" };
}

function keyComp(competitorId: string) {
  return { PK: `COMP#${competitorId}`, SK: "PROFILE" };
}

const COUNTER_KEY = { PK: "CONFIG#COUNTER", SK: "COMPETITORID" };

interface RawRegistrationItem {
  PK: string;
  SK: string;
  name: string;
  teamName: string;
  category: Category;
  school?: string;
  certificateLanguage?: CertificateLanguage;
  advisorNameThai?: string;
  advisorNameEnglish?: string;
  advisorEmail?: string;
  advisorPhone?: string;
  contactEmail: string;
  contactPhone: string;
  student1NameThai: string;
  student1NameEnglish: string;
  student2NameThai: string;
  student2NameEnglish: string;
  student3NameThai: string;
  student3NameEnglish: string;
  student1FoodAllergy?: string;
  student2FoodAllergy?: string;
  student3FoodAllergy?: string;
  pdpaConsent: PdpaConsent;
  status: RegistrationRecord["status"];
  rejection: RegistrationRecord["rejection"];
  approval: RegistrationRecord["approval"];
  createdAt: string;
  approving?: string;
}

function fromRawRegistration(item: RawRegistrationItem): RegistrationRecord {
  return {
    sub: item.PK.replace(/^REG#/, ""),
    name: item.name,
    teamName: item.teamName,
    category: item.category,
    school: item.school ?? "",
    certificateLanguage: item.certificateLanguage ?? "BILINGUAL",
    advisorNameThai: item.advisorNameThai ?? "",
    advisorNameEnglish: item.advisorNameEnglish ?? "",
    advisorEmail: item.advisorEmail ?? "",
    advisorPhone: item.advisorPhone ?? "",
    contactEmail: item.contactEmail,
    contactPhone: item.contactPhone,
    student1NameThai: item.student1NameThai,
    student1NameEnglish: item.student1NameEnglish,
    student2NameThai: item.student2NameThai,
    student2NameEnglish: item.student2NameEnglish,
    student3NameThai: item.student3NameThai,
    student3NameEnglish: item.student3NameEnglish,
    student1FoodAllergy: item.student1FoodAllergy ?? "NONE",
    student2FoodAllergy: item.student2FoodAllergy ?? "NONE",
    student3FoodAllergy: item.student3FoodAllergy ?? "NONE",
    pdpaConsent: item.pdpaConsent,
    status: item.status,
    rejection: item.rejection ?? null,
    approval: item.approval ?? null,
    createdAt: item.createdAt,
  };
}

export async function getRegistrationBySub(
  sub: string
): Promise<RegistrationRecord | null> {
  const result = await ddbDoc.send(
    new GetCommand({ TableName: TABLE_NAME, Key: keyReg(sub) })
  );
  if (!result.Item) return null;
  return fromRawRegistration(result.Item as RawRegistrationItem);
}

export async function getCompetitor(
  competitorId: string
): Promise<CompetitorRecord | null> {
  const result = await ddbDoc.send(
    new GetCommand({ TableName: TABLE_NAME, Key: keyComp(competitorId) })
  );
  return (result.Item as CompetitorRecord | undefined) ?? null;
}

export async function createRegistration(input: StudentNames & StudentFoodAllergies & {
  sub: string;
  name: string;
  teamName: string;
  category: Category;
  school: string;
  certificateLanguage: CertificateLanguage;
  advisorNameThai: string;
  advisorNameEnglish: string;
  advisorEmail: string;
  advisorPhone: string;
  contactEmail: string;
  contactPhone: string;
  pdpaConsentVersion: string;
  pdpaAuthorityConfirmed: true;
}): Promise<void> {
  const createdAt = new Date().toISOString();
  const deleteByDate = new Date(createdAt);
  const originalDay = deleteByDate.getUTCDate();
  deleteByDate.setUTCDate(1);
  deleteByDate.setUTCMonth(deleteByDate.getUTCMonth() + 6);
  const lastDayOfTargetMonth = new Date(Date.UTC(
    deleteByDate.getUTCFullYear(),
    deleteByDate.getUTCMonth() + 1,
    0
  )).getUTCDate();
  deleteByDate.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  const pdpaConsent: PdpaConsent = {
    accepted: true,
    version: input.pdpaConsentVersion,
    at: createdAt,
    retentionMonths: 6,
    deleteBy: deleteByDate.toISOString(),
    authorityConfirmed: input.pdpaAuthorityConfirmed,
    language: "th-en",
  };
  try {
    await ddbDoc.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...keyReg(input.sub),
          name: input.name,
          teamName: input.teamName,
          category: input.category,
          school: input.school,
          certificateLanguage: input.certificateLanguage,
          advisorNameThai: input.advisorNameThai,
          advisorNameEnglish: input.advisorNameEnglish,
          advisorEmail: input.advisorEmail,
          advisorPhone: input.advisorPhone,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          student1NameThai: input.student1NameThai,
          student1NameEnglish: input.student1NameEnglish,
          student2NameThai: input.student2NameThai,
          student2NameEnglish: input.student2NameEnglish,
          student3NameThai: input.student3NameThai,
          student3NameEnglish: input.student3NameEnglish,
          student1FoodAllergy: input.student1FoodAllergy,
          student2FoodAllergy: input.student2FoodAllergy,
          student3FoodAllergy: input.student3FoodAllergy,
          pdpaConsent,
          status: "PENDING_APPROVAL",
          rejection: null,
          approval: null,
          createdAt,
          GSI1PK: "REGISTRATION",
          GSI1SK: `PENDING_APPROVAL#${createdAt}`,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new ApiError(
        409,
        "CONFLICT",
        "A registration already exists for this account"
      );
    }
    throw err;
  }
}

export async function listPendingRegistrations(): Promise<RegistrationRecord[]> {
  const result = await ddbDoc.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": "REGISTRATION",
        ":prefix": "PENDING_APPROVAL#",
      },
    })
  );
  return (result.Items ?? []).map((item) =>
    fromRawRegistration(item as RawRegistrationItem)
  );
}

async function mintCompetitorId(): Promise<string> {
  const result = await ddbDoc.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: COUNTER_KEY,
      UpdateExpression: "ADD #value :incr",
      ExpressionAttributeNames: { "#value": "value" },
      ExpressionAttributeValues: { ":incr": 1 },
      ReturnValues: "UPDATED_NEW",
    })
  );
  const value = (result.Attributes?.value as number) ?? 0;
  return `C-${String(value).padStart(4, "0")}`;
}

/**
 * Two concurrent approve calls on the same registration must produce exactly
 * one competitorId. A single conditional UpdateItem on the Registration acts
 * as the compare-and-swap lock (DynamoDB serializes writes per item), so only
 * one caller ever "wins" the claim; the other polls for the winner's result.
 * The claim carries a timestamp (not a bare boolean) so a claim abandoned by
 * a crashed/timed-out Lambda invocation can be safely re-claimed after
 * CLAIM_STALE_AFTER_MS instead of wedging the registration forever.
 */
export async function approveRegistration(
  sub: string,
  byUser: string
): Promise<{ competitorId: string; status: "APPROVED" }> {
  const existing = await getRegistrationBySub(sub);
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Registration not found");
  if (!existing.pdpaConsent?.accepted) {
    throw new ApiError(409, "CONSENT_REQUIRED", "PDPA consent is required before approval");
  }
  if (existing.status === "APPROVED" && existing.approval) {
    return { competitorId: existing.approval.competitorId, status: "APPROVED" };
  }

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - CLAIM_STALE_AFTER_MS).toISOString();

  let won = false;
  try {
    await ddbDoc.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: keyReg(sub),
        UpdateExpression: "SET approving = :now",
        ConditionExpression:
          "(#status = :pending OR #status = :rejected) AND (attribute_not_exists(approving) OR approving < :staleCutoff)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":now": now.toISOString(),
          ":pending": "PENDING_APPROVAL",
          ":rejected": "REJECTED",
          ":staleCutoff": staleCutoff,
        },
      })
    );
    won = true;
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }

  if (won) {
    const competitorId = await mintCompetitorId();
    const approval: ApprovalInfo = {
      byUser,
      at: new Date().toISOString(),
      competitorId,
    };
    await finalizeApproval(sub, existing, approval);
    return { competitorId, status: "APPROVED" };
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(50 + attempt * 25);
    const current = await getRegistrationBySub(sub);
    if (current?.status === "APPROVED" && current.approval) {
      return { competitorId: current.approval.competitorId, status: "APPROVED" };
    }
  }
  throw new ApiError(
    500,
    "INTERNAL_ERROR",
    "Approval is taking longer than expected — retry"
  );
}

async function finalizeApproval(
  sub: string,
  reg: RegistrationRecord,
  approval: ApprovalInfo
): Promise<void> {
  await createCompetitorItem(reg, approval);
  await stampCompetitorId(sub, approval.competitorId);
  await markRegistrationApproved(sub, approval);
}

async function createCompetitorItem(
  reg: RegistrationRecord,
  approval: ApprovalInfo
): Promise<void> {
  const createdAt = new Date().toISOString();
  try {
    await ddbDoc.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...keyComp(approval.competitorId),
          competitorId: approval.competitorId,
          name: reg.name,
          teamName: reg.teamName,
          category: reg.category,
          school: reg.school,
          certificateLanguage: reg.certificateLanguage,
          advisorNameThai: reg.advisorNameThai,
          advisorNameEnglish: reg.advisorNameEnglish,
          advisorEmail: reg.advisorEmail,
          advisorPhone: reg.advisorPhone,
          contactEmail: reg.contactEmail,
          contactPhone: reg.contactPhone,
          student1NameThai: reg.student1NameThai,
          student1NameEnglish: reg.student1NameEnglish,
          student2NameThai: reg.student2NameThai,
          student2NameEnglish: reg.student2NameEnglish,
          student3NameThai: reg.student3NameThai,
          student3NameEnglish: reg.student3NameEnglish,
          student1FoodAllergy: reg.student1FoodAllergy,
          student2FoodAllergy: reg.student2FoodAllergy,
          student3FoodAllergy: reg.student3FoodAllergy,
          pdpaConsent: reg.pdpaConsent,
          cognitoSub: reg.sub,
          status: "REGISTERED",
          disqualified: { bool: false, reason: null, byUser: null, at: null },
          checkedInAt: null,
          checkedInBy: null,
          inspectedAt: null,
          createdAt,
          GSI1PK: "COMPETITOR",
          GSI1SK: `${reg.category}#REGISTERED#${approval.competitorId}`,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
  } catch (err) {
    // Already created by an earlier attempt that crashed before finishing
    // the remaining finalize steps — safe to continue (repo.ts's approval
    // claim guarantees only one caller ever reaches here per competitorId).
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }
}

async function markRegistrationApproved(
  sub: string,
  approval: ApprovalInfo
): Promise<void> {
  await ddbDoc.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keyReg(sub),
      UpdateExpression:
        "SET #status = :approved, approval = :approval, GSI1SK = :gsi1sk REMOVE approving",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":approved": "APPROVED",
        ":approval": approval,
        ":gsi1sk": `APPROVED#${new Date().toISOString()}`,
      },
    })
  );
}

export async function rejectRegistration(
  sub: string,
  reason: string,
  byUser: string
): Promise<void> {
  const at = new Date().toISOString();
  try {
    await ddbDoc.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: keyReg(sub),
        UpdateExpression:
          "SET #status = :rejected, rejection = :rejection, GSI1SK = :gsi1sk",
        ConditionExpression: "attribute_exists(PK) AND #status = :pending",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":rejected": "REJECTED",
          ":pending": "PENDING_APPROVAL",
          ":rejection": { reason, byUser, at },
          ":gsi1sk": `REJECTED#${at}`,
        },
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      const current = await getRegistrationBySub(sub);
      if (!current) throw new ApiError(404, "NOT_FOUND", "Registration not found");
      throw new ApiError(
        409,
        "CONFLICT",
        `Cannot reject a registration with status ${current.status}`
      );
    }
    throw err;
  }
}

/**
 * D18 CSV export. Full-table Scan filtered by GSI1PK — fine at this scale
 * (< 500 items); pages through in case the event outgrows one 1 MB scan page.
 */
export async function scanAllByEntityType(
  entityType: "REGISTRATION" | "COMPETITOR"
): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddbDoc.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "GSI1PK = :entityType",
        ExpressionAttributeValues: { ":entityType": entityType },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...((result.Items as Array<Record<string, unknown>>) ?? []));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}
