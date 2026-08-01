import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { ApiClientError, regweekJson } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";

type CompetitorStatus = "REGISTERED" | "CHECKED_IN" | "INSPECTED" | "RUN_COMPLETE";

interface CompetitorListItem {
  competitorId: string;
  teamName: string;
  category: string;
  school: string;
  status: CompetitorStatus;
  memberCount: number;
  disqualified: { bool: boolean };
}

interface CompetitorDetail extends CompetitorListItem {
  name: string;
  certificateLanguage: "THAI" | "ENGLISH" | "BILINGUAL";
  advisorNameThai: string;
  advisorNameEnglish: string;
  advisorEmail: string;
  advisorPhone: string;
  contactEmail: string;
  contactPhone: string;
  student1NameThai: string;
  student1NameEnglish: string;
  student2NameThai: string;
  student2NameEnglish: string;
  student3NameThai: string;
  student3NameEnglish: string;
  student1FoodAllergy: string;
  student2FoodAllergy: string;
  student3FoodAllergy: string;
  checkedInAt: string | null;
  checkedInBy: string | null;
  inspectedAt: string | null;
  createdAt: string;
  updatedAt?: string;
  revision: string;
  pdpaConsent: { version: string; at: string; deleteBy: string; authorityConfirmed: boolean };
}

interface ActivityEvent {
  type: "APPROVED" | "PROFILE_UPDATED" | "PASSWORD_RESET_REQUESTED" | "CHECKED_IN" | "INSPECTED" | "DISQUALIFIED";
  at: string;
  byUser: string | null;
  reason?: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
}

interface DetailResponse { competitor: CompetitorDetail; activity: ActivityEvent[] }

const activityLabels: Record<ActivityEvent["type"], [string, string]> = {
  APPROVED: ["อนุมัติการสมัคร", "Registration approved"],
  PROFILE_UPDATED: ["แก้ไขข้อมูลผู้เข้าแข่งขัน", "Competitor information updated"],
  PASSWORD_RESET_REQUESTED: ["ส่งรหัสรีเซ็ตรหัสผ่าน", "Password reset requested"],
  CHECKED_IN: ["เช็คอิน", "Checked in"],
  INSPECTED: ["ตรวจสภาพหุ่นยนต์", "Robot inspected"],
  DISQUALIFIED: ["ตัดสิทธิ์", "Disqualified"],
};

const dateTime = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "—";

