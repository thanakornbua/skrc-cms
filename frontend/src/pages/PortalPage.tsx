import { useEffect, useId, useState, type FormEvent } from "react";
import {
  confirmResetPassword,
  resetPassword,
} from "aws-amplify/auth";
import { ec2Json, regweekJson } from "../api";
import { useParams } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";

const EVENT_MODE = import.meta.env.VITE_EVENT_MODE;

interface Registration {
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  name: string;
  teamName: string;
  category: string;
  rejection: { reason: string; at: string } | null;
  approval: { byUser: string; at: string; competitorId: string } | null;
  createdAt: string;
}

interface Competitor {
  competitorId: string;
  name: string;
  teamName: string;
  category: string;
  status: "REGISTERED" | "CHECKED_IN" | "INSPECTED" | "RUN_COMPLETE";
  checkedInAt: string | null;
  inspectedAt: string | null;
  disqualified: { bool: boolean; reason: string | null; byUser: string | null; at: string | null };
  lane?: { laneId: string; state: "ASSIGNED" | "ARMED" | "RUNNING" } | null;
  penalties?: Array<{ SK: string; label: string; penaltyMs: number; at: string; revocation?: unknown }>;
  aggregateTimeMs?: number | null;
  penaltyTimeMs?: number;
  finalTimeMs?: number | null;
  rank?: number | null;
  runs?: Array<{
    runId: string;
    status?: "COMPLETE" | "TIMED_OUT" | "UNDER_REVIEW" | "INVALID" | "VOID";
    elapsedMs: number | null;
  }>;
}

interface MeResponse {
  registration: Registration;
  competitor: Competitor | null;
}

