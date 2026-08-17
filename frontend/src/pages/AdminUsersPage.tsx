import { useDeferredValue, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { ApiClientError, regweekJson } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";
import CompetitorIdInput from "../components/CompetitorIdInput";
import { competitorIdDigits, normaliseCompetitorId } from "../competitorId";

type UserRole = "competitor" | "committee" | "admin";

interface ManagedUser {
  sub: string;
  username: string;
  email: string;
  name: string;
  status: string;
  enabled: boolean;
  role: UserRole;
  competitorId: string | null;
  createdAt: string | null;
  lastModifiedAt: string | null;
}

interface UserListResponse { users: ManagedUser[]; currentUserSub: string }

const emptyCreate = {
  email: "",
  name: "",
  role: "committee" as UserRole,
  competitorId: "",
  temporaryPassword: "",
};

function dateTime(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "—";
}

function roleLabel(role: UserRole): string {
  if (role === "admin") return t("ผู้ดูแลระบบ", "Admin");
  if (role === "committee") return t("กรรมการ", "Committee");
  return t("ผู้เข้าแข่งขัน", "Competitor");
}

function randomTemporaryPassword(): string {
  const required = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%&*-_+"];
  const all = required.join("");
  const pick = (characters: string) => characters[crypto.getRandomValues(new Uint32Array(1))[0] % characters.length];
  const password = [...required.map(pick), ...Array.from({ length: 12 }, () => pick(all))];
  for (let index = password.length - 1; index > 0; index -= 1) {
    const target = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [password[index], password[target]] = [password[target], password[index]];
  }
  return password.join("");
}

function AdminUsersDashboard({ signOutAndReset }: { signOutAndReset: () => Promise<void> }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [currentUserSub, setCurrentUserSub] = useState("");
  const [selectedSub, setSelectedSub] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManagedUser | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | UserRole>("");
  const [accessFilter, setAccessFilter] = useState<"" | "enabled" | "disabled">("");
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState(emptyCreate);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const searchId = useId();
  const roleFilterId = useId();
  const accessFilterId = useId();

  async function loadUsers(preferredSub?: string): Promise<void> {
    setBusy(true);
    try {
      const result = await regweekJson<UserListResponse>("/admin/users");
      setUsers(result.users);
      setCurrentUserSub(result.currentUserSub);
      const nextSub = preferredSub ?? selectedSub;
      if (nextSub) {
        const selected = result.users.find((user) => user.sub === nextSub) ?? null;
        setSelectedSub(selected?.sub ?? null);
        setDraft(selected);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("โหลดบัญชีไม่สำเร็จ", "Failed to load users"));
    } finally { setBusy(false); }
  }

  useEffect(() => { void loadUsers(); }, []);

  const filteredUsers = useMemo(() => users.filter((user) => {
    const matchesSearch = !deferredSearch || [user.name, user.email, user.username, user.competitorId ?? ""]
      .some((value) => value.toLowerCase().includes(deferredSearch));
    const matchesRole = !roleFilter || user.role === roleFilter;
    const matchesAccess = !accessFilter || (accessFilter === "enabled" ? user.enabled : !user.enabled);
    return matchesSearch && matchesRole && matchesAccess;
  }), [accessFilter, deferredSearch, roleFilter, users]);

  function chooseUser(user: ManagedUser): void {
    setSelectedSub(user.sub);
    setDraft({ ...user });
    setError(null);
    setNotice(null);
  }

  async function persistUser(next: ManagedUser, successMessage: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await regweekJson<{ user: ManagedUser }>(`/admin/users/${encodeURIComponent(next.sub)}`, {
        method: "PATCH",
        body: JSON.stringify({
          email: next.email,
          name: next.name,
          role: next.role,
          competitorId: next.competitorId ?? "",
          enabled: next.enabled,
        }),
      });
      setUsers((current) => current.map((user) => user.sub === result.user.sub ? result.user : user));
      setDraft(result.user);
      setNotice(successMessage);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("บันทึกบัญชีไม่สำเร็จ", "Failed to save user"));
    } finally { setBusy(false); }
  }

  async function handleSave(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!draft) return;
    await persistUser(draft, t("บันทึกข้อมูลบัญชีแล้ว", "Account details saved"));
  }

  async function toggleAccess(): Promise<void> {
    if (!draft) return;
    const enabling = !draft.enabled;
    if (!enabling && !window.confirm(t(
      `ปิดการเข้าถึงของ ${draft.email} หรือไม่? ผู้ใช้นี้จะออกจากระบบเมื่อโทเค็นปัจจุบันหมดอายุ`,
      `Disable access for ${draft.email}? The user will be signed out when their current token expires.`
    ))) return;
    await persistUser({ ...draft, enabled: enabling }, enabling
      ? t("เปิดการเข้าถึงแล้ว", "Access enabled")
      : t("ปิดการเข้าถึงแล้ว", "Access disabled"));
  }

  async function resetUserPassword(): Promise<void> {
    if (!draft || !window.confirm(t(
      `ส่งรหัสรีเซ็ตรหัสผ่านไปยัง ${draft.email} หรือไม่?`,
      `Send a password reset code to ${draft.email}?`
    ))) return;
    setBusy(true);
    setError(null);
    try {
      await regweekJson(`/admin/users/${encodeURIComponent(draft.sub)}/reset-password`, { method: "POST" });
      setNotice(t("ส่งรหัสรีเซ็ตไปยังอีเมลที่ยืนยันแล้ว", "Reset code sent to the verified email"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ส่งรหัสไม่สำเร็จ", "Failed to send reset code"));
    } finally { setBusy(false); }
  }

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await regweekJson<{ user: ManagedUser }>("/admin/users", {
        method: "POST",
        body: JSON.stringify(createDraft),
      });
      setCreatedPassword(createDraft.temporaryPassword);
      setCreateDraft(emptyCreate);
      setShowCreate(false);
      await loadUsers(result.user.sub);
      setNotice(t("สร้างบัญชีแล้ว โปรดส่งรหัสผ่านชั่วคราวให้ผู้ใช้อย่างปลอดภัย", "Account created. Deliver the temporary password to the user securely."));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("สร้างบัญชีไม่สำเร็จ", "Failed to create user"));
    } finally { setBusy(false); }
  }

  const enabledCount = users.filter((user) => user.enabled).length;

  return <div className="page page-wide user-management-page">
    {busy && <LoadingScreen overlay label={t("กำลังจัดการบัญชี", "Managing account…")} />}
    <NavBar onSignOut={signOutAndReset} />
    <BrandHeader title={t("จัดการผู้ใช้", "User Management")} home="/admin/users" description={t("สร้าง แก้ไข กำหนดสิทธิ์ และควบคุมการเข้าถึงบัญชีทั้งหมด", "Create, edit, assign roles, and control access for every account")} />
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <div className="notice-banner" role="status">{notice}</div>}
    {createdPassword && <div className="warning-banner created-password" role="status"><div><strong>{t("รหัสผ่านชั่วคราว (แสดงครั้งนี้)", "Temporary password (shown here)")}</strong><code>{createdPassword}</code></div><button type="button" className="secondary" onClick={() => { void navigator.clipboard.writeText(createdPassword); setNotice(t("คัดลอกรหัสผ่านแล้ว", "Password copied")); }}>{t("คัดลอก", "Copy")}</button><button type="button" className="secondary" onClick={() => setCreatedPassword(null)}>{t("ซ่อน", "Dismiss")}</button></div>}

    <section className="metric-grid" aria-label={t("สรุปบัญชี", "Account summary")}>
      <div className="metric"><span className="metric-label">{t("บัญชีทั้งหมด", "All accounts")}</span><span className="metric-value">{users.length}</span></div>
      <div className="metric"><span className="metric-label">{t("เปิดใช้งาน", "Enabled")}</span><span className="metric-value">{enabledCount}</span></div>
      <div className="metric"><span className="metric-label">{t("ผู้ดูแลระบบ", "Admins")}</span><span className="metric-value">{users.filter((user) => user.role === "admin").length}</span></div>
      <div className="metric"><span className="metric-label">{t("กรรมการ", "Committee")}</span><span className="metric-value">{users.filter((user) => user.role === "committee").length}</span></div>
    </section>

    <div className="user-management-heading"><div><span className="section-kicker">IDENTITY & ACCESS</span><h2>{t("บัญชีผู้ใช้", "User accounts")}</h2></div><button type="button" onClick={() => { setShowCreate((value) => !value); setCreatedPassword(null); if (!showCreate) setCreateDraft({ ...emptyCreate, temporaryPassword: randomTemporaryPassword() }); }}>{showCreate ? t("ยกเลิก", "Cancel") : t("สร้างผู้ใช้", "Create user")}</button></div>

    {showCreate && <form className="card user-create-card" onSubmit={handleCreate}>
      <div className="section-heading"><span className="section-kicker">NEW ACCOUNT</span><h2>{t("สร้างบัญชี", "Create account")}</h2></div>
      <div className="form-grid">
        <div className="field"><label htmlFor="new-user-name">{t("ชื่อที่แสดง", "Display name")}</label><input id="new-user-name" required minLength={2} maxLength={120} value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} /></div>
        <div className="field"><label htmlFor="new-user-email">{t("อีเมล / ชื่อเข้าสู่ระบบ", "Email / sign-in")}</label><input id="new-user-email" type="email" required value={createDraft.email} onChange={(event) => setCreateDraft((current) => ({ ...current, email: event.target.value }))} /></div>
        <div className="field"><label htmlFor="new-user-role">{t("บทบาท", "Role")}</label><select id="new-user-role" value={createDraft.role} onChange={(event) => setCreateDraft((current) => ({ ...current, role: event.target.value as UserRole }))}><option value="competitor">{roleLabel("competitor")}</option><option value="committee">{roleLabel("committee")}</option><option value="admin">{roleLabel("admin")}</option></select></div>
        <CompetitorIdInput id="new-user-competitor-id" label={t("หมายเลขผู้เข้าแข่งขัน (ถ้ามี)", "Competitor ID (optional)")} placeholder={t("เว้นว่างได้", "optional")} value={competitorIdDigits(createDraft.competitorId)} onChange={(digits) => setCreateDraft((current) => ({ ...current, competitorId: normaliseCompetitorId(digits) ?? "" }))} />
        <div className="field field-wide"><label htmlFor="new-user-password">{t("รหัสผ่านชั่วคราว", "Temporary password")}</label><div className="inline-control"><input id="new-user-password" type="text" required minLength={12} value={createDraft.temporaryPassword} onChange={(event) => setCreateDraft((current) => ({ ...current, temporaryPassword: event.target.value }))} /><button type="button" className="secondary" onClick={() => setCreateDraft((current) => ({ ...current, temporaryPassword: randomTemporaryPassword() }))}>{t("สร้างใหม่", "Regenerate")}</button></div><small>{t("อย่างน้อย 12 ตัว มีพิมพ์เล็ก พิมพ์ใหญ่ ตัวเลข และสัญลักษณ์ ผู้ใช้ต้องเปลี่ยนเมื่อเข้าสู่ระบบครั้งแรก", "At least 12 characters with upper/lowercase, number, and symbol. The user must change it at first sign-in.")}</small></div>
      </div>
      <div className="button-row"><button type="submit">{t("สร้างบัญชี", "Create account")}</button></div>
    </form>}

    <form className="card toolbar user-filter" onSubmit={(event) => event.preventDefault()}>
      <div className="field"><label htmlFor={searchId}>{t("ค้นหา", "Search")}</label><input id={searchId} type="search" placeholder={t("ชื่อ อีเมล หรือหมายเลขผู้เข้าแข่งขัน", "Name, email, or competitor ID")} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="field"><label htmlFor={roleFilterId}>{t("บทบาท", "Role")}</label><select id={roleFilterId} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "" | UserRole)}><option value="">{t("ทุกบทบาท", "All roles")}</option><option value="competitor">{roleLabel("competitor")}</option><option value="committee">{roleLabel("committee")}</option><option value="admin">{roleLabel("admin")}</option></select></div>
      <div className="field"><label htmlFor={accessFilterId}>{t("การเข้าถึง", "Access")}</label><select id={accessFilterId} value={accessFilter} onChange={(event) => setAccessFilter(event.target.value as typeof accessFilter)}><option value="">{t("ทุกสถานะ", "All states")}</option><option value="enabled">{t("เปิดใช้งาน", "Enabled")}</option><option value="disabled">{t("ปิดใช้งาน", "Disabled")}</option></select></div>
    </form>

    <div className="user-manager-layout">
      <section className="user-list" aria-label={t("รายชื่อผู้ใช้", "User list")}><p className="muted">{t(`พบ ${filteredUsers.length} บัญชี`, `${filteredUsers.length} accounts`)}</p>{filteredUsers.map((user) => <button key={user.sub} type="button" className="card user-select" aria-pressed={selectedSub === user.sub} onClick={() => chooseUser(user)}><span className="user-select-title"><strong>{user.name || t("ไม่มีชื่อ", "No name")}</strong>{user.sub === currentUserSub && <span className="status-badge success">{t("คุณ", "You")}</span>}</span><small>{user.email}</small><span className="user-select-meta"><span className={`status-badge role-${user.role}`}>{roleLabel(user.role)}</span><span className={`status-badge ${user.enabled ? "success" : "error"}`}>{user.enabled ? t("เปิด", "Enabled") : t("ปิด", "Disabled")}</span></span></button>)}{!filteredUsers.length && <div className="empty-state">{t("ไม่พบบัญชี", "No accounts match")}</div>}</section>
      <main>{!draft ? <div className="card empty-state">{t("เลือกบัญชีเพื่อดูและแก้ไข", "Select an account to review and edit")}</div> : <form className="card user-editor" onSubmit={handleSave}>
        <div className="section-heading user-editor-heading"><div><span className={`status-badge ${draft.enabled ? "success" : "error"}`}>{draft.enabled ? t("เปิดใช้งาน", "Enabled") : t("ปิดใช้งาน", "Disabled")}</span><h2>{draft.name || draft.email}</h2><p className="technical muted">{draft.sub}</p></div><span className={`status-badge role-${draft.role}`}>{roleLabel(draft.role)}</span></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="edit-user-name">{t("ชื่อที่แสดง", "Display name")}</label><input id="edit-user-name" required minLength={2} maxLength={120} value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} /></div>
          <div className="field"><label htmlFor="edit-user-email">{t("อีเมล / ชื่อเข้าสู่ระบบ", "Email / sign-in")}</label><input id="edit-user-email" type="email" required value={draft.email} onChange={(event) => setDraft((current) => current ? { ...current, email: event.target.value } : current)} /></div>
          <div className="field"><label htmlFor="edit-user-role">{t("บทบาท", "Role")}</label><select id="edit-user-role" value={draft.role} disabled={draft.sub === currentUserSub} onChange={(event) => setDraft((current) => current ? { ...current, role: event.target.value as UserRole } : current)}><option value="competitor">{roleLabel("competitor")}</option><option value="committee">{roleLabel("committee")}</option><option value="admin">{roleLabel("admin")}</option></select>{draft.sub === currentUserSub && <small>{t("ไม่สามารถเปลี่ยนบทบาทของบัญชีตนเอง", "You cannot change your own role")}</small>}</div>
          <CompetitorIdInput id="edit-user-competitor-id" label={t("หมายเลขผู้เข้าแข่งขัน (ถ้ามี)", "Competitor ID (optional)")} placeholder={t("เว้นว่างได้", "optional")} value={competitorIdDigits(draft.competitorId ?? "")} onChange={(digits) => setDraft((current) => current ? { ...current, competitorId: normaliseCompetitorId(digits) } : current)} />
        </div>
        <dl className="detail-list"><div><dt>{t("สถานะ Cognito", "Cognito status")}</dt><dd className="technical">{draft.status}</dd></div><div><dt>{t("สร้างเมื่อ", "Created")}</dt><dd>{dateTime(draft.createdAt)}</dd></div><div><dt>{t("แก้ไขล่าสุด", "Last modified")}</dt><dd>{dateTime(draft.lastModifiedAt)}</dd></div><div><dt>{t("ชื่อผู้ใช้ภายใน", "Internal username")}</dt><dd className="technical">{draft.username}</dd></div></dl>
        <div className="editor-actions user-editor-actions"><button type="submit">{t("บันทึกการเปลี่ยนแปลง", "Save changes")}</button><button type="button" className="secondary" onClick={() => { const source = users.find((user) => user.sub === draft.sub); if (source) setDraft({ ...source }); }}>{t("ยกเลิก", "Discard")}</button><button type="button" className="secondary" onClick={resetUserPassword}>{t("รีเซ็ตรหัสผ่าน", "Reset password")}</button><button type="button" className={draft.enabled ? "danger" : "secondary"} disabled={draft.sub === currentUserSub} onClick={toggleAccess}>{draft.enabled ? t("ปิดการเข้าถึง", "Disable access") : t("เปิดการเข้าถึง", "Enable access")}</button></div>
      </form>}</main>
    </div>
  </div>;
}

export default function AdminUsersPage() {
  return <LoginGate title={t("เข้าสู่ระบบผู้ดูแล", "Admin Login")}>{(actions) => <AdminUsersDashboard {...actions} />}</LoginGate>;
}
