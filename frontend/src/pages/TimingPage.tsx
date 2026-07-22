import { useEffect, useId, useState, type FormEvent } from "react";
import { ApiClientError, ec2Json } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";

type Role = "admin" | "committee" | "competitor";
type Stage = "ROUND_1" | "BEST_OF_4" | "BEST_OF_2" | "THE_BEST";
interface Timing { category: string; minTimeMs: number; maxTimeMs: number; stageMaxTimeMs?: Record<Stage, number>; stageMaxAttempts?: Record<Stage, number> }
interface CompetitionState { phase: "OPEN" | "CONCLUDED"; activeStage: Stage; eligibleCompetitorIds: string[] }
interface Rule { ruleId: string; label: string; penaltyMs: number; active: boolean }
interface Run {
  runId: string; status: "RUNNING" | "COMPLETE" | "TIMED_OUT" | "UNDER_REVIEW" | "INVALID" | "VOID";
  elapsedMs: number | null; minTimeMs: number; maxTimeMs: number;
  correction?: { elapsedMs: number; reason: string } | null;
  stage?: Stage;
}
interface Competitor {
  competitorId: string; teamName: string; category: string; activeStage: Stage; runs: Run[];
  disqualified: { bool: boolean; reason: string | null };
  penalties: Array<{ SK: string; label: string; penaltyMs: number; stage?: Stage; revocation?: unknown }>;
  aggregateTimeMs: number | null; penaltyTimeMs: number; finalTimeMs: number | null;
}

const seconds =(ms: number | null | undefined) => ms == null ? "—" : `${(ms / 1000).toFixed(3)} s`;
const stageLabel: Record<Stage, string> = { ROUND_1: "Round 1", BEST_OF_4: "Best of 4", BEST_OF_2: "Best of 2", THE_BEST: "The Best" };
/** Semantic status-badge class per run outcome (see status-badge in CSS). */
const RUN_BADGE: Record<Run["status"], string> = {
  RUNNING: "", COMPLETE: "success", TIMED_OUT: "warning", UNDER_REVIEW: "warning", INVALID: "error", VOID: "",
};

