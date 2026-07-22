import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import LoadingScreen from "./components/LoadingScreen";

const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const PortalPage = lazy(() => import("./pages/PortalPage"));
const CommitteeApprovalsPage = lazy(() => import("./pages/CommitteeApprovalsPage"));
const CommitteeScanPage = lazy(() => import("./pages/CommitteeScanPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const AdminLanesPage = lazy(() => import("./pages/AdminLanesPage"));
const TimingPage = lazy(() => import("./pages/TimingPage"));
const ScoreboardPage = lazy(() => import("./pages/ScoreboardPage"));
const DeploymentPage = lazy(() => import("./pages/DeploymentPage"));

export default function App() {
  const mode = import.meta.env.VITE_EVENT_MODE;
  if (mode !== "registration" && mode !== "competition" && mode !== "concluded") {
    return <main className="page"><div className="error-banner" role="alert">Invalid VITE_EVENT_MODE configuration</div></main>;
  }
  const fallback = mode === "registration" ? "/register" : "/scoreboard";
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingScreen />}><Routes>
        {mode === "registration" && <Route path="/register" element={<RegisterPage />} />}
        {mode !== "concluded" && <Route path="/portal" element={<PortalPage />} />}
        {mode !== "concluded" && <Route path="/portal/:competitorId" element={<PortalPage />} />}
        {mode === "registration" && <Route path="/committee/approvals" element={<CommitteeApprovalsPage />} />}
        {mode === "competition" && <Route path="/committee/scan" element={<CommitteeScanPage />} />}
        {mode === "competition" && <Route path="/admin" element={<AdminPage />} />}
        {mode === "competition" && <Route path="/admin/lanes" element={<AdminLanesPage />} />}
        {mode === "competition" && <Route path="/staff/timing" element={<TimingPage />} />}
        {mode !== "concluded" && <Route path="/admin/deployment" element={<DeploymentPage />} />}
        {mode !== "registration" && <Route path="/scoreboard" element={<ScoreboardPage />} />}
        <Route path="*" element={<Navigate to={fallback} replace />} />
      </Routes></Suspense>
    </BrowserRouter>
  );
}
