import { useEffect, useId, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ApiClientError, ec2Json } from "./api";
import CompetitorIdInput from "./components/CompetitorIdInput";
import { normaliseCompetitorId } from "./competitorId";
import { t } from "./i18n";

/**
 * Shared pieces of the competition-day operator surface.
 *
 * The web app splits these across focused pages (check-in, inspection); the
 * packaged desktop console shows them together on one screen. Both use the
 * definitions here so the 4000 g limit, the stage list, and the scan handling
 * exist in exactly one place.
 */

export type Role = "admin" | "committee" | "competitor";
export type CompetitorStatus = "REGISTERED" | "CHECKED_IN" | "INSPECTED" | "RUN_COMPLETE";
export type InspectionStage =
  | "CHECK_IN" | "PRE_COMPETITION" | "ROUND_1" | "BEST_OF_4" | "BEST_OF_2" | "THE_BEST";

/** Rule 3.2 — shown so the inspector can see what the measurement is judged against. */
export const MAX_ROBOT_WEIGHT_GRAMS = 4000;

export interface WeightInspection {
  inspectionId: string;
  stage: InspectionStage;
  weightGrams: number;
  weightResult: "PASS" | "FAIL";
  weightLimitGrams: number;
  dimensionResult: "PASS" | "FAIL";
  voltageResult: "PASS" | "FAIL";
  result: "PASS" | "FAIL";
  notes: string | null;
  at: string;
}

export interface CompetitorCard {
  competitorId: string;
  teamName: string;
  category: string;
  status: CompetitorStatus;
  checkedInAt: string | null;
  inspectedAt: string | null;
  weightInspections: WeightInspection[];
}

// Rule 3.7(1): inspection is a standing power, so the robot is re-checked
// before each round rather than only once at the start of the day.
export const STAGES: Array<{ key: InspectionStage; title: string; description: string }> = [
  { key: "CHECK_IN", title: "ตรวจสภาพเมื่อเช็คอิน · Check-in inspection", description: "ตรวจครั้งแรกเมื่อทีมมาถึง" },
  { key: "PRE_COMPETITION", title: "ตรวจสภาพก่อนแข่งขัน · Pre-competition inspection", description: "ยืนยันอีกครั้งก่อนจัดทีมลงสนาม" },
  { key: "ROUND_1", title: "ก่อนรอบคัดเลือก · Before qualifying", description: "ตรวจซ้ำก่อนเริ่มรอบคัดเลือก" },
  { key: "BEST_OF_4", title: "ก่อนรอบ 8 ทีม · Before quarterfinals", description: "ตรวจซ้ำก่อนเริ่มรอบ" },
  { key: "BEST_OF_2", title: "ก่อนรอบรองชนะเลิศ · Before semifinals", description: "ตรวจซ้ำก่อนเริ่มรอบ" },
  { key: "THE_BEST", title: "ก่อนรอบชิงชนะเลิศ · Before finals", description: "ตรวจซ้ำก่อนเริ่มรอบ" },
];

export const EMPTY_BY_STAGE: Record<InspectionStage, string> = {
  CHECK_IN: "", PRE_COMPETITION: "", ROUND_1: "", BEST_OF_4: "", BEST_OF_2: "", THE_BEST: "",
};

export const STATUS_BADGE: Record<CompetitorStatus, string> = {
  REGISTERED: "warning", CHECKED_IN: "success", INSPECTED: "", RUN_COMPLETE: "",
};

export function latestInspection(items: WeightInspection[], stage: InspectionStage): WeightInspection | null {
  return [...items].reverse().find((item) => item.stage === stage) ?? null;
}

export function dateTime(value: string): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

export function checkInPassedFor(card: CompetitorCard | null): boolean {
  return card?.weightInspections.some((item) => item.stage === "CHECK_IN" && item.result === "PASS") ?? false;
}

/** Signed-in role, refreshed once per page. */
export function useRole(): Role {
  const [role, setRole] = useState<Role>("competitor");
  useEffect(() => {
    ec2Json<{ role: Role }>("/auth/me").then((result) => setRole(result.role)).catch(() => {});
  }, []);
  return role;
}

/**
 * Scan-or-type competitor lookup, shared by every operator page so a badge
 * scan behaves identically wherever it is pointed.
 */
export function useCompetitorLookup() {
  const [card, setCard] = useState<CompetitorCard | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function lookup(competitorId: string): Promise<void> {
    const id = normaliseCompetitorId(competitorId);
    if (!id) return;
    setError(null); setToast(null);
    try { setCard(await ec2Json<CompetitorCard>(`/competitors/${encodeURIComponent(id)}`)); }
    catch (err) {
      setCard(null);
      setError(err instanceof ApiClientError && err.status === 404
        ? t(`ไม่พบหมายเลข ${id}`, `Unknown competitor ID ${id}`)
        : err instanceof Error ? err.message : "Lookup failed");
    } finally { setInputValue(""); inputRef.current?.focus(); }
  }

  return { card, lookup, inputValue, setInputValue, inputRef, error, setError, toast, setToast, busy, setBusy };
}

interface ScanConsoleProps {
  value: string;
  onChange: (digits: string) => void;
  onSubmit: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

/** The badge scanner / manual entry box. */
export function ScanConsole({ value, onChange, onSubmit, inputRef }: ScanConsoleProps) {
  const [cameraActive, setCameraActive] = useState(false);
  const html5QrcodeRef = useRef<Html5Qrcode | null>(null);
  const inputId = useId();
  const readerId = `${inputId}-camera`.replace(/:/g, "");

  useEffect(() => () => { html5QrcodeRef.current?.stop().catch(() => {}); }, []);

  async function startCamera(): Promise<void> {
    setCameraActive(true);
    // The reader element only exists once cameraActive has rendered.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const scanner = new Html5Qrcode(readerId);
    html5QrcodeRef.current = scanner;
    try {
      await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (text) => {
        onChange(text);
        onSubmit();
      }, () => {});
    } catch { setCameraActive(false); }
  }

  async function stopCamera(): Promise<void> {
    await html5QrcodeRef.current?.stop().catch(() => {});
    setCameraActive(false);
  }

  return (
    <div className="card scan-console">
      <span className="section-kicker">{t("ค้นหาทีม", "Team lookup")}</span>
      <div className="scan-input-row">
        <CompetitorIdInput
          id={inputId} inputRef={inputRef}
          label={t("สแกนหรือกรอกหมายเลขผู้เข้าแข่งขัน", "Competitor ID")}
          value={value} onChange={onChange} onEnter={onSubmit} autoFocus
        />
        <button className="secondary scan-camera-btn" type="button" onClick={cameraActive ? stopCamera : startCamera}>
          {cameraActive ? t("หยุดกล้อง", "Stop camera") : t("ใช้กล้อง", "Use camera")}
        </button>
      </div>
      <p className="scan-hint">{t("สแกนคิวอาร์หรือพิมพ์หมายเลขแล้วกด Enter", "Scan the QR or type an ID, then press Enter")}</p>
      {cameraActive && <div className="scan-camera"><div id={readerId} /></div>}
    </div>
  );
}

/** Identity header shown above whatever action the page performs. */
export function CompetitorHeading({ card }: { card: CompetitorCard }) {
  return (
    <>
      <div className="scan-result-head">
        <span className="section-kicker technical">{card.competitorId}</span>
        <span className={`status-badge ${STATUS_BADGE[card.status]}`}>{card.status}</span>
      </div>
      <h2>{card.teamName}</h2>
      <p className="scan-category">{card.category}</p>
    </>
  );
}