function AdminDashboard({ signOutAndReset }: { signOutAndReset: () => Promise<void> }) {
  const [items, setItems] = useState<CompetitorListItem[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<CompetitorDetail | null>(null);
  const [draft, setDraft] = useState<CompetitorDetail | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const searchId = useId();
  const categoryId = useId();
  const statusId = useId();

  const loadList = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (category) params.set("category", category);
      if (status) params.set("status", status);
      const result = await regweekJson<{ canEdit: boolean; items: CompetitorListItem[] }>(
        `/staff/competitors${params.size ? `?${params}` : ""}`
      );
      setItems(result.items);
      setCanEdit(result.canEdit);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("โหลดรายชื่อไม่สำเร็จ", "Failed to load competitors"));
    } finally {
      setBusy(false);
    }
  }, [category, q, status]);

  useEffect(() => { void loadList(); }, []); // load the complete list when staff opens the page

  const loadDetail = useCallback(async (competitorId: string) => {
    setBusy(true);
    try {
      const result = await regweekJson<DetailResponse>(`/staff/competitors/${encodeURIComponent(competitorId)}`);
      setSelected(result.competitor);
      setDraft(result.competitor);
      setActivity(result.activity);
      setReason("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("โหลดข้อมูลไม่สำเร็จ", "Failed to load competitor"));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else { setSelected(null); setDraft(null); setActivity([]); }
  }, [loadDetail, selectedId]);

  function setField<K extends keyof CompetitorDetail>(field: K, value: CompetitorDetail[K]) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!draft || !selected || !canEdit) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await regweekJson<DetailResponse>(`/staff/competitors/${encodeURIComponent(draft.competitorId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          teamName: draft.teamName, category: draft.category, school: draft.school,
          certificateLanguage: draft.certificateLanguage,
          advisorNameThai: draft.advisorNameThai, advisorNameEnglish: draft.advisorNameEnglish,
          advisorEmail: draft.advisorEmail, advisorPhone: draft.advisorPhone,
          contactEmail: draft.contactEmail, contactPhone: draft.contactPhone,
          student1NameThai: draft.student1NameThai, student1NameEnglish: draft.student1NameEnglish,
          student2NameThai: draft.student2NameThai, student2NameEnglish: draft.student2NameEnglish,
          student3NameThai: draft.student3NameThai, student3NameEnglish: draft.student3NameEnglish,
          student1FoodAllergy: draft.student1FoodAllergy,
          student2FoodAllergy: draft.student2FoodAllergy,
          student3FoodAllergy: draft.student3FoodAllergy,
          expectedUpdatedAt: selected.revision,
          reason,
        }),
      });
      setSelected(result.competitor);
      setDraft(result.competitor);
      setActivity(result.activity);
      setReason("");
      setNotice(t("บันทึกข้อมูลและประวัติการแก้ไขแล้ว", "Information and audit history saved"));
      await loadList();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("บันทึกไม่สำเร็จ", "Save failed"));
    } finally { setBusy(false); }
  }

  async function handlePasswordReset() {
    if (!selected || !window.confirm(t(
      `ส่งรหัสรีเซ็ตรหัสผ่านสำหรับ ${selected.competitorId} หรือไม่?`,
      `Send a password reset code for ${selected.competitorId}?`
    ))) return;
    setBusy(true);
    setError(null);
    try {
      await regweekJson(`/staff/competitors/${encodeURIComponent(selected.competitorId)}/reset-password`, { method: "POST" });
      await loadDetail(selected.competitorId);
      setNotice(t("ส่งรหัสรีเซ็ตไปยังอีเมลที่ยืนยันแล้ว", "Reset code sent to the verified email"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ส่งรหัสไม่สำเร็จ", "Reset failed"));
    } finally { setBusy(false); }
  }

  const textField = (field: keyof CompetitorDetail, labelTh: string, labelEn: string, type = "text") => (
    <div className="field">
      <label htmlFor={`${String(field)}-field`}>{t(labelTh, labelEn)}</label>
      <input id={`${String(field)}-field`} type={type} value={String(draft?.[field] ?? "")} disabled={!canEdit} onChange={(e) => setField(field, e.target.value as never)} />
    </div>
  );

  return (
    <div className="page page-wide" id="admin-app-shell">
      {busy && <LoadingScreen overlay label="กำลังดำเนินการ / Working…" />}
      <NavBar onSignOut={signOutAndReset} />
      <BrandHeader title={t("จัดการผู้เข้าแข่งขัน", "Manage Competitors")} home="/admin" description={t("ค้นหา ตรวจสอบ แก้ไข และดูประวัติได้ตลอดเวลา", "Search, review, update, and audit competitor records at any time")} />
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      <form className="card toolbar admin-search" onSubmit={(event) => { event.preventDefault(); void loadList(); }}>
        <div className="field"><label htmlFor={searchId}>{t("ค้นหา", "Search")}</label><input id={searchId} type="search" placeholder={t("หมายเลข ทีม โรงเรียน หรือชื่อสมาชิก", "ID, team, school, or member")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field"><label htmlFor={categoryId}>{t("ประเภท", "Category")}</label><select id={categoryId} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">{t("ทุกประเภท", "All categories")}</option><option value="Line Tracing - Open">Line Tracing - Open</option></select></div>
        <div className="field"><label htmlFor={statusId}>{t("สถานะ", "Status")}</label><select id={statusId} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t("ทุกสถานะ", "All statuses")}</option><option value="REGISTERED">REGISTERED</option><option value="CHECKED_IN">CHECKED_IN</option><option value="INSPECTED">INSPECTED</option><option value="RUN_COMPLETE">RUN_COMPLETE</option></select></div>
        <button type="submit">{t("ค้นหา / รีเฟรช", "Search / refresh")}</button>
      </form>

      <div className="competitor-manager-layout">
        <section className="competitor-list" aria-label={t("รายชื่อผู้เข้าแข่งขัน", "Competitor list")}>
          <p className="muted">{t(`พบ ${items.length} ทีม`, `${items.length} teams`)}</p>
          {items.map((item) => <button type="button" className="card competitor-select" key={item.competitorId} aria-pressed={selectedId === item.competitorId} onClick={() => setSelectedId(item.competitorId)}>
            <span><strong className="technical">{item.competitorId}</strong> · {item.teamName}</span>
            <small>{item.school || t("ไม่ระบุโรงเรียน", "No school")} · {item.memberCount} {t("คน", "members")}</small>
            <span className={`status-badge ${item.disqualified.bool ? "error" : ""}`}>{item.disqualified.bool ? "DQ" : item.status}</span>
          </button>)}
          {!items.length && <div className="empty-state">{t("ไม่พบผู้เข้าแข่งขัน", "No competitors match")}</div>}
        </section>

        <main>
          {!draft && <div className="card empty-state">{t("เลือกทีมเพื่อดูข้อมูลทั้งหมด", "Select a team to view its complete record")}</div>}
          {draft && <>
            <form className="card competitor-editor" onSubmit={handleSave}>
              <div className="section-heading"><div><span className="status-badge">{draft.status}</span><h2><span className="technical">{draft.competitorId}</span> · {draft.teamName}</h2></div>{!canEdit && <span className="status-badge">{t("อ่านอย่างเดียว", "Read only")}</span>}</div>

              <details open><summary>{t("ข้อมูลทีม", "Team information")}</summary><div className="form-grid">
                {textField("teamName", "ชื่อทีม", "Team name")}
                <div className="field"><label htmlFor="category-field">{t("ประเภทการแข่งขัน", "Category")}</label><select id="category-field" disabled={!canEdit} value={draft.category} onChange={(e) => setField("category", e.target.value)}><option value="Line Tracing - Open">Line Tracing - Open</option></select></div>
                {textField("school", "โรงเรียน / สถาบัน", "School / institution")}
                <div className="field"><label htmlFor="certificateLanguage-field">{t("ภาษาบนเกียรติบัตร", "Certificate language")}</label><select id="certificateLanguage-field" disabled={!canEdit} value={draft.certificateLanguage} onChange={(e) => setField("certificateLanguage", e.target.value as CompetitorDetail["certificateLanguage"])}><option value="THAI">ไทย</option><option value="ENGLISH">English</option><option value="BILINGUAL">ไทย / English</option></select></div>
                {textField("contactEmail", "อีเมลผู้ติดต่อ", "Contact email", "email")}{textField("contactPhone", "โทรศัพท์ผู้ติดต่อ", "Contact phone", "tel")}
              </div></details>

              <details open><summary>{t("สมาชิกทีม", "Team members")}</summary><div className="member-edit-grid">
                {[1, 2, 3].map((member) => <fieldset key={member}><legend>{t(`สมาชิกคนที่ ${member}${member === 1 ? " (หัวหน้าทีม)" : ""}`, `Member ${member}${member === 1 ? " (lead)" : ""}`)}</legend>
                  {textField(`student${member}NameThai` as keyof CompetitorDetail, "ชื่อภาษาไทย", "Thai name")}
                  {textField(`student${member}NameEnglish` as keyof CompetitorDetail, "ชื่อภาษาอังกฤษ", "English name")}
                  {textField(`student${member}FoodAllergy` as keyof CompetitorDetail, "การแพ้อาหาร (หรือ NONE)", "Food allergies (or NONE)")}
                </fieldset>)}
              </div></details>

              <details><summary>{t("อาจารย์ที่ปรึกษาและ PDPA", "Advisor and PDPA")}</summary><div className="form-grid">
                {textField("advisorNameThai", "ชื่ออาจารย์ภาษาไทย", "Advisor Thai name")}{textField("advisorNameEnglish", "ชื่ออาจารย์ภาษาอังกฤษ", "Advisor English name")}
                {textField("advisorEmail", "อีเมลอาจารย์", "Advisor email", "email")}{textField("advisorPhone", "โทรศัพท์อาจารย์", "Advisor phone", "tel")}
              </div><dl className="detail-list"><div><dt>PDPA version</dt><dd className="technical">{draft.pdpaConsent.version}</dd></div><div><dt>{t("ให้ความยินยอมเมื่อ", "Consented")}</dt><dd>{dateTime(draft.pdpaConsent.at)}</dd></div><div><dt>{t("กำหนดลบข้อมูล", "Delete by")}</dt><dd>{dateTime(draft.pdpaConsent.deleteBy)}</dd></div></dl></details>

              <details><summary>{t("สถานะการแข่งขัน", "Competition status")}</summary><dl className="detail-list"><div><dt>{t("สร้างรายการ", "Created")}</dt><dd>{dateTime(draft.createdAt)}</dd></div><div><dt>{t("แก้ไขล่าสุด", "Last updated")}</dt><dd>{dateTime(draft.updatedAt)}</dd></div><div><dt>{t("เช็คอิน", "Checked in")}</dt><dd>{dateTime(draft.checkedInAt)}</dd></div><div><dt>{t("ตรวจสภาพ", "Inspected")}</dt><dd>{dateTime(draft.inspectedAt)}</dd></div></dl></details>

              {canEdit && <div className="editor-actions"><div className="field"><label htmlFor="change-reason">{t("เหตุผลที่แก้ไข (บันทึกในประวัติ)", "Reason for change (recorded in audit log)")}</label><input id="change-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div><button type="submit" disabled={!reason.trim()}>{t("บันทึกการเปลี่ยนแปลง", "Save changes")}</button><button className="secondary" type="button" onClick={() => { setDraft(selected); setReason(""); }}>{t("ยกเลิก", "Discard")}</button><button className="secondary" type="button" onClick={handlePasswordReset}>{t("ส่งรหัสรีเซ็ตรหัสผ่าน", "Send password reset code")}</button></div>}
            </form>

            <section className="card activity-log"><h2>{t("ประวัติกิจกรรม", "Activity log")}</h2>{activity.map((event, index) => <article key={`${event.at}-${event.type}-${index}`} className="activity-item"><span className="activity-marker" aria-hidden="true" /><div><strong>{t(...activityLabels[event.type])}</strong><p>{dateTime(event.at)}{event.byUser ? ` · ${event.byUser}` : ""}</p>{event.reason && <p>{t("เหตุผล", "Reason")}: {event.reason}</p>}{event.changes && <details><summary>{t(`${Object.keys(event.changes).length} รายการที่เปลี่ยน`, `${Object.keys(event.changes).length} changed fields`)}</summary><ul>{Object.entries(event.changes).map(([field, change]) => <li key={field}><span className="technical">{field}</span>: {String(change.before || "—")} → {String(change.after || "—")}</li>)}</ul></details>}</div></article>)}{!activity.length && <p className="muted">{t("ยังไม่มีกิจกรรม", "No activity yet")}</p>}</section>
          </>}
        </main>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return <LoginGate title={t("เข้าสู่ระบบเจ้าหน้าที่", "Staff Login")}>{(actions) => <AdminDashboard {...actions} />}</LoginGate>;
}
