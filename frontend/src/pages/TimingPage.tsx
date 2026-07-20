import { useEffect, useId, useState, type FormEvent } from "react";
import { ApiClientError, ec2Json } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";

type Role = "admin" | "committee" | "competitor";
interface Timing { category: string; minTimeMs: number; maxTimeMs: number }
interface Rule { ruleId: string; label: string; penaltyMs: number; active: boolean }
interface Run {
  runId: string; status: "RUNNING" | "COMPLETE" | "TIMED_OUT" | "UNDER_REVIEW" | "INVALID" | "VOID";
  elapsedMs: number | null; minTimeMs: number; maxTimeMs: number;
  correction?: { elapsedMs: number; reason: string } | null;
}
interface Competitor {
  competitorId: string; teamName: string; category: string; runs: Run[];
  disqualified: { bool: boolean; reason: string | null };
  penalties: Array<{ SK: string; label: string; penaltyMs: number; revocation?: unknown }>;
  aggregateTimeMs: number | null; penaltyTimeMs: number; finalTimeMs: number | null;
}

const seconds = (ms: number | null | undefined) => ms == null ? "—" : `${(ms / 1000).toFixed(3)} s`;

function TimingDashboard({ signOutAndReset }: { signOutAndReset: () => Promise<void> }) {
  const [role, setRole] = useState<Role>("competitor");
  const [timings, setTimings] = useState<Timing[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [competitorId, setCompetitorId] = useState("");
  const [competitor, setCompetitor] = useState<Competitor | null>(null);
  const [category, setCategory] = useState("Line Tracing - Open");
  const [minSeconds, setMinSeconds] = useState("");
  const [maxSeconds, setMaxSeconds] = useState("");
  const [ruleLabel, setRuleLabel] = useState("");
  const [penaltySeconds, setPenaltySeconds] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disqualificationReason, setDisqualificationReason] = useState("");
  const [reinstatementReason, setReinstatementReason] = useState("");
  const [busy, setBusy] = useState(false);
  const categoryId = useId();
  const minId = useId();
  const maxId = useId();
  const ruleLabelId = useId();
  const penaltyId = useId();
  const lookupId = useId();
  const disqualificationReasonId = useId();
  const reinstatementReasonId = useId();

  async function loadConfig(currentRole = role): Promise<void> {
    const penalties = await ec2Json<{ rules: Rule[] }>("/admin/config/penalties");
    setRules(penalties.rules);
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
        body: JSON.stringify({ category, minTimeMs: Math.round(Number(minSeconds) * 1000), maxTimeMs: Math.round(Number(maxSeconds) * 1000) }),
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

  return <div className="page page-wide">
    {busy && <LoadingScreen overlay label="กำลังดำเนินการ / Working…" />}
    <NavBar onSignOut={signOutAndReset} />
    <BrandHeader title="Timing and penalties" home="/admin" description="ตั้งค่าขอบเขตเวลา ตรวจผล และจัดการบทลงโทษ / Configure limits, review runs, and manage penalties" />
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <div className="notice-banner" role="status" aria-live="polite">{notice}</div>}

    {role === "admin" && <div className="card-grid admin-config-grid">
      <div className="card"><span className="section-kicker">TIME LIMITS</span><h2>{t("ขอบเขตเวลา", "Category timing")}</h2>
        {timings.map((item) => <div className="metric" key={item.category}><span className="metric-label">{item.category}</span><span className="metric-value">{seconds(item.minTimeMs)}–{seconds(item.maxTimeMs)}</span></div>)}
        <form onSubmit={saveTiming}>
          <div className="field"><label htmlFor={categoryId}>{t("ประเภท", "Category")}</label><input id={categoryId} required value={category} onChange={(e) => setCategory(e.target.value)} /></div>
          <div className="field"><label htmlFor={minId}>{t("เวลาต่ำสุด (วินาที)", "Minimum seconds")}</label><input id={minId} required type="number" min="0.001" step="0.001" value={minSeconds} onChange={(e) => setMinSeconds(e.target.value)} /></div>
          <div className="field"><label htmlFor={maxId}>{t("เวลาสูงสุด (วินาที)", "Maximum seconds")}</label><input id={maxId} required type="number" min="0.001" step="0.001" value={maxSeconds} onChange={(e) => setMaxSeconds(e.target.value)} /></div>
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
      <div className="card"><span className="section-kicker">COMPETITION STATE</span><h2>{t("สถานะการแข่งขัน", "State")}</h2><p>{t("การสรุปผลจะหยุดการจัดอันดับและสร้างผลอย่างเป็นทางการ", "Concluding freezes the ranking and produces the official results.")}</p><div className="button-row"><button className="danger" type="button" onClick={conclude}>{t("สรุปผล", "Conclude")}</button><button className="secondary" type="button" onClick={reopen}>{t("เปิดใหม่", "Reopen")}</button></div></div>
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
      <h3>{t("บทลงโทษที่ใช้งาน", "Active penalties")}</h3>{competitor.penalties.filter((item) => !item.revocation).map((item) => <div className="rule-row" key={item.SK}><span>{item.label} <span className="technical">+{seconds(item.penaltyMs)}</span></span>{role === "admin" && <button type="button" className="danger" onClick={() => revoke(item.SK)}>{t("เพิกถอน", "Revoke")}</button>}</div>)}
      <h3>{t("การวิ่ง", "Attempts")}</h3>{competitor.runs.map((run) => <div key={run.runId} className="attempt-row"><p><span className="status-badge">{run.status}</span> <span className="technical">{run.runId}</span> · raw {seconds(run.elapsedMs)} {run.correction && `· corrected ${seconds(run.correction.elapsedMs)}`}</p><div className="button-row">
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
