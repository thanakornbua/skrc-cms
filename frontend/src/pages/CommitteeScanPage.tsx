import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ApiClientError, ec2Json } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";

type CompetitorStatus = "REGISTERED" | "CHECKED_IN" | "INSPECTED" | "RUN_COMPLETE";

interface CompetitorCard {
  competitorId: string;
  teamName: string;
  category: string;
  status: CompetitorStatus;
}

const CAMERA_READER_ID = "committee-scan-camera-reader";

/** Semantic status-badge class per competitor state (see status-badge in CSS). */
const STATUS_BADGE: Record<CompetitorStatus, string> = {
  REGISTERED: "warning",
  CHECKED_IN: "success",
  INSPECTED: "",
  RUN_COMPLETE: "",
};

/** Whether this competitor can be inspected now — drives the verdict rule/CTA. */
type Verdict = "ready" | "blocked" | "done";
function verdictFor(status: CompetitorStatus): Verdict {
  if (status === "CHECKED_IN") return "ready";
  if (status === "REGISTERED") return "blocked";
  return "done"; // INSPECTED | RUN_COMPLETE
}

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

  const verdict = card ? verdictFor(card.status) : null;

  return (
    <div className="page page-mid">
      {busy && <LoadingScreen overlay label="กำลังบันทึกผลตรวจ / Saving inspection…" />}
      <NavBar onSignOut={signOutAndReset} />
      <BrandHeader title="Inspection Scan" home="/committee/approvals" description="สแกนหมายเลขผู้เข้าแข่งขันหลังเช็คอิน / Scan after competitor check-in" />

      <div role="status" aria-live="polite">{toast && <div className="notice-banner">{toast}</div>}</div>
      {lookupError && <div className="error-banner" role="alert">{lookupError}</div>}

      <div className="split-layout scan-layout">
        <div className="card scan-console">
          <span className="section-kicker">{t("สแกน", "Scan")}</span>
          <div className="scan-input-row">
            <div className="field">
              <label htmlFor={inputId}>{t("สแกนหรือกรอกหมายเลขผู้เข้าแข่งขัน", "Competitor ID")}</label>
              <input
                id={inputId}
                ref={inputRef}
                className="technical"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleInputKeyDown}
                autoFocus
                placeholder="C-0042"
              />
            </div>
            <button
              className="secondary scan-camera-btn"
              type="button"
              onClick={cameraActive ? stopCamera : startCamera}
            >
              {cameraActive ? t("หยุดกล้อง", "Stop camera") : t("ใช้กล้อง", "Use camera")}
            </button>
          </div>
          <p className="scan-hint">{t("สแกนคิวอาร์หรือพิมพ์หมายเลขแล้วกด Enter", "Scan the QR or type an ID, then press Enter")}</p>
          {cameraActive && (
            <div className="scan-camera">
              <div id={CAMERA_READER_ID} />
            </div>
          )}
        </div>

        {card && verdict ? (
          <div className="card scan-result" data-verdict={verdict}>
            <div className="scan-result-head">
              <span className="section-kicker technical">{card.competitorId}</span>
              <span className={`status-badge ${STATUS_BADGE[card.status]}`}>{card.status}</span>
            </div>
            <h2>{card.teamName}</h2>
            <p className="scan-category">{card.category}</p>

            {verdict === "ready" && (
              <button className="scan-action" type="button" disabled={busy} onClick={handleMarkInspected}>
                {t("ผ่านการตรวจ", "Mark inspected")}
              </button>
            )}
            {verdict === "blocked" && (
              <p className="warning-banner">{t("ต้องเช็คอินก่อนจึงจะตรวจสภาพได้", "Competitor must check in before inspection.")}</p>
            )}
            {verdict === "done" && (
              <p className="notice-banner">
                {card.status === "INSPECTED"
                  ? t("ผ่านการตรวจแล้ว", "Already inspected.")
                  : t("แข่งขันเสร็จแล้ว", "Run complete — inspection no longer applicable.")}
              </p>
            )}
          </div>
        ) : (
          <div className="empty-state scan-empty">
            {t("สแกนผู้เข้าแข่งขันเพื่อดูสถานะการตรวจสภาพ", "Scan a competitor to see their inspection status.")}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CommitteeScanPage() {
  return <LoginGate title="Committee Login">{(actions) => <CommitteeScanDashboard {...actions} />}</LoginGate>;
}
