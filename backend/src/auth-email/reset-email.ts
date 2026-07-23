import type { EmailContent } from "../notifications/core.js";

export interface ResetEmailConfig {
  portalUrl: string;
  contactAddress: string;
}

/** Cognito password-recovery codes are valid for one hour and this is fixed by
 *  the service, so the copy can state a definitive expiry rather than "shortly". */
const CODE_TTL_THAI = "รหัสนี้จะหมดอายุภายใน 1 ชั่วโมง";
const CODE_TTL_ENGLISH = "This code expires within 1 hour.";

/**
 * Email-safe render of the SKRC editorial system for the password-reset code.
 * Mirrors notifications/core.ts renderEmailShell (inline CSS, table layout,
 * warm paper, violet accent, signature gradient hairline) but leads with the
 * one-time code rather than a facts table.
 */
export function buildResetEmail(code: string, config: ResetEmailConfig): EmailContent {
  const { portalUrl, contactAddress } = config;
  const subject = "[SKRC Robotics Competition] รหัสตั้งรหัสผ่านใหม่ / Password reset code";

  const text = [
    "รหัสสำหรับตั้งรหัสผ่านใหม่ที่พอร์ทัลผู้เข้าแข่งขัน",
    "Your password reset code for the competitor portal.",
    "",
    `รหัส / Code: ${code}`,
    `${CODE_TTL_THAI} / ${CODE_TTL_ENGLISH}`,
    "",
    `ไปที่พอร์ทัล / Open the portal: ${portalUrl}`,
    "",
    "หากคุณไม่ได้ร้องขอ โปรดละเว้นอีเมลนี้ ทีมงานจะไม่ขอรหัสนี้จากคุณ",
    "If you didn't request this, ignore this email. We will never ask you for this code.",
    "",
    `ต้องการความช่วยเหลือ โปรดติดต่อ ${contactAddress} / For help, contact ${contactAddress}.`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="th">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#faf9f6;color:#1a1a2e;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">รหัสตั้งรหัสผ่านใหม่ / Password reset code&nbsp;&zwnj;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#faf9f6;">
      <tr><td align="center" style="padding:32px 16px 40px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e7e4de;border-radius:14px;overflow:hidden;">
          <tr><td style="height:4px;background:linear-gradient(135deg,#e040fb,#7c3aed 50%,#3b82f6);font-size:0;line-height:4px;">&nbsp;</td></tr>
          <tr><td style="padding:32px 32px 24px;border-bottom:1px solid #e7e4de;">
            <p style="margin:0 0 12px;color:#7c3aed;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:2px;line-height:1.4;text-transform:uppercase;">SKRC · Robotics Competition</p>
            <h1 style="margin:0;color:#1a1a2e;font-family:Arial,'IBM Plex Sans Thai',sans-serif;font-size:28px;line-height:1.2;letter-spacing:-0.3px;">รหัสตั้งรหัสผ่านใหม่</h1>
            <p style="margin:8px 0 0;color:#374151;font-family:Arial,sans-serif;font-size:16px;line-height:1.55;">Your password reset code</p>
          </td></tr>
          <tr><td style="padding:28px 32px 0;">
            <p style="margin:0 0 8px;color:#1a1a2e;font-family:Arial,'IBM Plex Sans Thai',sans-serif;font-size:16px;line-height:1.7;">ใช้รหัสด้านล่างเพื่อตั้งรหัสผ่านใหม่ที่พอร์ทัลผู้เข้าแข่งขัน</p>
            <p style="margin:0 0 20px;color:#374151;font-family:Arial,sans-serif;font-size:15px;line-height:1.7;">Use the code below to reset your password in the competitor portal.</p>
          </td></tr>
          <tr><td align="center" style="padding:0 32px 8px;">
            <div style="display:inline-block;padding:18px 30px;background:#f4f0ff;border:1px solid #ddd6fe;border-radius:10px;color:#1a1a2e;font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:10px;line-height:1;">${code}</div>
          </td></tr>
          <tr><td align="center" style="padding:12px 32px 4px;">
            <p style="margin:0;color:#6b7280;font-family:Arial,'IBM Plex Sans Thai',sans-serif;font-size:13px;line-height:1.6;">${CODE_TTL_THAI} / ${CODE_TTL_ENGLISH}</p>
          </td></tr>
          <tr><td style="padding:24px 32px 8px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td style="border-radius:6px;background:#7c3aed;"><a href="${portalUrl}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-family:Arial,'IBM Plex Sans Thai',sans-serif;font-size:15px;font-weight:700;letter-spacing:0.3px;text-decoration:none;">ไปที่พอร์ทัล / Open the portal</a></td></tr></table>
          </td></tr>
          <tr><td align="center" style="padding:0 32px 24px;">
            <p style="margin:0;color:#9ca3af;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;">หรือไปที่ / or visit <a href="${portalUrl}" style="color:#7c3aed;text-decoration:none;">${portalUrl}</a></p>
          </td></tr>
          <tr><td style="padding:20px 32px 28px;background:#f3f1ec;border-top:1px solid #e7e4de;">
            <p style="margin:0 0 8px;color:#6b7280;font-family:Arial,'IBM Plex Sans Thai',sans-serif;font-size:12px;line-height:1.7;">หากคุณไม่ได้ร้องขอ โปรดละเว้นอีเมลนี้ ทีมงานจะไม่ขอรหัสนี้จากคุณ<br>If you didn't request this, you can ignore this email. We will never ask you for this code.</p>
            <p style="margin:0;color:#6b7280;font-family:Arial,'IBM Plex Sans Thai',sans-serif;font-size:12px;line-height:1.7;">ต้องการความช่วยเหลือ โปรดติดต่อ <a href="mailto:${contactAddress}" style="color:#1a1a2e;font-weight:700;text-decoration:underline;">${contactAddress}</a><br>For help, contact <a href="mailto:${contactAddress}" style="color:#1a1a2e;font-weight:700;text-decoration:underline;">${contactAddress}</a>.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