function PortalDashboard({ signOutAndReset }: { signOutAndReset: () => Promise<void> }) {
  const { competitorId: requestedCompetitorId } = useParams<{ competitorId: string }>();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function pollCompetitionMode(): Promise<MeResponse> {
      const authMe = await ec2Json<{ competitorId: string | null }>("/auth/me");
      const competitorId = requestedCompetitorId ?? authMe.competitorId;
      if (!competitorId) {
        throw new Error("No competitor ID on this account — please contact the committee.");
      }
      const competitor = await ec2Json<Competitor>(
        `/competitors/${encodeURIComponent(competitorId)}`
      );
      return {
        registration: {
          status: "APPROVED",
          name: competitor.name,
          teamName: competitor.teamName,
          category: competitor.category,
          rejection: null,
          approval: null,
          createdAt: "",
        },
        competitor,
      };
    }

    async function poll() {
      try {
        const result =
          EVENT_MODE === "competition"
            ? await pollCompetitionMode()
            : await regweekJson<MeResponse>("/me");
        if (!cancelled) {
          setMe(result);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load status");
        }
      }
    }

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [requestedCompetitorId]);

  const reg = me?.registration;
  const competitor = me?.competitor;

  // Steps 5–6 are reconstructed from *current* lane state; they can revert
  // after an admin reset. Phase 7 must switch `laneAssigned`/`timerArmed`
  // to derive from run records (any run ⇒ was assigned & armed) — see FIX_PLAN.md F6.
  const runComplete = competitor?.status === "RUN_COMPLETE";
  const hasRuns = (competitor?.runs?.length ?? 0) > 0;
  const completedRuns = competitor?.runs?.filter((run) => run.status === "COMPLETE") ?? [];
  const latestElapsedMs = completedRuns.at(-1)?.elapsedMs ?? null;
  const lane = competitor?.lane ?? null;
  const laneAssigned = Boolean(lane) || runComplete || hasRuns;
  const timerArmed = lane?.state === "ARMED" || lane?.state === "RUNNING" || runComplete || hasRuns;

  const steps = [
    { label: "Submitted", done: Boolean(reg) },
    { label: "Registration approved", done: reg?.status === "APPROVED" },
    { label: "Checked in", done: Boolean(competitor?.checkedInAt) },
    { label: "Inspected", done: Boolean(competitor?.inspectedAt) },
    { label: lane ? `Lane assigned (lane ${lane.laneId})` : "Lane assigned", done: laneAssigned },
    { label: "Timer armed", done: timerArmed },
    {
      label: latestElapsedMs === null ? "Run complete" : `Run complete (${(latestElapsedMs / 1000).toFixed(3)} s)`,
      done: runComplete,
    },
    { label: "Concluded", done: false },
  ];

  return (
    <div className="page portal-page">
      <NavBar onSignOut={signOutAndReset} />
      <BrandHeader title="Competitor Portal" description="ติดตามสถานะ สนาม และผลเวลา / Track status, lane, and timing results" />

      {loadError && <div className="error-banner" role="alert">{loadError}</div>}

      {reg?.status === "REJECTED" && (
        <div className="error-banner">
          <strong>Registration rejected:</strong> {reg.rejection?.reason}
        </div>
      )}

      {competitor?.disqualified.bool && (
        <div className="error-banner">
          <strong>DISQUALIFIED</strong>
          {competitor.disqualified.reason && <>: {competitor.disqualified.reason}</>}
        </div>
      )}

      {competitor?.competitorId && (
        <div className="card">
          <span className="section-kicker">COMPETITOR NUMBER</span>
          <strong className="competitor-number">{competitor.competitorId}</strong>
          <p>{competitor.teamName} · {competitor.category}</p>
        </div>
      )}

      <div className="card">
        <h2>{t("สถานะการแข่งขัน", "Status")}</h2>
        <ul className="timeline">
          {steps.map((s) => (
            <li key={s.label} className={s.done ? "done" : ""}>
              {s.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>{t("ผลเวลา", "Time result")}</h2>
        <div className="metric-grid">
          <div className="metric"><span className="metric-label">{t("ค่าเฉลี่ย 2 รอบ", "Best-two average")}</span><span className="metric-value">{competitor?.aggregateTimeMs == null ? "—" : `${(competitor.aggregateTimeMs / 1000).toFixed(3)} s`}</span></div>
          <div className="metric"><span className="metric-label">{t("เวลาปรับ", "Penalties")}</span><span className="metric-value">+{((competitor?.penaltyTimeMs ?? 0) / 1000).toFixed(3)} s</span></div>
          <div className="metric"><span className="metric-label">{t("เวลาสุทธิ", "Final time")}</span><span className="metric-value">{competitor?.finalTimeMs == null ? "—" : `${(competitor.finalTimeMs / 1000).toFixed(3)} s`}</span></div>
          {competitor?.rank != null && <div className="metric"><span className="metric-label">{t("อันดับ", "Rank")}</span><span className="metric-value">#{competitor.rank}</span></div>}
        </div>
        <h3>{t("บทลงโทษ", "Penalties")}</h3>
        {competitor?.penalties && competitor.penalties.filter((penalty) => !penalty.revocation).length > 0 ? (
          <ul>
            {competitor.penalties.filter((penalty) => !penalty.revocation).map((penalty) => (
              <li key={penalty.SK}>
                {penalty.label} (+{(penalty.penaltyMs / 1000).toFixed(3)} s) — {penalty.at}
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("ไม่มี", "None")}</p>
        )}
        <h3>{t("เวลารายรอบ", "Attempt times")}</h3>
        {competitor?.runs && competitor.runs.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("รอบ", "Attempt")}</th><th>{t("สถานะ", "Status")}</th><th>{t("เวลา", "Time")}</th></tr></thead>
              <tbody>
                {competitor.runs.map((run, index) => (
                  <tr key={run.runId}>
                    <td>{index + 1}</td>
                    <td><span className="status-badge">{run.status ?? "RUNNING"}</span></td>
                    <td className="technical">{run.elapsedMs == null ? "—" : `${(run.elapsedMs / 1000).toFixed(3)} s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{t("ยังไม่มีเวลาการแข่งขัน", "No attempt times yet")}</p>
        )}
      </div>
    </div>
  );
}

export default function PortalPage() {
  const [resetStep, setResetStep] = useState<"login" | "request" | "confirm">("login");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailId = useId();
  const codeId = useId();
  const newPasswordId = useId();

  async function requestReset(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword({ username: email });
      setResetStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start password reset");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmReset(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
      setNotice("Password reset — please sign in with your new password.");
      setResetStep("login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setSubmitting(false);
    }
  }

  if (resetStep === "request") {
    return <div className="page auth-page"><NavBar /><BrandHeader title="Reset password" />
      {submitting && <LoadingScreen overlay label="กำลังส่งรหัส / Sending reset code…" />}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form className="card" onSubmit={requestReset}><div className="field"><label htmlFor={emailId}>{t("อีเมล", "Email")}</label><input id={emailId} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div><div className="button-row"><button type="submit" disabled={submitting}>{t("ส่งรหัส", "Send reset code")}</button><button className="secondary" type="button" onClick={() => setResetStep("confirm")}>{t("มีรหัสแล้ว", "I already have a code")}</button><button className="secondary" type="button" onClick={() => setResetStep("login")}>{t("กลับ", "Back")}</button></div></form>
    </div>;
  }

  if (resetStep === "confirm") {
    return <div className="page auth-page"><NavBar /><BrandHeader title="Enter reset code" />
      {submitting && <LoadingScreen overlay label="กำลังตั้งรหัสผ่านใหม่ / Resetting password…" />}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form className="card" onSubmit={confirmReset}>
        <div className="field"><label htmlFor={emailId}>{t("อีเมล", "Email")}</label><input id={emailId} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor={codeId}>{t("รหัสจากอีเมล", "Reset code")}</label><input id={codeId} inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div className="field"><label htmlFor={newPasswordId}>{t("รหัสผ่านใหม่", "New password")}</label><input id={newPasswordId} type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></div>
        <div className="button-row"><button type="submit" disabled={submitting}>{t("ตั้งรหัสผ่านใหม่", "Reset password")}</button><button className="secondary" type="button" onClick={() => setResetStep("login")}>{t("กลับ", "Back")}</button></div>
      </form>
    </div>;
  }

  return <LoginGate
    title="Competitor Portal"
    notice={notice && <div className="notice-banner">{notice}</div>}
    footer={<button className="secondary" type="button" onClick={() => setResetStep("request")}>{t("ลืมรหัสผ่าน", "Forgot password?")}</button>}
  >
    {(actions) => <PortalDashboard {...actions} />}
  </LoginGate>;
}
