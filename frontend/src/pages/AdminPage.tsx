import { useEffect, useId, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { ApiClientError, ec2Json } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";

interface CompetitorListItem {
  competitorId: string;
  teamName: string;
  category: string;
  status: "REGISTERED" | "CHECKED_IN" | "INSPECTED" | "RUN_COMPLETE";
  disqualified: { bool: boolean };
}

interface CompetitorDetail extends CompetitorListItem {
  checkedInAt: string | null;
  inspectedAt: string | null;
}

function AdminDashboard({ signOutAndReset }: { signOutAndReset: () => Promise<void> }) {
  const [role, setRole] = useState<"admin" | "committee" | "competitor">("competitor");
  const [items, setItems] = useState<CompetitorListItem[]>([]);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<CompetitorDetail | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [badgeDataUrl, setBadgeDataUrl] = useState<string | null>(null);
  const searchId = useId();
  const categoryId = useId();
  const statusId = useId();

  useEffect(() => {
    ec2Json<{ role: "admin" | "committee" | "competitor" }>("/auth/me")
      .then((me) => setRole(me.role))
      .catch(() => {});
  }, []);

  async function loadList(): Promise<void> {
    const term = q.trim();
    if (!term) {
      setItems([]);
      setSelectedId(null);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (status) params.set("status", status);
      params.set("q", term);
      const query = params.toString();
      const result = await ec2Json<{ items: CompetitorListItem[] }>(
        `/admin/competitors${query ? `?${query}` : ""}`
      );
      setItems(result.items);
      setHasSearched(true);
      setLoadError(null);
    } catch (err) {
      setHasSearched(true);
      setLoadError(err instanceof Error ? err.message : "Failed to load competitors");
    } finally {
      setSearching(false);
    }
  }

  function handleSearch(event: FormEvent): void {
    event.preventDefault();
    loadList();
  }

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    ec2Json<CompetitorDetail>(`/competitors/${encodeURIComponent(selectedId)}`)
      .then((result) => {
        if (!cancelled) setSelected(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setActionError(err instanceof Error ? err.message : "Failed to load competitor");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selected || !selected.checkedInAt) {
      setBadgeDataUrl(null);
      return;
    }
    QRCode.toDataURL(selected.competitorId, { margin: 1, width: 220 }).then(setBadgeDataUrl);
  }, [selected]);

  async function handleCheckIn(): Promise<void> {
    if (!selectedId) return;
    setActionError(null);
    setBusy(true);
    try {
      await ec2Json(`/admin/competitors/${encodeURIComponent(selectedId)}/check-in`, {
        method: "POST",
      });
      const result = await ec2Json<CompetitorDetail>(
        `/competitors/${encodeURIComponent(selectedId)}`
      );
      setSelected(result);
      await loadList();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Check-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordReset(): Promise<void> {
    if (!selectedId || !window.confirm(
      t(`ส่งรหัสรีเซ็ตรหัสผ่านสำหรับ ${selectedId} ไปยังอีเมลที่ยืนยันแล้วหรือไม่?`, `Send a password reset code for ${selectedId} to the verified email?`)
    )) return;
    setActionError(null);
    setActionNotice(null);
    setBusy(true);
    try {
      await ec2Json(`/admin/competitors/${encodeURIComponent(selectedId)}/reset-password`, {
        method: "POST",
      });
      setActionNotice(t("ส่งรหัสแล้ว ให้ผู้เข้าแข่งขันเลือก ‘ลืมรหัสผ่าน’ แล้ว ‘มีรหัสแล้ว’", "Code sent. Ask the competitor to choose ‘Forgot password’, then ‘I already have a code’."));
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Password reset failed");
    } finally {
      setBusy(false);
    }
  }

  function handlePrintBadge(): void {
    window.print();
  }

  return (
    <div className="page page-wide" id="admin-app-shell">
      {(busy || searching) && <LoadingScreen overlay label={searching ? "กำลังค้นหา / Searching…" : "กำลังดำเนินการ / Working…"} />}
      <NavBar onSignOut={signOutAndReset} />
      <BrandHeader title="Admin — Competitors" home="/admin" description="เช็คอิน ค้นหา และพิมพ์บัตร / Check in, search, and print credentials" />

      {loadError && <div className="error-banner" role="alert">{loadError}</div>}
      {actionError && <div className="error-banner" role="alert">{actionError}</div>}
      {actionNotice && <div className="notice-banner" role="status">{actionNotice}</div>}

      <form className="card toolbar admin-search" onSubmit={handleSearch}>
        <div className="field"><label htmlFor={searchId}>{t("ค้นหาทีม", "Search team")}</label><input id={searchId} type="search" placeholder={t("ชื่อทีมหรือหมายเลข", "Team or ID")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field"><label htmlFor={categoryId}>{t("ประเภท", "Category")}</label><select id={categoryId} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          <option value="Line Tracing - Open">Line Tracing - Open</option>
        </select></div>
        <div className="field"><label htmlFor={statusId}>{t("สถานะ", "Status")}</label><select id={statusId} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="REGISTERED">Registered</option>
          <option value="CHECKED_IN">Checked in</option>
          <option value="INSPECTED">Inspected</option>
          <option value="RUN_COMPLETE">Run complete</option>
        </select></div>
        <button type="submit" disabled={searching || !q.trim()}>{searching ? t("กำลังค้นหา", "Searching") : t("ค้นหา", "Search")}</button>
      </form>

      <div className="split-layout">
        <div>
          {items.map((item) => (
            <button
              type="button"
              className="card competitor-select"
              key={item.competitorId}
              aria-pressed={selectedId === item.competitorId}
              onClick={() => setSelectedId(item.competitorId)}
            >
              <strong className="technical">{item.competitorId}</strong> — {item.teamName}
              <br />
              {item.category} · <span className={`status-badge ${item.disqualified.bool ? "error" : ""}`}>{item.disqualified.bool ? "DQ" : item.status}</span>
            </button>
          ))}
          {!hasSearched && <div className="empty-state">{t("กรอกชื่อทีมหรือหมายเลขแล้วกดค้นหา", "Enter a team name or competitor number, then search")}</div>}
          {hasSearched && items.length === 0 && <div className="empty-state">{t("ไม่พบผู้เข้าแข่งขัน", "No competitors match")}</div>}
        </div>

        {selected && (
          <div className="card">
            <span className="status-badge">{selected.status}</span>
            <h2 className="technical">{selected.competitorId}</h2>
            <p>{selected.teamName}</p>
            <p>{selected.category}</p>
            <p>{t("เช็คอิน", "Checked in")}: <span className="technical">{selected.checkedInAt ?? "—"}</span></p>
            <p>{t("ตรวจสภาพ", "Inspected")}: <span className="technical">{selected.inspectedAt ?? "—"}</span></p>

            {selected.status === "REGISTERED" && (
              <button type="button" disabled={busy} onClick={handleCheckIn}>{t("เช็คอิน", "Check in")}</button>
            )}
            {selected.checkedInAt && (
              <button className="secondary" type="button" onClick={handlePrintBadge}>
                {t("พิมพ์บัตร", "Print badge")}
              </button>
            )}
            {role === "admin" && (
              <button className="secondary" type="button" disabled={busy} onClick={handlePasswordReset}>
                {t("ช่วยรีเซ็ตรหัสผ่านพอร์ทัล", "Send portal reset code")}
              </button>
            )}
          </div>
        )}
      </div>

      {selected && badgeDataUrl && (
        <div id="print-badge-area">
          <div className="badge-accent-bar" />
          <div className="badge-content">
            <div className="skrc-eyebrow skrc-gradient-text badge-eyebrow">SKRC · ROBOTICS COMPETITION</div>
            <img className="badge-qr" src={badgeDataUrl} alt={`QR code for ${selected.competitorId}`} />
            <div className="badge-competitor-id">{selected.competitorId}</div>
            <div className="badge-name">{selected.teamName}</div>
            <div className="badge-category">{selected.category}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  return <LoginGate title="Staff Login">{(actions) => <AdminDashboard {...actions} />}</LoginGate>;
}
