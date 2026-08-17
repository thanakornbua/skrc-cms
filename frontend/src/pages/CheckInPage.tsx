import { ec2Json } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";
import {
  CompetitorHeading, ScanConsole, dateTime, useCompetitorLookup, useRole,
} from "../competitorConsole";

/**
 * Check-in only. Rule 8.1(1) places check-in under general staff authority, so
 * committee members perform it; 8.1(2)'s admin-reserved list excludes it.
 */
function CheckInDashboard({ signOutAndReset }: { signOutAndReset: (message?: string) => Promise<void> }) {
  const role = useRole();
  const { card, lookup, inputValue, setInputValue, inputRef, error, setError, toast, setToast, busy, setBusy } =
    useCompetitorLookup();
  const mayCheckIn = role === "committee" || role === "admin";

  async function checkIn(): Promise<void> {
    if (!card || !mayCheckIn) return;
    setBusy(true); setError(null);
    try {
      await ec2Json(`/admin/competitors/${encodeURIComponent(card.competitorId)}/check-in`,
        { method: "POST", body: "{}" }, { retryNetwork: true });
      await lookup(card.competitorId);
      setToast(t("เช็คอินสำเร็จ ขั้นตอนถัดไปคือการตรวจสภาพ", "Checked in. Inspection is the next step."));
    } catch (err) { setError(err instanceof Error ? err.message : "Check-in failed"); }
    finally { setBusy(false); }
  }

  return <div className="page page-wide competition-console">
    {busy && <LoadingScreen overlay label="กำลังบันทึกข้อมูล / Saving…" />}
    <NavBar onSignOut={signOutAndReset} />
    <BrandHeader title="Check-in" home="/admin"
      description="รับรายงานตัวทีมที่ได้รับอนุมัติ / Register the arrival of approved teams" />

    <div role="status" aria-live="polite">{toast && <div className="notice-banner">{toast}</div>}</div>
    {error && <div className="error-banner" role="alert">{error}</div>}

    <div className="scan-layout">
      <ScanConsole value={inputValue} onChange={setInputValue} onSubmit={() => lookup(inputValue)} inputRef={inputRef} />

      {card ? <div className="card inspection-workspace">
        <CompetitorHeading card={card} />

        {card.status === "REGISTERED" ? <div className="inspection-gate">
          <p>{t("ทีมผ่านการอนุมัติแล้ว แต่ยังไม่ได้เช็คอิน", "Approved team awaiting check-in.")}</p>
          {mayCheckIn
            ? <button type="button" onClick={checkIn}>{t("เช็คอินทีม", "Check in team")}</button>
            : <div className="warning-banner">{t("ต้องให้กรรมการเช็คอินก่อน", "A committee member must check this team in.")}</div>}
        </div> : <div className="inspection-gate">
          <p>{t(`เช็คอินแล้วเมื่อ ${card.checkedInAt ? dateTime(card.checkedInAt) : "-"}`,
                `Checked in at ${card.checkedInAt ? dateTime(card.checkedInAt) : "-"}`)}</p>
          <p className="scan-hint">{t("ไปที่หน้าตรวจสภาพเพื่อดำเนินการต่อ", "Continue on the Inspection page.")}</p>
        </div>}
      </div> : <div className="card empty-state">{t("สแกนหรือกรอกหมายเลขเพื่อเริ่ม", "Scan or enter a competitor ID to begin")}</div>}
    </div>
  </div>;
}

export default function CheckInPage() {
  return <LoginGate title="Competition Staff Login">{(actions) => <CheckInDashboard {...actions} />}</LoginGate>;
}
