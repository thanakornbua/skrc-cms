import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiClientError, ec2Json } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import LoginGate from "../components/LoginGate";
import NavBar from "../components/NavBar";
import { t } from "../i18n";

interface Lane {
  laneId: string;
  state: "IDLE" | "ASSIGNED" | "ARMED" | "RUNNING";
  competitorId: string | null;
  deviceId: string | null;
  armedBy: string | null;
  runStartedAt: string | null;
  updatedAt: string | null;
}

function AdminLanesDashboard({ signOutAndReset }: { signOutAndReset: () => Promise<void> }) {
  const [role, setRole] = useState<"admin" | "committee" | "competitor">("competitor");
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyLane, setBusyLane] = useState<string | null>(null);
  const [assignValues, setAssignValues] = useState<Record<string, string>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  const assignInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const teamNamesRef = useRef<Record<string, string>>({});

  async function loadLanes(isCancelled: () => boolean = () => false): Promise<void> {
    try {
      const result = await ec2Json<{ lanes: Lane[] }>("/admin/lanes");
      if (isCancelled()) return;
      setLanes(result.lanes);
      setLoadError(null);

      const assignedIds = result.lanes
        .map((l) => l.competitorId)
        .filter((id): id is string => id !== null)
        .filter((id) => !teamNamesRef.current[id]);
      const lookups = await Promise.all(
        assignedIds.map(async (id) => {
          try {
            const c = await ec2Json<{ teamName: string }>(`/competitors/${encodeURIComponent(id)}`);
            return [id, c.teamName] as const;
          } catch {
            return [id, id] as const;
          }
        })
      );
      if (!isCancelled() && lookups.length > 0) {
        const additions = Object.fromEntries(lookups);
        teamNamesRef.current = { ...teamNamesRef.current, ...additions };
        setTeamNames(teamNamesRef.current);
      }
    } catch (err) {
      if (!isCancelled()) {
        setLoadError(err instanceof Error ? err.message : "Failed to load lanes");
      }
    }
  }

  useEffect(() => {
    ec2Json<{ role: "admin" | "committee" | "competitor" }>("/auth/me").then((me) => setRole(me.role)).catch(() => {});
    let cancelled = false;
    const poll = () => {
      loadLanes(() => cancelled).catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ticks independently of the 2s lane poll so a running lane's elapsed time
  // reads smoothly instead of jumping in 2-second steps.
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 100);
    return () => clearInterval(interval);
  }, []);

  async function laneAction(laneId: string, action: string, body?: object): Promise<boolean> {
    setActionError(null);
    setBusyLane(laneId);
    try {
      await ec2Json(`/admin/lanes/${encodeURIComponent(laneId)}/${action}`, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await loadLanes();
      return true;
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : `Lane ${action} failed`);
      return false;
    } finally {
      setBusyLane(null);
    }
  }

  async function handleAssign(laneId: string): Promise<void> {
    const competitorId = (assignValues[laneId] ?? "").trim();
    if (!competitorId) return;
    if (await laneAction(laneId, "assign", { competitorId })) {
      setAssignValues((v) => ({ ...v, [laneId]: "" }));
    }
    assignInputRefs.current[laneId]?.focus();
  }

  function handleAssignKeyDown(e: KeyboardEvent<HTMLInputElement>, laneId: string): void {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAssign(laneId);
    }
  }

  return (
    <div className="page page-wide">
      {busyLane && <LoadingScreen overlay label="กำลังดำเนินการ / Working…" />}
      <NavBar onSignOut={signOutAndReset} />
      <BrandHeader title="Admin — Lanes" home="/admin" description="กำหนดผู้เข้าแข่งขันและเตรียมตัวจับเวลา / Assign competitors and arm timing lanes" />

      {loadError && <div className="error-banner" role="alert">{loadError}</div>}
      {actionError && <div className="error-banner" role="alert">{actionError}</div>}

      <div className="card-grid">
        {lanes.map((lane) => (
          <div className="card lane-card" data-state={lane.state} key={lane.laneId}>
            <span className={`status-badge ${lane.state === "RUNNING" ? "success" : lane.state === "ARMED" ? "warning" : ""}`}>{lane.state}</span>
            <h2>{t("สนาม", "Lane")} <span className="technical">{lane.laneId}</span></h2>
            <p>
              {t("ทีม", "Team")}:{" "}
              {lane.competitorId
                ? `${teamNames[lane.competitorId] ?? lane.competitorId} (${lane.competitorId})`
                : "—"}
            </p>
            {lane.deviceId && <p>{t("อุปกรณ์", "Device")}: <span className="technical">{lane.deviceId}</span></p>}
            {lane.armedBy && lane.state !== "IDLE" && <p>{t("เตรียมโดย", "Armed by")}: {lane.armedBy}</p>}
            {lane.state === "RUNNING" && lane.runStartedAt && (
              <p className="lane-elapsed">
                {t("เวลาที่ผ่านไป", "Elapsed")}: <span className="technical">{Math.max(0, (nowMs - Date.parse(lane.runStartedAt)) / 1000).toFixed(1)} s</span>
              </p>
            )}

            {lane.state === "IDLE" && (
              <div className="field">
                <label htmlFor={`lane-assign-${lane.laneId}`}>{t("สแกนหรือกรอกหมายเลข", "Competitor ID")}</label>
                <input
                  id={`lane-assign-${lane.laneId}`}
                  ref={(el) => {
                    assignInputRefs.current[lane.laneId] = el;
                  }}
                  value={assignValues[lane.laneId] ?? ""}
                  onChange={(e) =>
                    setAssignValues((v) => ({ ...v, [lane.laneId]: e.target.value }))
                  }
                  onKeyDown={(e) => handleAssignKeyDown(e, lane.laneId)}
                  placeholder="C-0042"
                />
                <button
                  type="button"
                  disabled={busyLane === lane.laneId}
                  onClick={() => handleAssign(lane.laneId)}
                >
                  {t("กำหนด", "Assign")}
                </button>
              </div>
            )}

            {lane.state === "ASSIGNED" && (
              <button
                type="button"
                disabled={busyLane === lane.laneId}
                onClick={() => laneAction(lane.laneId, "arm")}
              >
                {t("เตรียมจับเวลา", "Arm")}
              </button>
            )}

            {lane.state !== "IDLE" && role === "admin" && (
              <button
                className="danger"
                type="button"
                disabled={busyLane === lane.laneId}
                onClick={() => laneAction(lane.laneId, "reset")}
              >
                {t("รีเซ็ต", "Reset")}
              </button>
            )}
          </div>
        ))}
        {lanes.length === 0 && !loadError && <div className="empty-state">{t("ยังไม่ได้ตั้งค่าสนาม", "No lanes configured")}</div>}
      </div>
    </div>
  );
}

export default function AdminLanesPage() {
  return <LoginGate title="Staff Login">{(actions) => <AdminLanesDashboard {...actions} />}</LoginGate>;
}
