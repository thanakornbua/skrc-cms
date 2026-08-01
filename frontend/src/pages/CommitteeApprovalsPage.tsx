import { useEffect, useState, type ReactNode } from "react";
import { ApiClientError, regweekJson } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { locale, t } from "../i18n";

interface PendingItem {
  sub: string;
  status: "PENDING_APPROVAL";
  teamName: string;
  category: string;
  school: string;
  certificateLanguage: "THAI" | "ENGLISH" | "BILINGUAL";
  advisorNameThai: string;
  advisorNameEnglish: string;
  advisorEmail: string;
  advisorPhone: string;
  student1NameThai: string;
  student1NameEnglish: string;
  student2NameThai: string;
  student2NameEnglish: string;
  student3NameThai: string;
  student3NameEnglish: string;
  student1FoodAllergy: string;
  student2FoodAllergy: string;
  student3FoodAllergy: string;
  contactPhone: string;
  contactEmail: string;
  memberCount: number;
  pdpaConsent: {
    accepted: true;
    version: string;
    at: string;
    retentionMonths: 6;
    deleteBy: string;
    authorityConfirmed: true;
    language: "th-en";
  };
  createdAt: string;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function certificateLanguageLabel(value: PendingItem["certificateLanguage"]): string {
  return {
    THAI: t("ภาษาไทย", "Thai"),
    ENGLISH: t("ภาษาอังกฤษ", "English"),
    BILINGUAL: t("ไทยและอังกฤษ", "Thai and English"),
  }[value];
}

function ReviewDatum({ label, children, technical = false }: { label: string; children: ReactNode; technical?: boolean }) {
  return <div className="approval-datum"><dt>{label}</dt><dd className={technical ? "technical" : undefined}>{children || "—"}</dd></div>;
}

function MemberReview({ number, thaiName, englishName, allergy, leader = false }: {
  number: number;
  thaiName: string;
  englishName: string;
  allergy: string;
  leader?: boolean;
}) {
  return <section className="approval-member">
    <div className="approval-member-heading">
      <span className="approval-member-number">{String(number).padStart(2, "0")}</span>
      <h4>{leader ? t("หัวหน้าทีมและผู้ประสานงาน", "Team leader and correspondent") : t(`สมาชิกทีมคนที่ ${number}`, `Team member ${number}`)}</h4>
    </div>
    <dl className="approval-data-grid">
      <ReviewDatum label={t("ชื่อ-นามสกุล ภาษาไทย", "Full name in Thai")}>{thaiName}</ReviewDatum>
      <ReviewDatum label={t("ชื่อ-นามสกุล ภาษาอังกฤษ", "Full name in English")}>{englishName}</ReviewDatum>
      <ReviewDatum label={t("การแพ้อาหาร", "Food allergy")}>{allergy}</ReviewDatum>
    </dl>
  </section>;
}

function CommitteeApprovalsDashboard({ signOutAndReset }: { signOutAndReset: () => Promise<void> }) {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectingSub, setRejectingSub] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busySub, setBusySub] = useState<string | null>(null);

  async function loadPending(): Promise<void> {
    try {
      const result = await regweekJson<{ items: PendingItem[] }>("/pending");
      setItems(result.items);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load pending queue");
    }
  }

  useEffect(() => {
    loadPending();
    const interval = setInterval(loadPending, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleApprove(sub: string): Promise<void> {
    setActionError(null);
    setBusySub(sub);
    try {
      await regweekJson(`/registrations/${encodeURIComponent(sub)}/approve`, { method: "POST" });
      await loadPending();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Approve failed");
    } finally {
      setBusySub(null);
    }
  }

  async function handleReject(sub: string): Promise<void> {
    if (!rejectReason.trim()) {
      setActionError("A rejection reason is required.");
      return;
    }
    setActionError(null);
    setBusySub(sub);
    try {
      await regweekJson(`/registrations/${encodeURIComponent(sub)}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason }),
      });
      setRejectingSub(null);
      setRejectReason("");
      await loadPending();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Reject failed");
    } finally {
      setBusySub(null);
    }
  }

  return (
    <div className="page page-mid">
      {busySub && <LoadingScreen overlay label="กำลังดำเนินการ / Working…" />}
      <NavBar onSignOut={signOutAndReset} />
      <BrandHeader title="Pending Approvals" home="/committee/approvals" description="ตรวจสอบและอนุมัติใบสมัคร / Review registration requests" />

      {loadError && <div className="error-banner" role="alert">{loadError}</div>}
      {actionError && <div className="error-banner" role="alert">{actionError}</div>}

      {items.length === 0 && <div className="empty-state">{t("ไม่มีใบสมัครที่รอตรวจสอบ", "No pending registrations")}</div>}

      {items.map((item) => (
        <article className="card approval-card" key={item.sub}>
          <header className="approval-card-header">
            <div>
              <span className="status-badge warning">PENDING REVIEW</span>
              <h2>{item.teamName}</h2>
              <p>{item.category}</p>
            </div>
            <dl className="approval-summary">
              <ReviewDatum label={t("สมาชิก", "Members")}>{t(`${item.memberCount} คน`, `${item.memberCount} member${item.memberCount === 1 ? "" : "s"}`)}</ReviewDatum>
              <ReviewDatum label={t("ส่งเมื่อ", "Submitted")}>{formatDate(item.createdAt)}</ReviewDatum>
            </dl>
          </header>

          <section className="approval-section">
            <span className="section-kicker">TEAM & SCHOOL</span>
            <h3>{t("ข้อมูลทีมและสถานศึกษา", "Team and school")}</h3>
            <dl className="approval-data-grid">
              <ReviewDatum label={t("ชื่อทีม", "Team name")}>{item.teamName}</ReviewDatum>
              <ReviewDatum label={t("ประเภทการแข่งขัน", "Category")}>{item.category}</ReviewDatum>
              <ReviewDatum label={t("สถานศึกษาหลัก", "School")}>{item.school}</ReviewDatum>
              <ReviewDatum label={t("ภาษาเกียรติบัตร", "Certificate language")}>{certificateLanguageLabel(item.certificateLanguage)}</ReviewDatum>
            </dl>
          </section>

          <section className="approval-section">
            <span className="section-kicker">ADVISOR</span>
            <h3>{t("อาจารย์ที่ปรึกษา (ถ้ามี)", "Advisor (if provided)")}</h3>
            <dl className="approval-data-grid">
              <ReviewDatum label={t("ชื่อ-นามสกุล ภาษาไทย", "Full name in Thai")}>{item.advisorNameThai}</ReviewDatum>
              <ReviewDatum label={t("ชื่อ-นามสกุล ภาษาอังกฤษ", "Full name in English")}>{item.advisorNameEnglish}</ReviewDatum>
              <ReviewDatum label={t("อีเมล", "Email")} technical>{item.advisorEmail}</ReviewDatum>
              <ReviewDatum label={t("หมายเลขโทรศัพท์", "Phone number")} technical>{item.advisorPhone}</ReviewDatum>
            </dl>
          </section>

          <section className="approval-section">
            <span className="section-kicker">TEAM MEMBERS · {String(item.memberCount).padStart(2, "0")}</span>
            <h3>{t("สมาชิกทีมทั้งหมด", "All team members")}</h3>
            <div className="approval-members">
              <MemberReview number={1} thaiName={item.student1NameThai} englishName={item.student1NameEnglish} allergy={item.student1FoodAllergy} leader />
              {item.student2NameThai && <MemberReview number={2} thaiName={item.student2NameThai} englishName={item.student2NameEnglish} allergy={item.student2FoodAllergy} />}
              {item.student3NameThai && <MemberReview number={3} thaiName={item.student3NameThai} englishName={item.student3NameEnglish} allergy={item.student3FoodAllergy} />}
            </div>
            <dl className="approval-data-grid approval-contact-grid">
              <ReviewDatum label={t("อีเมลติดต่อหัวหน้าทีม", "Team leader contact email")} technical>{item.contactEmail}</ReviewDatum>
              <ReviewDatum label={t("โทรศัพท์หัวหน้าทีม", "Team leader phone")} technical>{item.contactPhone}</ReviewDatum>
            </dl>
          </section>

          <section className="approval-section approval-consent">
            <span className="section-kicker">PDPA CONSENT</span>
            <h3>{t("หลักฐานการยินยอมข้อมูลส่วนบุคคล", "Personal-data consent record")}</h3>
            <dl className="approval-data-grid">
              <ReviewDatum label={t("ยอมรับข้อตกลง", "Consent accepted")}>{item.pdpaConsent.accepted ? t("ยอมรับแล้ว", "Accepted") : t("ไม่ยอมรับ", "Not accepted")}</ReviewDatum>
              <ReviewDatum label={t("ยืนยันอำนาจจากผู้ปกครอง", "Guardian authority confirmed")}>{item.pdpaConsent.authorityConfirmed ? t("ยืนยันแล้ว", "Confirmed") : t("ไม่ได้ยืนยัน", "Not confirmed")}</ReviewDatum>
              <ReviewDatum label={t("เวอร์ชันข้อตกลง", "Agreement version")} technical>{item.pdpaConsent.version}</ReviewDatum>
              <ReviewDatum label={t("ภาษาข้อตกลง", "Agreement language")} technical>{item.pdpaConsent.language}</ReviewDatum>
              <ReviewDatum label={t("เวลาที่ยินยอม", "Consent time")}>{formatDate(item.pdpaConsent.at)}</ReviewDatum>
              <ReviewDatum label={t("กำหนดลบข้อมูล", "Scheduled deletion")}>{formatDate(item.pdpaConsent.deleteBy)}</ReviewDatum>
              <ReviewDatum label={t("ระยะเวลาเก็บรักษา", "Retention period")}>{t(`${item.pdpaConsent.retentionMonths} เดือน`, `${item.pdpaConsent.retentionMonths} months`)}</ReviewDatum>
              <ReviewDatum label={t("รหัสบัญชีใบสมัคร", "Registration account ID")} technical>{item.sub}</ReviewDatum>
            </dl>
          </section>

          {rejectingSub === item.sub ? (
            <div className="field approval-decision">
              <label htmlFor={`reject-reason-${item.sub}`}>{t("เหตุผลที่ไม่อนุมัติ", "Rejection reason")}</label>
              <textarea
                id={`reject-reason-${item.sub}`}
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <div className="button-row">
                <button
                  type="button"
                  className="danger"
                  disabled={busySub === item.sub}
                  onClick={() => handleReject(item.sub)}
                >
                  {t("ยืนยันไม่อนุมัติ", "Reject")}
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setRejectingSub(null);
                    setRejectReason("");
                  }}
                >
                  {t("ยกเลิก", "Cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="button-row">
              <button type="button" disabled={busySub === item.sub} onClick={() => handleApprove(item.sub)}>
                {t("อนุมัติ", "Approve")}
              </button>
              <button
                className="danger"
                type="button"
                disabled={busySub === item.sub}
                onClick={() => setRejectingSub(item.sub)}
              >
                {t("ไม่อนุมัติ", "Reject")}
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export default function CommitteeApprovalsPage() {
  return <LoginGate title="Committee Login">{(actions) => <CommitteeApprovalsDashboard {...actions} />}</LoginGate>;
}