function TimingDashboard({ signOutAndReset }: { signOutAndReset: () => Promise<void> }) {
  const [role, setRole] = useState<Role>("competitor");
  const [timings, setTimings] = useState<Timing[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [competitorId, setCompetitorId] = useState("");
  const [competitor, setCompetitor] = useState<Competitor | null>(null);
  const [category, setCategory] = useState("Line Tracing - Open");
  const [minSeconds, setMinSeconds] = useState("");
  const [stageMaxSeconds, setStageMaxSeconds] = useState<Record<Stage, string>>({ ROUND_1: "180", BEST_OF_4: "180", BEST_OF_2: "180", THE_BEST: "180" });
  const [stageMaxAttempts, setStageMaxAttempts] = useState<Record<Stage, string>>({ ROUND_1: "2", BEST_OF_4: "2", BEST_OF_2: "2", THE_BEST: "2" });
  const [competitionState, setCompetitionState] = useState<CompetitionState | null>(null);
  const [ruleLabel, setRuleLabel] = useState("");
  const [penaltySeconds, setPenaltySeconds] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disqualificationReason, setDisqualificationReason] = useState("");
  const [reinstatementReason, setReinstatementReason] = useState("");
  const [busy, setBusy] = useState(false);
  const categoryId = useId();
  const minId = useId();
  const round1MaxId = useId();
  const best4MaxId = useId();
  const best2MaxId = useId();
  const finalMaxId = useId();
  const ruleLabelId = useId();
  const penaltyId = useId();
  const lookupId = useId();
  const disqualificationReasonId = useId();
  const reinstatementReasonId = useId();

  async function loadConfig(currentRole = role): Promise<void> {
    const [penalties, state] = await Promise.all([
      ec2Json<{ rules: Rule[] }>("/admin/config/penalties"),
      ec2Json<CompetitionState>("/admin/competition/state"),
    ]);
    setRules(penalties.rules); setCompetitionState(state);
    if (currentRole === "admin") {
      const categoryResult = await ec2Json<{ categories: Timing[] }>("/admin/config/categories");
      setTimings(categoryResult.categories);
    }
  }

  useEffect(() => {
    ec2Json<{ role: Role }>("/auth/me")
      .then(async (me) => { setRole(me.role); await loadConfig(me.role); })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load staff access"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookup(id = competitorId): Promise<void> {
    setError(null); setBusy(true);
    try { setCompetitor(await ec2Json<Competitor>(`/competitors/${encodeURIComponent(id.trim())}`)); }
    catch (err) { setCompetitor(null); setError(err instanceof Error ? err.message : "Lookup failed"); }
    finally { setBusy(false); }
  }

  async function saveTiming(event: FormEvent): Promise<void> {
    event.preventDefault(); setError(null); setBusy(true);
    try {
      await ec2Json("/admin/config/categories", {
        method: "PUT",
        body: JSON.stringify({
          category, minTimeMs: Math.round(Number(minSeconds) * 1000),
          stageMaxTimeMs: Object.fromEntries(Object.entries(stageMaxSeconds).map(([stage, value]) => [stage, Math.round(Number(value) * 1000)])),
          stageMaxAttempts: Object.fromEntries(Object.entries(stageMaxAttempts).map(([stage, value]) => [stage, Number(value)])),
        }),
      });
      await loadConfig("admin"); setNotice("Timing limits saved for future attempts.");
    } catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
    finally { setBusy(false); }
  }

  async function createRule(event: FormEvent): Promise<void> {
    event.preventDefault(); setError(null); setBusy(true);
    try {
      await ec2Json("/admin/config/penalties", {
        method: "POST", body: JSON.stringify({ label: ruleLabel, penaltyMs: Math.round(Number(penaltySeconds) * 1000) }),
      });
      setRuleLabel(""); setPenaltySeconds(""); await loadConfig("admin");
    } catch (err) { setError(err instanceof Error ? err.message : "Rule creation failed"); }
    finally { setBusy(false); }
  }

  async function toggleRule(rule: Rule): Promise<void> {
    setBusy(true);
    try {
      await ec2Json(`/admin/config/penalties/${encodeURIComponent(rule.ruleId)}`, {
        method: "PUT", body: JSON.stringify({ label: rule.label, penaltyMs: rule.penaltyMs, active: !rule.active }),
      });
      await loadConfig("admin");
    } catch (err) { setError(err instanceof Error ? err.message : "Rule update failed"); }
    finally { setBusy(false); }
  }

  async function conclude(): Promise<void> {
    if (window.prompt("Type CONCLUDE to freeze results") !== "CONCLUDE") return;
    setBusy(true);
    try { await ec2Json("/admin/competition/conclude", { method: "POST", body: JSON.stringify({ confirm: "CONCLUDE" }) }); setNotice("Competition concluded and results frozen."); }
    catch (err) { setError(err instanceof Error ? err.message : "Conclusion failed"); }
    finally { setBusy(false); }
  }

  async function advance(): Promise<void> {
    if (!competitionState || window.prompt(`Type ADVANCE to finish ${stageLabel[competitionState.activeStage]}`) !== "ADVANCE") return;
    setBusy(true); setError(null);
    try {
      const state = await ec2Json<CompetitionState>("/admin/competition/advance", { method: "POST", body: JSON.stringify({ confirm: "ADVANCE" }) });
      setCompetitionState(state); setNotice(`Advanced to ${stageLabel[state.activeStage]}. Stage results were frozen independently.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Stage advancement failed"); }
    finally { setBusy(false); }
  }

  async function reopen(): Promise<void> {
    if (!window.confirm("Reopen the competition and delete the frozen ranking snapshot?")) return;
    setBusy(true);
    try { await ec2Json("/admin/competition/reopen", { method: "POST" }); setNotice("Competition reopened."); }
    catch (err) { setError(err instanceof Error ? err.message : "Reopen failed"); }
    finally { setBusy(false); }
  }

  async function applyRule(ruleId: string): Promise<void> {
    if (!competitor) return;
    setBusy(true);
    try {
      await ec2Json(`/committee/competitors/${encodeURIComponent(competitor.competitorId)}/penalties`, {
        method: "POST", body: JSON.stringify({ ruleId }),
      });
      await lookup(competitor.competitorId); setNotice("Penalty applied.");
    } catch (err) { setError(err instanceof Error ? err.message : "Penalty failed"); }
    finally { setBusy(false); }
  }

  async function resolve(run: Run, decision: "consume" | "void"): Promise<void> {
    if (!competitor) return;
    const reason = window.prompt(`Reason to ${decision} this attempt?`)?.trim();
    if (!reason) return;
    setBusy(true);
    try {
      await ec2Json(`/admin/competitors/${encodeURIComponent(competitor.competitorId)}/runs/${encodeURIComponent(run.runId)}/resolve`, {
        method: "POST", body: JSON.stringify({ decision, reason }),
      });
      await lookup(competitor.competitorId);
    } catch (err) { setError(err instanceof Error ? err.message : "Resolution failed"); }
    finally { setBusy(false); }
  }

  async function correct(run: Run): Promise<void> {
    if (!competitor) return;
    const value = window.prompt("Corrected time in seconds?")?.trim();
    if (!value) return;
    const reason = window.prompt("Correction reason?")?.trim();
    if (!reason) return;
    setBusy(true);
    try {
      await ec2Json(`/admin/competitors/${encodeURIComponent(competitor.competitorId)}/runs/${encodeURIComponent(run.runId)}/correct`, {
        method: "POST", body: JSON.stringify({ elapsedMs: Math.round(Number(value) * 1000), reason }),
      });
      await lookup(competitor.competitorId);
    } catch (err) { setError(err instanceof Error ? err.message : "Correction failed"); }
    finally { setBusy(false); }
  }

  async function revoke(sk: string): Promise<void> {
    if (!competitor) return;
    const reason = window.prompt("Revocation reason?")?.trim();
    if (!reason) return;
    setBusy(true);
    try {
      await ec2Json(`/admin/competitors/${encodeURIComponent(competitor.competitorId)}/penalties/${encodeURIComponent(sk)}/revoke`, {
        method: "POST", body: JSON.stringify({ reason }),
      });
      await lookup(competitor.competitorId);
    } catch (err) { setError(err instanceof ApiClientError ? err.message : "Revocation failed"); }
    finally { setBusy(false); }
  }

  async function setDisqualification(action: "disqualify" | "reinstate"): Promise<void> {
    if (!competitor) return;
    const reason = (action === "disqualify" ? disqualificationReason : reinstatementReason).trim();
    if (!reason) {
      setError(action === "disqualify"
        ? t("กรุณาระบุเหตุผลการตัดสิทธิ์", "Disqualification reason is required.")
        : t("กรุณาระบุเหตุผลการคืนสิทธิ์", "Reinstatement reason is required."));
      return;
    }
    const path = action === "disqualify"
      ? `/committee/competitors/${encodeURIComponent(competitor.competitorId)}/disqualify`
      : `/admin/competitors/${encodeURIComponent(competitor.competitorId)}/reinstate`;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await ec2Json(path, { method: "POST", body: JSON.stringify({ reason }) });
      if (action === "disqualify") setDisqualificationReason("");
      else setReinstatementReason("");
      await lookup(competitor.competitorId);
      setNotice(action === "disqualify"
        ? t("ตัดสิทธิ์ผู้เข้าแข่งขันแล้ว", "Competitor disqualified.")
        : t("คืนสิทธิ์ผู้เข้าแข่งขันแล้ว", "Competitor reinstated."));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Status update failed");
    } finally {
      setBusy(false);
    }
  }

  return <div className="page page-mid">
    {busy && <LoadingScreen overlay label="กำลังดำเนินการ / Working…" />}
    <NavBar onSignOut={signOutAndReset} />
    <BrandHeader title="Timing and penalties" home="/admin" description="ตั้งค่าขอบเขตเวลา ตรวจผล และจัดการบทลงโทษ / Configure limits, review runs, and manage penalties" />
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <div className="notice-banner" role="status" aria-live="polite">{notice}</div>}

    {role === "admin" && <div className="admin-config-grid">
      <div className="card"><span className="section-kicker">TIME LIMITS</span><h2>{t("ขอบเขตเวลา", "Category timing")}</h2>
        {timings.map((item) => <div key={item.category}><strong>{item.category}</strong><div className="metric-grid">{(["ROUND_1", "BEST_OF_4", "BEST_OF_2", "THE_BEST"] as Stage[]).map((stage) => <div className="metric" key={stage}><span className="metric-label">{stageLabel[stage]}</span><span className="metric-value">{seconds(item.stageMaxTimeMs?.[stage] ?? item.maxTimeMs)} · {item.stageMaxAttempts?.[stage] ?? 2} {t("ครั้ง", "tries")}</span></div>)}</div></div>)}
        <form onSubmit={saveTiming}>
          <div className="field"><label htmlFor={categoryId}>{t("ประเภท", "Category")}</label><input id={categoryId} required value={category} onChange={(e) => setCategory(e.target.value)} /></div>
          <div className="field"><label htmlFor={minId}>{t("เวลาต่ำสุด (วินาที)", "Minimum seconds")}</label><input id={minId} required type="number" min="0.001" step="0.001" value={minSeconds} onChange={(e) => setMinSeconds(e.target.value)} /></div>
          {([
            ["ROUND_1", round1MaxId], ["BEST_OF_4", best4MaxId], ["BEST_OF_2", best2MaxId], ["THE_BEST", finalMaxId],
          ] as Array<[Stage, string]>).map(([stage, id]) => <div className="field-grid" key={stage}>
            <div className="field"><label htmlFor={id}>{stageLabel[stage]} — {t("เวลาสูงสุด (วินาที)", "maximum seconds")}</label><input id={id} required type="number" min="0.001" step="0.001" value={stageMaxSeconds[stage]} onChange={(event) => setStageMaxSeconds((current) => ({ ...current, [stage]: event.target.value }))} /></div>
            <div className="field"><label htmlFor={`${id}-attempts`}>{stageLabel[stage]} — {t("จำนวนครั้งสูงสุด", "maximum tries")}</label><input id={`${id}-attempts`} required type="number" min="1" max="20" step="1" value={stageMaxAttempts[stage]} onChange={(event) => setStageMaxAttempts((current) => ({ ...current, [stage]: event.target.value }))} /></div>
          </div>)}
          <button type="submit">{t("บันทึก", "Save limits")}</button>
        </form>
      </div>
      <div className="card"><span className="section-kicker">PENALTY RULES</span><h2>{t("สร้างบทลงโทษ", "Create rule")}</h2><form onSubmit={createRule}>
        <div className="field"><label htmlFor={ruleLabelId}>{t("ชื่อบทลงโทษ", "Label")}</label><input id={ruleLabelId} required value={ruleLabel} onChange={(e) => setRuleLabel(e.target.value)} /></div>
        <div className="field"><label htmlFor={penaltyId}>{t("เวลาปรับ (วินาที)", "Penalty seconds")}</label><input id={penaltyId} required type="number" min="0.001" step="0.001" value={penaltySeconds} onChange={(e) => setPenaltySeconds(e.target.value)} /></div>
        <button type="submit">{t("สร้างกฎ", "Create rule")}</button>
      </form>
      <div className="rule-list">{rules.map((rule) => <div className="rule-row" key={rule.ruleId}><span><span className={`status-badge ${rule.active ? "success" : ""}`}>{rule.active ? "ACTIVE" : "INACTIVE"}</span> {rule.label} <span className="technical">+{seconds(rule.penaltyMs)}</span></span><button className="secondary" type="button" onClick={() => toggleRule(rule)}>{rule.active ? t("ปิด", "Deactivate") : t("เปิด", "Activate")}</button></div>)}</div>
      </div>
      <div className="card"><span className="section-kicker">COMPETITION STATE</span>
        <div className="stage-hero">
          <h2>{competitionState ? stageLabel[competitionState.activeStage] : t("สถานะการแข่งขัน", "State")}</h2>
          {competitionState && <span className={`status-badge ${competitionState.phase === "OPEN" ? "success" : "error"}`}>{competitionState.phase}</span>}
        </div>
        <p>{competitionState?.activeStage === "ROUND_1" ? t("ทุกทีมที่ลงทะเบียนมีสิทธิ์แข่งขัน", "All registered teams are eligible.") : `${competitionState?.eligibleCompetitorIds.length ?? 0} advancing teams eligible`}</p>
        <p>{t("ผลของแต่ละรอบแยกจากกัน การเลื่อนรอบจะบันทึกผลรอบปัจจุบัน", "Each stage is independent. Advancing freezes the current stage result.")}</p>
        <div className="button-row">{competitionState?.activeStage !== "THE_BEST" && competitionState?.phase === "OPEN" && <button type="button" onClick={advance}>{t("เลื่อนไปรอบถัดไป", "Advance stage")}</button>}{competitionState?.activeStage === "THE_BEST" && competitionState.phase === "OPEN" && <button className="danger" type="button" onClick={conclude}>{t("สรุปผล", "Conclude")}</button>}<button className="secondary" type="button" onClick={reopen}>{t("เปิดใหม่", "Reopen")}</button></div>
      </div>
    </div>}

    <div className="card lookup-card"><span className="section-kicker">OPERATIONS</span><h2>{t("ค้นหาผู้เข้าแข่งขัน", "Competitor lookup")}</h2>
      <div className="lookup-row"><div className="field"><label htmlFor={lookupId}>{t("หมายเลขผู้เข้าแข่งขัน", "Competitor number")}</label><input id={lookupId} className="technical" value={competitorId} onChange={(e) => setCompetitorId(e.target.value)} placeholder="C-0042" /></div>
      <button type="button" onClick={() => lookup()}>{t("ค้นหา", "Lookup")}</button></div>
    </div>
    {competitor && <div className="card competitor-result"><span className="section-kicker technical">{competitor.competitorId}</span><h2>{competitor.teamName}</h2>
      {competitor.disqualified.bool
        ? <div className="error-banner" role="alert"><strong>{t("ตัดสิทธิ์", "DISQUALIFIED")}</strong>{competitor.disqualified.reason && `: ${competitor.disqualified.reason}`}</div>
        : null}
      {competitor.disqualified.bool && role === "admin" ? (
        <div className="field">
          <label htmlFor={reinstatementReasonId}>{t("เหตุผลการคืนสิทธิ์", "Reinstatement reason")}</label>
          <input id={reinstatementReasonId} value={reinstatementReason} onChange={(event) => setReinstatementReason(event.target.value)} />
          <button type="button" className="secondary" disabled={busy || !reinstatementReason.trim()} onClick={() => setDisqualification("reinstate")}>{t("คืนสิทธิ์", "Reinstate")}</button>
        </div>
      ) : !competitor.disqualified.bool ? (
        <div className="field">
          <label htmlFor={disqualificationReasonId}>{t("เหตุผลการตัดสิทธิ์", "Disqualification reason")}</label>
          <input id={disqualificationReasonId} value={disqualificationReason} onChange={(event) => setDisqualificationReason(event.target.value)} />
          <button type="button" className="danger" disabled={busy || !disqualificationReason.trim()} onClick={() => setDisqualification("disqualify")}>{t("ตัดสิทธิ์", "Disqualify")}</button>
        </div>
      ) : null}
      <div className="metric-grid"><div className="metric"><span className="metric-label">{t("เฉลี่ย", "Average")}</span><span className="metric-value">{seconds(competitor.aggregateTimeMs)}</span></div><div className="metric"><span className="metric-label">{t("เวลาปรับ", "Penalties")}</span><span className="metric-value">+{seconds(competitor.penaltyTimeMs)}</span></div><div className="metric"><span className="metric-label">{t("สุทธิ", "Final")}</span><span className="metric-value">{seconds(competitor.finalTimeMs)}</span></div></div>
      <h3>{t("เพิ่มบทลงโทษ", "Apply penalty")}</h3><div className="button-row">{rules.filter((rule) => rule.active).map((rule) => <button type="button" key={rule.ruleId} className="secondary" onClick={() => applyRule(rule.ruleId)}>{rule.label} (+{seconds(rule.penaltyMs)})</button>)}</div>
      <h3>{t("บทลงโทษที่ใช้งาน", "Active-stage penalties")}</h3>{competitor.penalties.filter((item) => !item.revocation && (item.stage ?? "ROUND_1") === competitor.activeStage).map((item) => <div className="rule-row" key={item.SK}><span>{item.label} <span className="technical">+{seconds(item.penaltyMs)}</span></span>{role === "admin" && <button type="button" className="danger" onClick={() => revoke(item.SK)}>{t("เพิกถอน", "Revoke")}</button>}</div>)}
      <h3>{t("การวิ่ง", "Attempts")}</h3>{competitor.runs.map((run) => <div key={run.runId} className="attempt-row">
        <div className="attempt-head"><span className={`status-badge ${RUN_BADGE[run.status]}`}>{run.status}</span><span className="technical attempt-id">{run.stage ? stageLabel[run.stage] : stageLabel.ROUND_1} · {run.runId}</span></div>
        <div className="attempt-times"><span>{t("ดิบ", "raw")} {seconds(run.elapsedMs)}</span>{run.correction && <span className="corrected">{t("แก้เป็น", "corrected")} {seconds(run.correction.elapsedMs)}</span>}</div>
        <div className="button-row">
        {role === "admin" && run.status === "UNDER_REVIEW" && !run.correction && <><button type="button" onClick={() => resolve(run, "consume")}>{t("ใช้ผล", "Consume invalid")}</button><button type="button" className="secondary" onClick={() => resolve(run, "void")}>{t("ยกเลิก", "Void")}</button></>}
        {role === "admin" && (run.status === "UNDER_REVIEW" || run.status === "TIMED_OUT") && !run.correction && <button type="button" className="secondary" onClick={() => correct(run)}>{t("แก้เวลา", "Correct time")}</button>}
        </div>
      </div>)}
    </div>}
  </div>;
}

export default function TimingPage() {
  return <LoginGate title="Staff Login">{(actions) => <TimingDashboard {...actions} />}</LoginGate>;
}
