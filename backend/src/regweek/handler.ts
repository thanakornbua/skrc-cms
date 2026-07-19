import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { z } from "zod";
import { ApiError, zodToFields } from "../errors.js";
import {
  authenticate,
  requireAdminOnly,
  requireCompetitorOnly,
  requireRole,
} from "./auth.js";
import {
  approveRegistration,
  createRegistration,
  getCompetitor,
  getRegistrationBySub,
  listPendingRegistrations,
  rejectRegistration,
  scanAllByEntityType,
} from "./repo.js";
import { errorResponse, jsonResponse } from "./responses.js";
import { CATEGORIES } from "./types.js";

export const PDPA_CONSENT_VERSION = "2026-07-20-v2";

const thaiName = z.string().trim().min(2).max(120).refine(
  (value) => /[\u0E00-\u0E7F]/.test(value),
  "กรุณากรอกชื่อภาษาไทย / Please enter a Thai name"
);
const englishName = z.string().trim().min(2).max(120).refine(
  (value) => /[A-Za-z]/.test(value),
  "กรุณากรอกชื่อภาษาอังกฤษ / Please enter an English name"
);

const registerSchema = z.object({
  teamName: z.string().trim().min(2).max(100),
  category: z.enum(CATEGORIES),
  student1NameThai: thaiName,
  student1NameEnglish: englishName,
  contactEmail: z.string().trim().email().max(254),
  contactPhone: z.string().trim().regex(/^[0-9+() -]{8,20}$/, "กรุณากรอกหมายเลขโทรศัพท์ที่ถูกต้อง / Invalid phone number"),
  student2NameThai: thaiName,
  student2NameEnglish: englishName,
  student3NameThai: thaiName,
  student3NameEnglish: englishName,
  pdpaConsent: z.literal(true, {
    errorMap: () => ({ message: "ต้องยอมรับความยินยอม PDPA / PDPA consent is required" }),
  }),
  pdpaAuthorityConfirmed: z.literal(true, {
    errorMap: () => ({ message: "ต้องยืนยันอำนาจในการให้ข้อมูล / Authority confirmation is required" }),
  }),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(1),
});

function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf-8")
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "Malformed JSON body");
  }
}

async function handleRegister(
  event: APIGatewayProxyEventV2,
  sub: string
): Promise<APIGatewayProxyResultV2> {
  const parsed = registerSchema.safeParse(parseBody(event));
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid registration payload", zodToFields(parsed.error));
  }
  const input = parsed.data;

  await createRegistration({
    sub,
    name: input.student1NameEnglish,
    teamName: input.teamName,
    category: input.category,
    student1NameThai: input.student1NameThai,
    student1NameEnglish: input.student1NameEnglish,
    contactEmail: input.contactEmail.toLowerCase(),
    contactPhone: input.contactPhone,
    student2NameThai: input.student2NameThai,
    student2NameEnglish: input.student2NameEnglish,
    student3NameThai: input.student3NameThai,
    student3NameEnglish: input.student3NameEnglish,
    pdpaConsentVersion: PDPA_CONSENT_VERSION,
    pdpaAuthorityConfirmed: input.pdpaAuthorityConfirmed,
  });

  return jsonResponse(201, { competitorId: null, status: "PENDING_APPROVAL" });
}

async function handleMe(sub: string): Promise<APIGatewayProxyResultV2> {
  const reg = await getRegistrationBySub(sub);
  if (!reg) throw new ApiError(404, "NOT_FOUND", "No registration found for this account");

  const competitor =
    reg.status === "APPROVED" && reg.approval
      ? await getCompetitor(reg.approval.competitorId)
      : null;

  return jsonResponse(200, {
    registration: {
      status: reg.status,
      name: reg.name,
      teamName: reg.teamName,
      category: reg.category,
      rejection: reg.rejection ? { reason: reg.rejection.reason, at: reg.rejection.at } : null,
      approval: reg.approval,
      createdAt: reg.createdAt,
    },
    competitor: competitor
      ? {
          competitorId: competitor.competitorId,
          name: competitor.name,
          teamName: competitor.teamName,
          category: competitor.category,
          status: competitor.status,
          checkedInAt: competitor.checkedInAt,
          inspectedAt: competitor.inspectedAt,
          disqualified: competitor.disqualified,
        }
      : null,
  });
}

