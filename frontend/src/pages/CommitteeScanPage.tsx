import { useEffect, useId, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ApiClientError, ec2Json } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";
import CompetitorIdInput from "../components/CompetitorIdInput";
import { normaliseCompetitorId } from "../competitorId";

type Role = "admin" | "committee" | "competitor";
type CompetitorStatus = "REGISTERED" | "CHECKED_IN" | "INSPECTED" | "RUN_COMPLETE";
type InspectionStage = "CHECK_IN" | "PRE_COMPETITION" | "ROUND_1" | "BEST_OF_4" | "BEST_OF_2" | "THE_BEST";

/** Rule 3.2 — shown so the inspector can see what the measurement is judged against. */
const MAX_ROBOT_WEIGHT_GRAMS = 4000;

interface WeightInspection {
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

interface CompetitorCard {
  competitorId: string;
  teamName: string;
  category: string;
  status: CompetitorStatus;
  checkedInAt: string | null;
  inspectedAt: string | null;
  weightInspections: WeightInspection[];
}

interface HardwareDevice {
  deviceId: string;
  laneId: string;
  serialPort: string;
  state: "CONNECTED" | "DISCONNECTED" | "ERROR";
  detail: string | null;
  lastSeenAt: string;
  online: boolean;
}

interface Lane {
  laneId: string;
  state: "IDLE" | "ASSIGNED" | "ARMED" | "RUNNING";
  competitorId: string | null;
  deviceId: string | null;
  armedBy: string | null;
  runStartedAt: string | null;
}

const CAMERA_READER_ID = "committee-scan-camera-reader";
// Rule 3.7(1): inspection is a standing power, so the robot is re-checked
// before each round rather than only once at the start of the day.
const STAGES: Array<{ key: InspectionStage; title: string; description: string }> = [
  { key: "CHECK_IN", title: "ตรวจสภาพเมื่อเช็คอิน · Check-in inspection", description: "ตรวจครั้งแรกเมื่อทีมมาถึง" },
  { key: "PRE_COMPETITION", title: "ตรวจสภาพก่อนแข่งขัน · Pre-competition inspection", description: "ยืนยันอีกครั้งก่อนจัดทีมลงสนาม" },
  { key: "ROUND_1", title: "ก่อนรอบคัดเลือก · Before qualifying", description: "ตรวจซ้ำก่อนเริ่มรอบคัดเลือก" },
  { key: "BEST_OF_4", title: "ก่อนรอบ 8 ทีม · Before quarterfinals", description: "ตรวจซ้ำก่อนเริ่มรอบ" },
  { key: "BEST_OF_2", title: "ก่อนรอบรองชนะเลิศ · Before semifinals", description: "ตรวจซ้ำก่อนเริ่มรอบ" },
  { key: "THE_BEST", title: "ก่อนรอบชิงชนะเลิศ · Before finals", description: "ตรวจซ้ำก่อนเริ่มรอบ" },
];

const EMPTY_BY_STAGE: Record<InspectionStage, string> = {
  CHECK_IN: "", PRE_COMPETITION: "", ROUND_1: "", BEST_OF_4: "", BEST_OF_2: "", THE_BEST: "",
};

const STATUS_BADGE: Record<CompetitorStatus, string> = {
  REGISTERED: "warning", CHECKED_IN: "success", INSPECTED: "", RUN_COMPLETE: "",
};

function latestInspection(items: WeightInspection[], stage: InspectionStage): WeightInspection | null {
  return [...items].reverse().find((item) => item.stage === stage) ?? null;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

function CommitteeScanDashboard({ signOutAndReset }: { signOutAndReset: () => Promise<void> }) {
  const [role, setRole] = useState<Role>("competitor");
  const [inputValue, setInputValue] = useState("");
  const [card, setCard] = useState<CompetitorCard | null>(null);
  const [weights, setWeights] = useState<Record<InspectionStage, string>>({ ...EMPTY_BY_STAGE });
  const [notes, setNotes] = useState<Record<InspectionStage, string>>({ ...EMPTY_BY_STAGE });
  const [hardware, setHardware] = useState<HardwareDevice[]>([]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [assignValues, setAssignValues] = useState<Record<string, string>>({});
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const html5QrcodeRef = useRef<Html5Qrcode | null>(null);
  const inputId = useId();

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => () => { html5QrcodeRef.current?.stop().catch(() => {}); }, []);
  useEffect(() => {
    ec2Json<{ role: Role }>("/auth/me").then((result) => setRole(result.role)).catch(() => {});
    let active = true;
    const poll = () => Promise.all([
      ec2Json<{ devices: HardwareDevice[] }>("/admin/hardware"),
      ec2Json<{ lanes: Lane[] }>("/admin/lanes"),
    ]).then(([hardwareResult, laneResult]) => {
      if (active) { setHardware(hardwareResult.devices); setLanes(laneResult.lanes); }
    }).catch(() => { if (active) { setHardware([]); setLanes([]); } });
    poll();
    const interval = window.setInterval(poll, 10_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  async function lookup(competitorId: string): Promise<void> {
    const id = normaliseCompetitorId(competitorId);
    if (!id) return;
    setLookupError(null); setToast(null);
    try { setCard(await ec2Json<CompetitorCard>(`/competitors/${encodeURIComponent(id)}`)); }
    catch (error) {
      setCard(null);
      setLookupError(error instanceof ApiClientError && error.status === 404
        ? t(`ไม่พบหมายเลข ${id}`, `Unknown competitor ID ${id}`)
        : error instanceof Error ? error.message : "Lookup failed");
    } finally { setInputValue(""); inputRef.current?.focus(); }
  }

  async function checkIn(): Promise<void> {
    if (!card || (role !== "committee" && role !== "admin")) return;
    setBusy(true); setLookupError(null);
    try {
      await ec2Json(`/admin/competitors/${encodeURIComponent(card.competitorId)}/check-in`, { method: "POST", body: "{}" }, { retryNetwork: true });
      await lookup(card.competitorId);
      setToast(t("เช็คอินสำเร็จ กรุณาชั่งน้ำหนักครั้งแรก", "Checked in. Record the first weigh-in."));
    } catch (error) { setLookupError(error instanceof Error ? error.message : "Check-in failed"); }
    finally { setBusy(false); }
  }

  /**
   * The weight verdict is not sent: the server derives it from the measurement
   * against Rule 3.2's 4000 g limit, and the overall verdict is the conjunction
   * of all three checks. Dimension (3.1) and voltage (3.3) stay inspector calls.
   */
  async function submitInspection(
    stage: InspectionStage,
    dimensionResult: "PASS" | "FAIL",
    voltageResult: "PASS" | "FAIL",
  ): Promise<void> {
    if (!card) return;
    const weightGrams = Number(weights[stage]);
    if (!Number.isFinite(weightGrams) || weightGrams <= 0) {
      setLookupError(t("กรุณากรอกน้ำหนักเป็นกรัม", "Enter a valid weight in grams."));
      return;
    }
    setBusy(true); setLookupError(null);
    try {
      const saved = await ec2Json<{ inspection: WeightInspection }>(`/committee/competitors/${encodeURIComponent(card.competitorId)}/weight-inspections`, {
        method: "POST",
        body: JSON.stringify({
          inspectionId: crypto.randomUUID(), stage, weightGrams, dimensionResult, voltageResult,
          notes: notes[stage].trim() || undefined,
        }),
      }, { retryNetwork: true });
      setWeights((current) => ({ ...current, [stage]: "" }));
      setNotes((current) => ({ ...current, [stage]: "" }));
      await lookup(card.competitorId);
      setToast(saved.inspection.result === "PASS"
        ? t("บันทึกผลผ่านการตรวจแล้ว", "Passing inspection recorded.")
        : t("บันทึกผลไม่ผ่านแล้ว สามารถตรวจซ้ำได้", "Failed inspection recorded; reinspection remains available."));
    } catch (error) { setLookupError(error instanceof Error ? error.message : "Inspection failed"); }
    finally { setBusy(false); }
  }

  async function startCamera(): Promise<void> {
    setCameraActive(true);
    window.setTimeout(async () => {
      const instance = new Html5Qrcode(CAMERA_READER_ID);
      html5QrcodeRef.current = instance;
      try {
        await instance.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, async (text) => {
          await instance.stop().catch(() => {}); setCameraActive(false); await lookup(text);
        }, undefined);
      } catch (error) {
        setLookupError(error instanceof Error ? error.message : "Could not start camera"); setCameraActive(false);
      }
    }, 0);
  }

  async function stopCamera(): Promise<void> {
    await html5QrcodeRef.current?.stop().catch(() => {}); setCameraActive(false);
  }

  async function laneAction(laneId: string, action: "assign" | "arm" | "reset", competitorId?: string): Promise<void> {
    if (role !== "admin") return;
    if (action === "reset" && !window.confirm(t("ยืนยันการรีเซ็ตสนามนี้", "Reset this lane?"))) return;
    setBusy(true); setLookupError(null);
    try {
      await ec2Json(`/admin/lanes/${encodeURIComponent(laneId)}/${action}`, {
        method: "POST",
        body: JSON.stringify(competitorId ? { competitorId } : {}),
      });
      const result = await ec2Json<{ lanes: Lane[] }>("/admin/lanes");
      setLanes(result.lanes);
      setAssignValues((current) => ({ ...current, [laneId]: "" }));
      setToast(t("อัปเดตสถานะสนามแล้ว", "Lane status updated."));
    } catch (error) { setLookupError(error instanceof Error ? error.message : "Lane action failed"); }
    finally { setBusy(false); }
  }

  const checkInPassed = card?.weightInspections.some((item) => item.stage === "CHECK_IN" && item.result === "PASS") ?? false;

  return <div className="page page-wide competition-console">
    {busy && <LoadingScreen overlay label="กำลังบันทึกข้อมูล / Saving…" />}
    <NavBar onSignOut={signOutAndReset} />
    <BrandHeader title="Competition Day Console" home="/admin" description="เช็คอิน ชั่งน้ำหนัก ตรวจสภาพ และตรวจการเชื่อมต่อสนาม / Check-in, weigh, inspect, and monitor lane hardware" />

    <section className="hardware-strip" aria-label={t("สถานะอุปกรณ์", "Hardware status")}>
      <div><span className="section-kicker">ARDUINO COMMUNICATION</span><strong>{hardware.some((item) => item.online) ? t("ระบบจับเวลาพร้อม", "Timing system ready") : t("ยังไม่พบอุปกรณ์", "No live device")}</strong></div>
      <div className="hardware-devices">
        {hardware.map((device) => <div className="hardware-device" data-online={device.online} key={device.deviceId}>
          <span className="hardware-dot" aria-hidden="true" />
          <span><strong>{device.deviceId}</strong><small>{device.online ? `${device.serialPort} · ${t("สนาม", "Lane")} ${device.laneId}` : t("ขาดการเชื่อมต่อ", "Offline")}</small></span>
        </div>)}
        {hardware.length === 0 && <span className="technical">{t("ตั้งค่า UNO_DEVICE_ID และ LANES ก่อนเริ่มงาน", "Configure UNO_DEVICE_ID and LANES before the event.")}</span>}
      </div>
    </section>

    <div role="status" aria-live="polite">{toast && <div className="notice-banner">{toast}</div>}</div>
    {lookupError && <div className="error-banner" role="alert">{lookupError}</div>}

    <div className="scan-layout">
      <div className="card scan-console">
        <span className="section-kicker">{t("ค้นหาทีม", "Team lookup")}</span>
        <div className="scan-input-row">
          <CompetitorIdInput id={inputId} inputRef={inputRef} label={t("สแกนหรือกรอกหมายเลขผู้เข้าแข่งขัน", "Competitor ID")}
            value={inputValue} onChange={setInputValue} onEnter={() => lookup(inputValue)} autoFocus />
          <button className="secondary scan-camera-btn" type="button" onClick={cameraActive ? stopCamera : startCamera}>{cameraActive ? t("หยุดกล้อง", "Stop camera") : t("ใช้กล้อง", "Use camera")}</button>
        </div>
        <p className="scan-hint">{t("สแกนคิวอาร์หรือพิมพ์หมายเลขแล้วกด Enter", "Scan the QR or type an ID, then press Enter")}</p>
        {cameraActive && <div className="scan-camera"><div id={CAMERA_READER_ID} /></div>}
      </div>

      {card ? <div className="card inspection-workspace">
        <div className="scan-result-head"><span className="section-kicker technical">{card.competitorId}</span><span className={`status-badge ${STATUS_BADGE[card.status]}`}>{card.status}</span></div>
        <h2>{card.teamName}</h2><p className="scan-category">{card.category}</p>

        {card.status === "REGISTERED" && <div className="inspection-gate">
          <p>{t("ทีมผ่านการอนุมัติแล้ว แต่ยังไม่ได้เช็คอิน", "Approved team awaiting check-in.")}</p>
          {role === "committee" || role === "admin" ? <button type="button" onClick={checkIn}>{t("เช็คอินทีม", "Check in team")}</button> : <div className="warning-banner">{t("ต้องให้กรรมการเช็คอินก่อน", "A committee member must check this team in.")}</div>}
        </div>}

        {card.status !== "REGISTERED" && <div className="inspection-stage-grid">
          {STAGES.map((stage, index) => {
            const latest = latestInspection(card.weightInspections, stage.key);
            const enabled = stage.key === "CHECK_IN" || checkInPassed;
            const typedWeight = Number(weights[stage.key]);
            const overWeight = Number.isFinite(typedWeight) && typedWeight > MAX_ROBOT_WEIGHT_GRAMS;
            const completed = latest?.result === "PASS";
            return <section className="inspection-stage" data-complete={completed} key={stage.key}>
              <header><span className="inspection-step">{index + 1}</span><div><h3>{stage.title}</h3><p>{stage.description}</p></div></header>
              {latest && <div className={`inspection-reading ${latest.result === "PASS" ? "success" : "error"}`}>
                <strong>{(latest.weightGrams / 1000).toFixed(3)} kg</strong><span>{latest.result} · {dateTime(latest.at)}</span>
                <small className="inspection-breakdown">
                  {t("น้ำหนัก", "Weight")}: {latest.weightResult} · {t("ขนาด", "Size")}: {latest.dimensionResult} · {t("แรงดัน", "Voltage")}: {latest.voltageResult}
                </small>
                {latest.notes && <small>{latest.notes}</small>}
              </div>}
              {!completed && enabled && <form onSubmit={(event) => { event.preventDefault(); submitInspection(stage.key, "PASS", "PASS"); }}>
                <div className="field"><label htmlFor={`${stage.key}-weight`}>{t(`น้ำหนักหุ่นยนต์ (กรัม, ไม่เกิน ${MAX_ROBOT_WEIGHT_GRAMS})`, `Robot weight (grams, limit ${MAX_ROBOT_WEIGHT_GRAMS})`)}</label><input id={`${stage.key}-weight`} type="number" min="1" max="100000" step="0.1" inputMode="decimal" required value={weights[stage.key]} onChange={(e) => setWeights((current) => ({ ...current, [stage.key]: e.target.value }))} placeholder="2500" /></div>
                <div className="field"><label htmlFor={`${stage.key}-notes`}>{t("หมายเหตุ", "Notes")}</label><input id={`${stage.key}-notes`} maxLength={500} value={notes[stage.key]} onChange={(e) => setNotes((current) => ({ ...current, [stage.key]: e.target.value }))} /></div>
                {overWeight && <p className="inspection-overweight" role="alert">
                  {t(`เกินพิกัด ${MAX_ROBOT_WEIGHT_GRAMS} กรัม ตามข้อ 3.2 — ระบบจะบันทึกเป็นไม่ผ่าน`,
                     `Over the ${MAX_ROBOT_WEIGHT_GRAMS} g limit (Rule 3.2) — this will be recorded as a fail.`)}
                </p>}
                <div className="inspection-actions">
                  <button type="submit">{t("ขนาดและแรงดันผ่าน", "Size & voltage pass")}</button>
                  <button className="danger" type="button" onClick={() => submitInspection(stage.key, "FAIL", "PASS")}>{t("ขนาดไม่ผ่าน", "Size fail")}</button>
                  <button className="danger" type="button" onClick={() => submitInspection(stage.key, "PASS", "FAIL")}>{t("แรงดันไม่ผ่าน", "Voltage fail")}</button>
                </div>
              </form>}
              {!enabled && <p className="inspection-locked">{t("ต้องผ่านการชั่งน้ำหนักเมื่อเช็คอินก่อน", "Pass the check-in weigh-in first.")}</p>}
            </section>;
          })}
        </div>}
      </div> : <div className="empty-state scan-empty">{t("สแกนผู้เข้าแข่งขันเพื่อเริ่มขั้นตอน", "Scan a competitor to begin.")}</div>}
    </div>

    <section className="competition-lanes" aria-labelledby="competition-lanes-title">
      <div className="section-heading"><span className="section-kicker">LANE CONTROL</span><h2 id="competition-lanes-title">{t("จัดทีมลงสนามและเตรียมจับเวลา", "Assign and arm lanes")}</h2></div>
      <div className="competition-lane-grid">
        {lanes.map((lane) => {
          const candidate = normaliseCompetitorId(assignValues[lane.laneId] ?? "");
          return <article className="card competition-lane" data-state={lane.state} key={lane.laneId}>
            <header><div><span className="technical">{t("สนาม", "LANE")} {lane.laneId}</span><h3>{lane.competitorId ? (card?.competitorId === lane.competitorId ? card.teamName : lane.competitorId) : t("สนามว่าง", "Lane available")}</h3></div><span className={`status-badge ${lane.state === "RUNNING" ? "success" : lane.state === "ARMED" ? "warning" : ""}`}>{lane.state}</span></header>
            {lane.deviceId && <p className="competition-lane-device">{t("อุปกรณ์", "Device")}: <span className="technical">{lane.deviceId}</span></p>}
            {lane.state === "IDLE" && role === "admin" && <div className="lane-assign-controls">
              <CompetitorIdInput id={`console-lane-${lane.laneId}`} label={t("หมายเลขผู้เข้าแข่งขัน", "Competitor ID")} value={assignValues[lane.laneId] ?? ""} onChange={(digits) => setAssignValues((current) => ({ ...current, [lane.laneId]: digits }))} />
              <div className="lane-button-row"><button type="button" disabled={!candidate} onClick={() => { if (candidate) laneAction(lane.laneId, "assign", candidate); }}>{t("จัดลงสนาม", "Assign")}</button>{card && <button className="secondary" type="button" onClick={() => laneAction(lane.laneId, "assign", card.competitorId)}>{t("ใช้ทีมที่เปิดอยู่", "Use scanned team")}</button>}</div>
            </div>}
            {lane.state === "ASSIGNED" && role === "admin" && <button className="lane-primary-action" type="button" onClick={() => laneAction(lane.laneId, "arm")}>{t("เตรียมจับเวลา", "Arm lane")}</button>}
            {lane.state === "ARMED" && <div className="lane-ready-message"><strong>{t("พร้อมรับสัญญาณเริ่ม", "Ready for START trigger")}</strong><span>{t("การตรวจจับครั้งถัดไปจะเริ่มเวลา", "The next sensor detection starts the run.")}</span></div>}
            {lane.state === "RUNNING" && <div className="lane-ready-message running"><strong>{t("กำลังจับเวลา", "Timer running")}</strong><span>{t("การตรวจจับครั้งถัดไปจะหยุดเวลา", "The next sensor detection stops the run.")}</span></div>}
            {lane.state !== "IDLE" && role === "admin" && <button className="danger lane-reset" type="button" onClick={() => laneAction(lane.laneId, "reset")}>{t("รีเซ็ตสนาม", "Reset lane")}</button>}
            {role !== "admin" && <p className="inspection-locked">{t("ดูสถานะเท่านั้น ผู้ดูแลระบบเป็นผู้จัดทีมและเตรียมสนาม", "Read-only. An administrator assigns and arms lanes.")}</p>}
          </article>;
        })}
      </div>
    </section>
  </div>;
}

export default function CommitteeScanPage() {
  return <LoginGate title="Competition Staff Login">{(actions) => <CommitteeScanDashboard {...actions} />}</LoginGate>;
}
