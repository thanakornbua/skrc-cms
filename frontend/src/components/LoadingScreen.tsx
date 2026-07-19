import { tt } from "../i18n";

interface LoadingScreenProps {
  /** Page-appropriate status text; accepts a legacy "ไทย / English" string and
   *  is resolved to the active locale. */
  label?: string;
  /** When true, render as a fixed overlay above the current page instead of a
   *  full standalone screen — used for in-flight submissions/actions. */
  overlay?: boolean;
}

/** The single loading treatment for the app: the animated gradient mark plus a
 *  status label. Used both as the initial page loader and — with `overlay` — as
 *  the pending-submission indicator, so loading feedback is consistent
 *  everywhere. Announced politely to assistive tech. */
export default function LoadingScreen({ label = "กำลังโหลด / Loading…", overlay = false }: LoadingScreenProps) {
  return (
    <div
      className={overlay ? "loading-screen loading-overlay" : "loading-screen"}
      role="status"
      aria-live="polite"
    >
      <span className="loading-mark" />
      <span>{tt(label)}</span>
    </div>
  );
}
