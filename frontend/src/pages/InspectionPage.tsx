import { useState } from "react";
import { ec2Json } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";
import {
  CompetitorHeading, EMPTY_BY_STAGE, MAX_ROBOT_WEIGHT_GRAMS, STAGES, ScanConsole,
  checkInPassedFor, dateTime, latestInspection, useCompetitorLookup,
  type InspectionStage, type WeightInspection,
} from "../competitorConsole";

/**
 * Robot inspection, repeated before every round per Rule 3.7(1).
 *
 * The weight verdict is never sent from here: the server compares the
 * measurement against Rule 3.2's limit and derives the overall result, so an
 * over-weight robot cannot be recorded as a pass. Dimensions (3.1) and voltage
 * (3.3) are inspector judgements because nothing in the system can measure them.
 */
function InspectionDashboard({ signOutAndReset }: { signOutAndReset: (message?: string) => Promise<void> }) {
  const { card, lookup, inputValue, setInputValue, inputRef, error, setError, toast, setToast, busy, setBusy } =
    useCompetitorLookup();
  const [weights, setWeights] = useState<Record<InspectionStage, string>>({ ...EMPTY_BY_STAGE });
  const [notes, setNotes] = useState<Record<InspectionStage, string>>({ ...EMPTY_BY_STAGE });
  const checkInPassed = checkInPassedFor(card);

  async function submitInspection(
    stage: InspectionStage,
    dimensionResult: "PASS" | "FAIL",
    voltageResult: "PASS" | "FAIL",
  ): Promise<void> {
    if (!card) return;
    const weightGrams = Number(weights[stage]);
    if (!Number.isFinite(weightGrams) || weightGrams <= 0) {
      setError(t("กรุณากรอกน้ำหนักเป็นกรัม", "Enter a valid weight in grams."));
      return;
    }
    setBusy(true); setError(null);
    try {
      const saved = await ec2Json<{ inspection: WeightInspection }>(
        `/committee/competitors/${encodeURIComponent(card.competitorId)}/weight-inspections`,
        {
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
    } catch (err) { setError(err instanceof Error ? err.message : "Inspection failed"); }
    finally { setBusy(false); }
  }

  return <div className="page page-wide competition-console">
    {busy && <LoadingScreen overlay label="กำลังบันทึกข้อมูล / Saving…" />}
    <NavBar onSignOut={signOutAndReset} />
    <BrandHeader title="Inspection" home="/admin"
      description="ชั่งน้ำหนักและตรวจสภาพหุ่นยนต์ก่อนแต่ละรอบ / Weigh and inspect robots before each round" />

    <div role="status" aria-live="polite">{toast && <div className="notice-banner">{toast}</div>}</div>
    {error && <div className="error-banner" role="alert">{error}</div>}

    <div className="scan-layout">
      <ScanConsole value={inputValue} onChange={setInputValue} onSubmit={() => lookup(inputValue)} inputRef={inputRef} />

      {card ? <div className="card inspection-workspace">
        <CompetitorHeading card={card} />

        {card.status === "REGISTERED" ? <div className="inspection-gate">
          <div className="warning-banner">{t("ต้องเช็คอินก่อนจึงจะตรวจสภาพได้", "The team must be checked in before inspection.")}</div>
        </div> : <div className="inspection-stage-grid">
          {STAGES.map((stage, index) => {
            const latest = latestInspection(card.weightInspections, stage.key);
            const enabled = stage.key === "CHECK_IN" || checkInPassed;
            const completed = latest?.result === "PASS";
            const typedWeight = Number(weights[stage.key]);
            const overWeight = Number.isFinite(typedWeight) && typedWeight > MAX_ROBOT_WEIGHT_GRAMS;
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
              {!enabled && <p className="inspection-locked">{t("ต้องผ่านการตรวจสภาพเมื่อเช็คอินก่อน", "Pass the check-in inspection first.")}</p>}
            </section>;
          })}
        </div>}
      </div> : <div className="empty-state scan-empty">{t("สแกนผู้เข้าแข่งขันเพื่อเริ่มขั้นตอน", "Scan a competitor to begin.")}</div>}
    </div>
  </div>;
}

export default function InspectionPage() {
  return <LoginGate title="Competition Staff Login">{(actions) => <InspectionDashboard {...actions} />}</LoginGate>;
}
