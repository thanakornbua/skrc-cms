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

/**
 * Email-safe implementation of the SKRC editorial design system. Email clients
 * discard external stylesheets and often lack modern layout support, so this
 * deliberately uses inline CSS and table layout while retaining the portal's
 * warm paper, ink, violet accent, hairline cards, and signature gradient.
 */
function renderEmailShell(options: {
  preheader: string;
  eyebrow: string;
  headlineThai: string;
  headlineEnglish: string;
  bodyThai: string;
  bodyEnglish: string;
  status: string;
  facts: Array<{ label: string; value: string; mono?: boolean }>;
  portalUrl: string;
  contactAddress: string;
}): string {
  const facts = options.facts.map(({ label, value, mono }) =>
    `<tr><td style="padding:0 0 12px;color:#6b7280;font-family:Arial,'IBM Plex Sans Thai',sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;vertical-align:top;width:42%;">${label}</td><td style="padding:0 0 12px;color:#1a1a2e;font-family:${mono ? "'Courier New',monospace" : "Arial,'IBM Plex Sans Thai',sans-serif"};font-size:15px;font-weight:${mono ? "700" : "600"};line-height:1.5;vertical-align:top;">${value}</td></tr>`
  ).join("");

  return `<!doctype html>
<html lang="th">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#faf9f6;color:#1a1a2e;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${options.preheader}&nbsp;&zwnj;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#faf9f6;">
      <tr><td align="center" style="padding:32px 16px 40px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e7e4de;border-radius:14px;overflow:hidden;">
          <tr><td style="height:4px;background:linear-gradient(135deg,#e040fb,#7c3aed 50%,#3b82f6);font-size:0;line-height:4px;">&nbsp;</td></tr>
          <tr><td style="padding:32px 32px 24px;border-bottom:1px solid #e7e4de;">
            <p style="margin:0 0 12px;color:#7c3aed;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:2px;line-height:1.4;text-transform:uppercase;">${options.eyebrow}</p>
            <h1 style="margin:0;color:#1a1a2e;font-family:Arial,'IBM Plex Sans Thai',sans-serif;font-size:28px;line-height:1.2;letter-spacing:-0.3px;">${options.headlineThai}</h1>
            <p style="margin:8px 0 0;color:#374151;font-family:Arial,sans-serif;font-size:16px;line-height:1.55;">${options.headlineEnglish}</p>
          </td></tr>
          <tr><td style="padding:28px 32px 8px;">
            <span style="display:inline-block;padding:5px 8px;border:1px solid #ddd6fe;color:#7c3aed;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:1px;line-height:1;text-transform:uppercase;">${options.status}</span>
            <p style="margin:20px 0 8px;color:#1a1a2e;font-family:Arial,'IBM Plex Sans Thai',sans-serif;font-size:16px;line-height:1.7;">${options.bodyThai}</p>
            <p style="margin:0 0 24px;color:#374151;font-family:Arial,sans-serif;font-size:15px;line-height:1.7;">${options.bodyEnglish}</p>
          </td></tr>
          <tr><td style="padding:0 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f0ff;border:1px solid #ddd6fe;border-radius:10px;">
              <tr><td style="padding:20px 20px 8px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">${facts}</table></td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:28px 32px 32px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:6px;background:#7c3aed;"><a href="${options.portalUrl}" style="display:inline-block;padding:13px 18px;color:#ffffff;font-family:Arial,'IBM Plex Sans Thai',sans-serif;font-size:15px;font-weight:700;letter-spacing:0.3px;text-decoration:none;">ติดตามสถานะ / Track status</a></td></tr></table>
          </td></tr>
          <tr><td style="padding:20px 32px 28px;background:#f3f1ec;border-top:1px solid #e7e4de;">
            <p style="margin:0;color:#6b7280;font-family:Arial,'IBM Plex Sans Thai',sans-serif;font-size:12px;line-height:1.7;">อีเมลนี้ไม่รับข้อความตอบกลับ หากต้องการความช่วยเหลือ โปรดติดต่อ <a href="mailto:${options.contactAddress}" style="color:#1a1a2e;font-weight:700;text-decoration:underline;">${options.contactAddress}</a><br>This mailbox is not monitored. For help, contact <a href="mailto:${options.contactAddress}" style="color:#1a1a2e;font-weight:700;text-decoration:underline;">${options.contactAddress}</a>.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
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
      html: renderEmailShell({
        preheader: "ได้รับใบสมัครแล้ว / Registration received",
        eyebrow: "SKRC · Robotics Competition",
        headlineThai: "ได้รับใบสมัครแล้ว",
        headlineEnglish: "Registration received",
        status: "Pending approval",
        bodyThai: "ได้รับใบสมัครของทีมแล้ว และกำลังรอคณะกรรมการตรวจสอบ",
        bodyEnglish: "We received your registration and it is awaiting committee review.",
        facts: [
          { label: "ทีม / Team", value: safeTeam },
          { label: "ประเภท / Category", value: safeCategory },
          { label: "สถานะ / Status", value: "รอการอนุมัติ / Pending approval" },
        ],
        portalUrl: safePortal,
        contactAddress: safeContact,
      }),
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
    html: renderEmailShell({
      preheader: `ใบสมัครได้รับการอนุมัติแล้ว / ${safeCompetitorId}`,
      eyebrow: "SKRC · Robotics Competition",
      headlineThai: "ใบสมัครได้รับการอนุมัติแล้ว",
      headlineEnglish: "Registration approved",
      status: "Approved",
      bodyThai: "ใบสมัครของทีมได้รับการอนุมัติแล้ว",
      bodyEnglish: "Your registration has been approved.",
      facts: [
        { label: "ทีม / Team", value: safeTeam },
        { label: "ประเภท / Category", value: safeCategory },
        { label: "หมายเลขผู้เข้าแข่งขัน / Competitor ID", value: safeCompetitorId, mono: true },
      ],
      portalUrl: safePortal,
      contactAddress: safeContact,
    }),
  };
}

export function notificationKey(event: NotificationEvent): { PK: string; SK: string } {
  return { PK: `NOTIFY#${event.sub}`, SK: event.type };
}

/** Stable provider-level duplicate protection. The DynamoDB ledger remains durable. */
export function providerIdempotencyKey(event: NotificationEvent): string {
  return `skrc/${event.type.toLowerCase()}/${event.sub}`;
}

export function ttlFromDeleteBy(deleteBy: string): number {
  const parsed = Date.parse(deleteBy);
  return Math.floor((Number.isFinite(parsed) ? parsed : Date.now() + 180 * 86400000) / 1000);
}
