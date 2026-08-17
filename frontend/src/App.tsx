import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import DeploymentFreshnessGuard from "./components/DeploymentFreshnessGuard";
import LoadingScreen from "./components/LoadingScreen";

const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const PortalPage = lazy(() => import("./pages/PortalPage"));
const CommitteeApprovalsPage = lazy(() => import("./pages/CommitteeApprovalsPage"));
const CommitteeScanPage = lazy(() => import("./pages/CommitteeScanPage"));
const CheckInPage = lazy(() => import("./pages/CheckInPage"));
const InspectionPage = lazy(() => import("./pages/InspectionPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage"));
const AdminLanesPage = lazy(() => import("./pages/AdminLanesPage"));
const TimingPage = lazy(() => import("./pages/TimingPage"));
const ScoreboardPage = lazy(() => import("./pages/ScoreboardPage"));
const DeploymentPage = lazy(() => import("./pages/DeploymentPage"));

/**
 * The desktop console always loads the bundle from its own loopback server
 * (127.0.0.1:3210); the hosted site never does. That is the honest
 * discriminator between "running inside the packaged app" and "running on the
 * web", with no build flag to keep in sync.
 */
function isDesktopConsole(): boolean {
  const host = window.location.hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

export default function App() {
  const mode = import.meta.env.VITE_EVENT_MODE;
  if (mode !== "registration" && mode !== "competition" && mode !== "concluded") {
    return <main className="page"><div className="error-banner" role="alert">Invalid VITE_EVENT_MODE configuration</div></main>;
  }
  const fallback = mode === "registration" ? "/register" : "/scoreboard";
  return (
    <BrowserRouter>
      <DeploymentFreshnessGuard><Suspense fallback={<LoadingScreen />}><Routes>
        {mode === "registration" && <Route path="/register" element={<RegisterPage />} />}
        {mode !== "concluded" && <Route path="/portal" element={<PortalPage />} />}
        {mode !== "concluded" && <Route path="/portal/:competitorId" element={<PortalPage />} />}
        {mode === "registration" && <Route path="/committee/approvals" element={<CommitteeApprovalsPage />} />}
        {mode === "competition" && <Route path="/committee/checkin" element={<CheckInPage />} />}
        {mode === "competition" && <Route path="/committee/inspection" element={<InspectionPage />} />}
        {/*
          The combined Competition Day console belongs to the packaged desktop
          app, which serves this same bundle over loopback and opens it
          directly. On the hosted site the work is split across the focused
          check-in / inspection / lane / penalty pages instead.
        */}
        {mode === "competition" && <Route path="/competition-day" element={isDesktopConsole() ? <CommitteeScanPage /> : <Navigate to="/committee/checkin" replace />} />}
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        {mode === "competition" && <Route path="/admin/lanes" element={<AdminLanesPage />} />}
        {mode === "competition" && <Route path="/staff/timing" element={<TimingPage />} />}
        {mode !== "concluded" && <Route path="/admin/deployment" element={<DeploymentPage />} />}
        {mode !== "registration" && <Route path="/scoreboard" element={<ScoreboardPage />} />}
        <Route path="*" element={<Navigate to={fallback} replace />} />
      </Routes></Suspense></DeploymentFreshnessGuard>
    </BrowserRouter>
  );
}
