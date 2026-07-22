import { useEffect, useState } from "react";
import { ApiClientError, controlJson } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";

type EventMode = "registration" | "competition" | "concluded";
interface DeploymentStatus { appId: string; branchName: string; activeJobId: string; commitId: string | null; jobStatus: string | null; mode: EventMode | null; requestedMode?: EventMode; jobId?: string | null; }

function DeploymentDashboard({ signOutAndReset }: { signOutAndReset: () => Promise<void> }) {
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [mode, setMode] = useState<EventMode>("competition");
  const [resultsCommitted, setResultsCommitted] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const next = await controlJson<DeploymentStatus>("/deployment/status");
      setStatus(next);
      if (next.mode === "registration" || next.mode === "competition" || next.mode === "concluded") setMode(next.mode === "registration" ? "competition" : next.mode);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load deployment status"); }
  }
  useEffect(() => { void refresh(); }, []);
  const expected = `DEPLOY_${mode.toUpperCase()}`;
  async function deploy() {
    if (!status?.commitId) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await controlJson<DeploymentStatus>("/deployment/mode", { method: "POST", body: JSON.stringify({ mode, expectedCommit: status.commitId, confirmation, resultsCommitted }) });
      setStatus(result); setNotice(`Amplify job ${result.jobId ?? "started"} requested for ${mode} mode.`); setConfirmation("");
    } catch (err) { setError(err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : "Deployment request failed"); }
    finally { setBusy(false); }
  }
  return <div className="page page-wide">
    {busy && <LoadingScreen overlay label="Starting Amplify deployment…" />}
    <NavBar onSignOut={signOutAndReset} />
    <BrandHeader title="Event deployment" home="/admin" description="Admin-only mode transition; every change rebuilds the Amplify site." />
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <div className="notice-banner" role="status">{notice}</div>}
    <div className="card">
      <span className="section-kicker">CURRENT DEPLOYMENT</span>
      <p><strong>Mode:</strong> {status?.mode ?? "loading"}</p><p><strong>Commit:</strong> <span className="technical">{status?.commitId ?? "—"}</span></p><p><strong>Job:</strong> {status?.activeJobId ?? "—"} · {status?.jobStatus ?? "—"}</p>
      <button type="button" className="secondary" onClick={() => void refresh()} disabled={busy}>Refresh status</button>
    </div>
    <div className="card">
      <span className="section-kicker">DEPLOY NEW MODE</span>
      <div className="field"><label htmlFor="deployment-mode">Target mode</label><select id="deployment-mode" value={mode} onChange={(event) => setMode(event.target.value as EventMode)} disabled={busy}><option value="registration">Registration</option><option value="competition">Competition</option><option value="concluded">Concluded</option></select></div>
      {mode === "concluded" && <label className="consent-check"><input type="checkbox" checked={resultsCommitted} onChange={(event) => setResultsCommitted(event.target.checked)} /> I verified `results.json` is committed for this exact branch.</label>}
      <div className="field"><label htmlFor="deployment-confirmation">Type {expected} to confirm</label><input id="deployment-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></div>
      <button type="button" disabled={busy || !status?.commitId || confirmation !== expected || (mode === "concluded" && !resultsCommitted)} onClick={() => void deploy()}>Deploy {mode}</button>
      <p><small>Changing this setting starts a new Amplify build. It does not alter competition data.</small></p>
    </div>
  </div>;
}

export default function DeploymentPage() { return <LoginGate title="Admin deployment login">{(actions) => <DeploymentDashboard {...actions} />}</LoginGate>; }
