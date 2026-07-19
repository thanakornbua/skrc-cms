import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import RegisterPage from "./pages/RegisterPage";
import PortalPage from "./pages/PortalPage";
import CommitteeApprovalsPage from "./pages/CommitteeApprovalsPage";
import CommitteeScanPage from "./pages/CommitteeScanPage";
import AdminPage from "./pages/AdminPage";
import AdminLanesPage from "./pages/AdminLanesPage";
import TimingPage from "./pages/TimingPage";
import ScoreboardPage from "./pages/ScoreboardPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/portal" element={<PortalPage />} />
        <Route path="/portal/:competitorId" element={<PortalPage />} />
        <Route path="/committee/approvals" element={<CommitteeApprovalsPage />} />
        <Route path="/committee/scan" element={<CommitteeScanPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/lanes" element={<AdminLanesPage />} />
        <Route path="/staff/timing" element={<TimingPage />} />
        <Route path="/scoreboard" element={<ScoreboardPage />} />
        <Route path="*" element={<Navigate to="/register" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
