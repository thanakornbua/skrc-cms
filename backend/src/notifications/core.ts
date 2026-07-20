import type { DynamoDBRecord } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";

export type NotificationType = "REGISTRATION_RECEIVED" | "REGISTRATION_APPROVED";

export interface NotificationEvent {
  type: NotificationType;
  eventId: string;
  sub: string;
  contactEmail: string;
  teamName: string;
  category: string;
  createdAt: string;
  deleteBy: string;
  competitorId?: string;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

type RegistrationImage = {
  PK?: string;
  SK?: string;
  status?: string;
  contactEmail?: string;
  teamName?: string;
  category?: string;
  createdAt?: string;
  pdpaConsent?: { deleteBy?: string };
  approval?: { competitorId?: string };
};

type StreamImage = NonNullable<NonNullable<DynamoDBRecord["dynamodb"]>["NewImage"]>;

function decode(image: StreamImage | undefined): RegistrationImage | undefined {
  return image ? unmarshall(image as Parameters<typeof unmarshall>[0]) as RegistrationImage : undefined;
}

export function classifyRecord(record: DynamoDBRecord): NotificationEvent | null {
  const next = decode(record.dynamodb?.NewImage);
  if (!next || !next.PK?.startsWith("REG#") || next.SK !== "PROFILE") return null;
  if (!next.contactEmail || !next.teamName || !next.category || !next.createdAt) return null;

  const previous = decode(record.dynamodb?.OldImage);
  let type: NotificationType | null = null;
  if (record.eventName === "INSERT" && next.status === "PENDING_APPROVAL") {
    type = "REGISTRATION_RECEIVED";
  } else if (
    record.eventName === "MODIFY" &&
    previous?.status !== "APPROVED" &&
    next.status === "APPROVED" &&
    next.approval?.competitorId
  ) {
    type = "REGISTRATION_APPROVED";
  }
  if (!type) return null;

  return {
    type,
    eventId: record.eventID ?? `${next.PK}:${type}`,
    sub: next.PK.slice(4),
    contactEmail: next.contactEmail.toLowerCase(),
    teamName: next.teamName,
    category: next.category,
    createdAt: next.createdAt,
    deleteBy: next.pdpaConsent?.deleteBy ?? next.createdAt,
    ...(next.approval?.competitorId ? { competitorId: next.approval.competitorId } : {}),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char]!);
}

export function buildEmail(
  event: NotificationEvent,
  portalUrl: string,
  contactAddress: string
): EmailContent {
  const team = event.teamName;
  const category = event.category;
  const safeTeam = escapeHtml(team);
  const safeCategory = escapeHtml(category);
  const safePortal = escapeHtml(portalUrl);
  const safeContact = escapeHtml(contactAddress);

  if (event.type === "REGISTRATION_RECEIVED") {
    return {
      subject: "[SKRC Robotics Competition] ได้รับใบสมัครแล้ว / Registration received",
      text: [
        "ได้รับใบสมัครของทีมแล้ว และกำลังรอคณะกรรมการตรวจสอบ",
        `ทีม / Team: ${team}`,
        `ประเภท / Category: ${category}`,
        "สถานะ / Status: รอการอนุมัติ / Pending approval",
        `ติดตามสถานะ / Track status: ${portalUrl}`,
        "",
        `อีเมลนี้ไม่รับข้อความตอบกลับ หากต้องการความช่วยเหลือ โปรดติดต่อ ${contactAddress}`,
        `This mailbox is not monitored. For help, contact ${contactAddress}.`,
      ].join("\n"),
      html: `<p>ได้รับใบสมัครของทีมแล้ว และกำลังรอคณะกรรมการตรวจสอบ</p><p>We received your registration and it is awaiting committee review.</p><dl><dt>ทีม / Team</dt><dd>${safeTeam}</dd><dt>ประเภท / Category</dt><dd>${safeCategory}</dd><dt>สถานะ / Status</dt><dd>รอการอนุมัติ / Pending approval</dd></dl><p><a href="${safePortal}">ติดตามสถานะ / Track status</a></p><hr><p>อีเมลนี้ไม่รับข้อความตอบกลับ หากต้องการความช่วยเหลือ โปรดติดต่อ <a href="mailto:${safeContact}">${safeContact}</a><br>This mailbox is not monitored. For help, contact <a href="mailto:${safeContact}">${safeContact}</a>.</p>`,
    };
  }

  const competitorId = event.competitorId!;
  const safeCompetitorId = escapeHtml(competitorId);
  return {
    subject: "[SKRC Robotics Competition] ใบสมัครได้รับการอนุมัติ / Registration approved",
    text: [
      "ใบสมัครของทีมได้รับการอนุมัติแล้ว",
      `ทีม / Team: ${team}`,
      `ประเภท / Category: ${category}`,
      `หมายเลขผู้เข้าแข่งขัน / Competitor ID: ${competitorId}`,
      `ดูรายละเอียด / View details: ${portalUrl}`,
      "",
      `อีเมลนี้ไม่รับข้อความตอบกลับ หากต้องการความช่วยเหลือ โปรดติดต่อ ${contactAddress}`,
      `This mailbox is not monitored. For help, contact ${contactAddress}.`,
    ].join("\n"),
    html: `<p>ใบสมัครของทีมได้รับการอนุมัติแล้ว</p><p>Your registration has been approved.</p><dl><dt>ทีม / Team</dt><dd>${safeTeam}</dd><dt>ประเภท / Category</dt><dd>${safeCategory}</dd><dt>หมายเลขผู้เข้าแข่งขัน / Competitor ID</dt><dd><strong>${safeCompetitorId}</strong></dd></dl><p><a href="${safePortal}">ดูรายละเอียด / View details</a></p><hr><p>อีเมลนี้ไม่รับข้อความตอบกลับ หากต้องการความช่วยเหลือ โปรดติดต่อ <a href="mailto:${safeContact}">${safeContact}</a><br>This mailbox is not monitored. For help, contact <a href="mailto:${safeContact}">${safeContact}</a>.</p>`,
  };
}

export function notificationKey(event: NotificationEvent): { PK: string; SK: string } {
  return { PK: `NOTIFY#${event.sub}`, SK: event.type };
}

export function ttlFromDeleteBy(deleteBy: string): number {
  const parsed = Date.parse(deleteBy);
  return Math.floor((Number.isFinite(parsed) ? parsed : Date.now() + 180 * 86400000) / 1000);
}
