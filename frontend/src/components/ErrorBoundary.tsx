import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Turns a render crash into a readable page instead of a blank one.
 *
 * React unmounts the whole tree when a render throws, which on competition day
 * looks like the console simply deciding to show nothing — no card, no error,
 * nothing to act on. That happened for real when an older API omitted a field
 * the inspection page spread. Staff need to see *that* something broke, and
 * what, so they can report it and keep the event moving.
 *
 * Recovery is deliberately two-step: "try again" re-renders in place, which is
 * enough when the cause was transient state, and a reload is offered next to it
 * because a crash driven by fetched data usually repeats until the data is
 * fetched again.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console so an operator can read the stack to us over the
    // phone; there is no error-reporting backend to send it to.
    console.error("Console crashed while rendering", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="page error-page" role="alert">
        <div className="card">
          <span className="section-kicker">SYSTEM</span>
          <h1>{t("หน้านี้ขัดข้อง", "This screen stopped working")}</h1>
          <p>{t(
            "ข้อมูลที่บันทึกไว้แล้วไม่ได้รับผลกระทบ ลองใหม่อีกครั้งหรือโหลดหน้าใหม่ หากยังไม่หาย ให้แจ้งผู้ดูแลระบบพร้อมข้อความด้านล่าง",
            "Nothing already recorded is affected. Try again or reload; if it persists, report the message below to an administrator.",
          )}</p>
          <p className="technical error-detail">{error.message || String(error)}</p>
          <div className="button-row">
            <button type="button" onClick={() => this.setState({ error: null })}>
              {t("ลองใหม่", "Try again")}
            </button>
            <button className="secondary" type="button" onClick={() => window.location.reload()}>
              {t("โหลดหน้าใหม่", "Reload page")}
            </button>
            <button className="secondary" type="button" onClick={() => window.location.assign("/admin")}>
              {t("กลับหน้าหลัก", "Back to the console")}
            </button>
          </div>
        </div>
      </main>
    );
  }
}
