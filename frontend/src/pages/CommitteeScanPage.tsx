import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ApiClientError, ec2Json } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";

interface CompetitorCard {
  competitorId: string;
  teamName: string;
  category: string;
  status: "REGISTERED" | "CHECKED_IN" | "INSPECTED" | "RUN_COMPLETE";
}

const CAMERA_READER_ID = "committee-scan-camera-reader";

function CommitteeScanDashboard({ signOutAndReset }: { signOutAndReset: () => Promise<void> }) {
  const [inputValue, setInputValue] = useState("");
  const [card, setCard] = useState<CompetitorCard | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const html5QrcodeRef = useRef<Html5Qrcode | null>(null);
  const inputId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      html5QrcodeRef.current?.stop().catch(() => {});
    };
  }, []);

  async function lookup(competitorId: string): Promise<void> {
    const id = competitorId.trim();
    if (!id) return;

    setLookupError(null);
    setToast(null);
    try {
      const result = await ec2Json<CompetitorCard>(`/competitors/${encodeURIComponent(id)}`);
      setCard(result);
    } catch (err) {
      setCard(null);
      setLookupError(
        err instanceof ApiClientError && err.status === 404
          ? `Unknown competitor ID "${id}"`
          : err instanceof Error
            ? err.message
            : "Lookup failed"
      );
    } finally {
      setInputValue("");
      inputRef.current?.focus();
    }
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter") {
      e.preventDefault();
      lookup(inputValue);
    }
  }

  async function handleMarkInspected(): Promise<void> {
    if (!card) return;
    setBusy(true);
    setLookupError(null);
    try {
      const result = await ec2Json<{ status: string; inspectedAt: string }>(
        `/committee/competitors/${encodeURIComponent(card.competitorId)}/inspect`,
        { method: "POST" }
      );
      setCard({ ...card, status: "INSPECTED" });
      setToast(`${card.competitorId} marked inspected at ${result.inspectedAt}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "NOT_CHECKED_IN") {
        setLookupError(`${card.competitorId} has not checked in yet — cannot inspect.`);
      } else {
        setLookupError(err instanceof Error ? err.message : "Inspect failed");
      }
    } finally {
      setBusy(false);
      setCard(null);
      setInputValue("");
      inputRef.current?.focus();
    }
  }

  async function startCamera(): Promise<void> {
    setCameraActive(true);
    setTimeout(async () => {
      const instance = new Html5Qrcode(CAMERA_READER_ID);
      html5QrcodeRef.current = instance;
      try {
        await instance.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          async (decodedText) => {
            await instance.stop().catch(() => {});
            setCameraActive(false);
            await lookup(decodedText);
          },
          undefined
        );
      } catch (err) {
        setLookupError(err instanceof Error ? err.message : "Could not start camera");
        setCameraActive(false);
      }
    }, 0);
  }

  async function stopCamera(): Promise<void> {
    await html5QrcodeRef.current?.stop().catch(() => {});
    setCameraActive(false);
  }

  return (
    <div className="page">
      {busy && <LoadingScreen overlay label="กำลังบันทึกผลตรวจ / Saving inspection…" />}
      <NavBar onSignOut={signOutAndReset} />
      <BrandHeader title="Inspection Scan" home="/committee/approvals" description="สแกนหมายเลขผู้เข้าแข่งขันหลังเช็คอิน / Scan after competitor check-in" />

      <div role="status" aria-live="polite">{toast && <div className="notice-banner">{toast}</div>}</div>
      {lookupError && <div className="error-banner" role="alert">{lookupError}</div>}

      <div className="card">
      <div className="field">
        <label htmlFor={inputId}>{t("สแกนหรือกรอกหมายเลขผู้เข้าแข่งขัน", "Competitor ID")}</label>
        <input
          id={inputId}
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleInputKeyDown}
          autoFocus
          placeholder="C-0042"
        />
      </div>

      {!cameraActive ? (
        <button className="secondary" type="button" onClick={startCamera}>
          {t("ใช้กล้อง", "Use camera")}
        </button>
      ) : (
        <button className="secondary" type="button" onClick={stopCamera}>
          {t("หยุดกล้อง", "Stop camera")}
        </button>
      )}
      <div id={CAMERA_READER_ID} style={{ width: "100%", maxWidth: 320, marginTop: "0.5rem" }} />
      </div>

      {card && (
        <div className="card">
          <span className={`status-badge ${card.status === "CHECKED_IN" ? "success" : "warning"}`}>{card.status}</span>
          <h2 className="technical">{card.competitorId}</h2>
          <p>{card.teamName}</p>
          <p>{card.category}</p>
          <p>Status: {card.status}</p>
          <button type="button" disabled={busy} onClick={handleMarkInspected}>{t("ผ่านการตรวจ", "Mark inspected")}</button>
        </div>
      )}
    </div>
  );
}

export default function CommitteeScanPage() {
  return <LoginGate title="Committee Login">{(actions) => <CommitteeScanDashboard {...actions} />}</LoginGate>;
}