async function handlePending(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const categoryFilter = event.queryStringParameters?.category;
  const pending = await listPendingRegistrations();
  const filtered = categoryFilter
    ? pending.filter((r) => r.category === categoryFilter)
    : pending;

  const items = filtered.map((r) => ({
      sub: r.sub,
      name: r.name,
      teamName: r.teamName,
      category: r.category,
      contactPhone: r.contactPhone,
      contactEmail: r.contactEmail,
      student1NameThai: r.student1NameThai,
      student1NameEnglish: r.student1NameEnglish,
      student2NameThai: r.student2NameThai,
      student2NameEnglish: r.student2NameEnglish,
      student3NameThai: r.student3NameThai,
      student3NameEnglish: r.student3NameEnglish,
      pdpaConsent: r.pdpaConsent,
      createdAt: r.createdAt,
    }));

  return jsonResponse(200, { items });
}

async function handleApprove(
  sub: string,
  byUser: string
): Promise<APIGatewayProxyResultV2> {
  const result = await approveRegistration(sub, byUser);
  return jsonResponse(200, result);
}

const EXPORT_COLUMNS: Record<string, string[]> = {
  registrations: [
    "PK", "status", "teamName", "category", "contactEmail",
    "contactPhone", "student1NameThai", "student1NameEnglish",
    "student2NameThai", "student2NameEnglish", "student3NameThai",
    "student3NameEnglish", "pdpaConsent", "createdAt",
  ],
  competitors: [
    "competitorId", "status", "teamName", "category", "contactEmail",
    "contactPhone", "student1NameThai", "student1NameEnglish",
    "student2NameThai", "student2NameEnglish", "student3NameThai",
    "student3NameEnglish", "pdpaConsent", "cognitoSub", "checkedInAt", "inspectedAt", "createdAt",
  ],
};

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function handleExportCsv(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const entity = event.queryStringParameters?.entity;
  if (entity !== "registrations" && entity !== "competitors") {
    throw new ApiError(400, "VALIDATION_ERROR", "entity must be registrations or competitors");
  }

  const items = await scanAllByEntityType(
    entity === "registrations" ? "REGISTRATION" : "COMPETITOR"
  );
  const columns = EXPORT_COLUMNS[entity];
  const rows = [
    columns.join(","),
    ...items.map((item) => columns.map((col) => csvCell(item[col])).join(",")),
  ];

  return {
    statusCode: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${entity}.csv"`,
    },
    body: rows.join("\r\n") + "\r\n",
  };
}

async function handleReject(
  event: APIGatewayProxyEventV2,
  sub: string,
  byUser: string
): Promise<APIGatewayProxyResultV2> {
  const parsed = rejectSchema.safeParse(parseBody(event));
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "reason is required", zodToFields(parsed.error));
  }
  await rejectRegistration(sub, parsed.data.reason, byUser);
  return jsonResponse(200, { status: "REJECTED" });
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath.replace(/\/+$/, "") || "/";

    // A $default HTTP API route forwards browser preflights to Lambda. CORS
    // headers are added by API Gateway, but OPTIONS must succeed before auth or
    // the browser will block the real request.
    if (method === "OPTIONS") {
      return { statusCode: 204, body: "" };
    }

    const user = await authenticate(event.headers.authorization ?? event.headers.Authorization);

    if (method === "POST" && path === "/register") {
      requireCompetitorOnly(user);
      return await handleRegister(event, user.sub);
    }
    if (method === "GET" && path === "/me") {
      return await handleMe(user.sub);
    }
    if (method === "GET" && path === "/pending") {
      requireRole(user, "committee");
      return await handlePending(event);
    }
    if (method === "GET" && path === "/export.csv") {
      requireAdminOnly(user);
      return await handleExportCsv(event);
    }

    const approveMatch = path.match(/^\/registrations\/([^/]+)\/approve$/);
    if (method === "POST" && approveMatch) {
      requireRole(user, "committee");
      return await handleApprove(decodeURIComponent(approveMatch[1]), user.username);
    }

    const rejectMatch = path.match(/^\/registrations\/([^/]+)\/reject$/);
    if (method === "POST" && rejectMatch) {
      requireRole(user, "committee");
      return await handleReject(event, decodeURIComponent(rejectMatch[1]), user.username);
    }

    throw new ApiError(404, "NOT_FOUND", "Route not found");
  } catch (err) {
    return errorResponse(err);
  }
}
