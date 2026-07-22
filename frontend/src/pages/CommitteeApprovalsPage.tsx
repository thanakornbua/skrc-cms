import { useEffect, useState } from "react";
import { ApiClientError, regweekJson } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";

interface PendingItem {
  sub: string;
  teamName: string;
  category: string;
  contactPhone: string;
  contactEmail: string;
  createdAt: string;
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
        <div className="card" key={item.sub}>
          <span className="status-badge warning">PENDING REVIEW</span>
          <p>
            <strong>{item.teamName}</strong> ({item.category})
          </p>
          <p>
            {item.contactEmail} · {item.contactPhone}
          </p>
          {rejectingSub === item.sub ? (
            <div className="field">
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
        </div>
      ))}
    </div>
  );
}

export default function CommitteeApprovalsPage() {
  return <LoginGate title="Committee Login">{(actions) => <CommitteeApprovalsDashboard {...actions} />}</LoginGate>;
}
