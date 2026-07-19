import { Link } from "react-router-dom";
import { t, tt } from "../i18n";
import emblemUrl from "../../../design-system/uploads/Suankularb_Wittayalai_School_emblem.png";

interface BrandHeaderProps {
  title: string;
  thaiTitle?: string;
  description?: string;
  /** When set, the emblem becomes a client-side "home" link to this route. */
  home?: string;
}

const THAI_TITLES: Record<string, string> = {
  "Register": "ลงทะเบียนการแข่งขัน",
  "Registration submitted": "ส่งใบสมัครแล้ว",
  "Competitor Portal": "ระบบผู้เข้าแข่งขัน",
  "Reset password": "รีเซ็ตรหัสผ่าน",
  "Enter reset code": "กรอกรหัสรีเซ็ต",
  "Committee Login": "เข้าสู่ระบบคณะกรรมการ",
  "Staff Login": "เข้าสู่ระบบเจ้าหน้าที่",
  "Pending Approvals": "ตรวจสอบใบสมัคร",
  "Inspection Scan": "ตรวจสภาพหุ่นยนต์",
  "Admin — Competitors": "จัดการผู้เข้าแข่งขัน",
  "Admin — Lanes": "จัดการสนามแข่งขัน",
  "Timing and penalties": "เวลาและบทลงโทษ",
  "Competition results": "ผลการแข่งขัน",
  "Personal Data Collection Agreement": "ข้อตกลงการเก็บรวบรวมข้อมูลส่วนบุคคล",
};

export default function BrandHeader({ title, thaiTitle, description, home }: BrandHeaderProps) {
  const thai = thaiTitle ?? THAI_TITLES[title] ?? title;
  const heading = t(thai, title);

  const emblem = (
    <img
      className="brand-emblem"
      src={emblemUrl}
      alt={t("ตราโรงเรียนสวนกุหลาบวิทยาลัย", "Suankularb Wittayalai School emblem")}
    />
  );

  return (
    <header className="brand-header">
      {home ? (
        <Link to={home} className="brand-home" aria-label={t("หน้าหลัก", "Home")}>
          {emblem}
        </Link>
      ) : (
        emblem
      )}
      <div className="brand-copy">
        <div className="skrc-eyebrow skrc-gradient-text">SKRC · ROBOTICS COMPETITION</div>
        <h1>{heading}</h1>
        {description && <p className="brand-description">{tt(description)}</p>}
      </div>
    </header>
  );
}
