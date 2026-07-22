import { useEffect, useState, type ReactNode } from "react";

type EventMode = "registration" | "competition" | "concluded";

interface DeploymentManifest {
  eventMode?: unknown;
}

function isEventMode(value: unknown): value is EventMode {
  return value === "registration" || value === "competition" || value === "concluded";
}

/**
 * Event mode is compiled into Vite's bundle. A tab that was open during a mode
 * deployment cannot change routes until it loads the new bundle, so compare it
 * with the live manifest and require a full reload when they differ.
 */
export default function DeploymentFreshnessGuard({ children }: { children: ReactNode }) {
  const compiledMode = import.meta.env.VITE_EVENT_MODE as EventMode;
  const [liveMode, setLiveMode] = useState<EventMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`/deployment-manifest.json?fresh=${Date.now()}`, { cache: "no-store" });
        const manifest = await response.json() as DeploymentManifest;
        if (!cancelled) setLiveMode(isEventMode(manifest.eventMode) ? manifest.eventMode : null);
      } catch {
        // A temporary manifest fetch failure must not block a running event.
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), 30_000);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  if (liveMode && liveMode !== compiledMode) {
    return <main className="page auth-page">
      <div className="auth-card card">
        <span className="section-kicker">DEPLOYMENT UPDATED</span>
        <h1>New event mode is live</h1>
        <p>This tab is still running the {compiledMode} interface. Reload to use the {liveMode} interface.</p>
        <button type="button" onClick={() => window.location.assign("/scoreboard")}>Load {liveMode} mode</button>
      </div>
    </main>;
  }
  return <>{children}</>;
}
