import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import {
  confirmResetPassword,
  confirmSignIn,
  fetchAuthSession,
  resetPassword,
  signIn,
  signOut,
} from "aws-amplify/auth";
import BrandHeader from "./BrandHeader";
import LoadingScreen from "./LoadingScreen";
import NavBar from "./NavBar";
import { t } from "../i18n";

interface LoginGateProps {
  title: string;
  children: (actions: { signOutAndReset: (message?: string) => Promise<void> }) => ReactNode;
  footer?: ReactNode;
  notice?: ReactNode;
}

export default function LoginGate({ title, children, footer, notice }: LoginGateProps) {
  const [state, setState] = useState<"loading" | "login" | "new_password" | "reset_request" | "reset_confirm" | "authed">("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const newPasswordId = useId();
  const confirmationCodeId = useId();

  useEffect(() => {
    // A remembered Cognito user is not sufficient for an API page. Require an
    // actual ID token before allowing children to issue protected requests.
    fetchAuthSession().then((session) => {
      if (!session.tokens?.idToken) throw new Error("No ID token");
      setState("authed");
    }).catch(() => setState("login"));
  }, []);

  async function handleLogin(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAuthError(null);
    setAuthNotice(null);
    setSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      setEmail(normalizedEmail);
      // Admin-created roster users use email aliases and a temporary password.
      // USER_PASSWORD_AUTH resolves the email alias correctly and returns the
      // NEW_PASSWORD_REQUIRED challenge; SRP can report the alias as missing.
      const result = await signIn({
        username: normalizedEmail,
        password,
        options: { authFlowType: "USER_PASSWORD_AUTH" },
      });
      if (result.isSignedIn) {
        setState("authed");
      } else if (result.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
        setPassword("");
        setState("new_password");
      } else if (result.nextStep.signInStep === "RESET_PASSWORD") {
        setPassword("");
        setState("reset_confirm");
      } else {
        throw new Error(`Additional sign-in step required: ${result.nextStep.signInStep}`);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function signOutAndReset(message?: string): Promise<void> {
    await signOut();
    setAuthError(message ?? null);
    setState("login");
  }

  async function handleNewPassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAuthError(null);
    setSubmitting(true);
    try {
      const result = await confirmSignIn({ challengeResponse: newPassword });
      if (!result.isSignedIn) throw new Error(`Additional sign-in step required: ${result.nextStep.signInStep}`);
      setNewPassword("");
      setState("authed");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not set the new password");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetRequest(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAuthError(null);
    setSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      setEmail(normalizedEmail);
      await resetPassword({ username: normalizedEmail });
      setState("reset_confirm");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not send reset code");
    } finally { setSubmitting(false); }
  }

  async function handleResetConfirm(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAuthError(null);
    setSubmitting(true);
    try {
      await confirmResetPassword({
        username: email.trim().toLowerCase(),
        confirmationCode: confirmationCode.trim(),
        newPassword,
      });
      setConfirmationCode("");
      setNewPassword("");
      setAuthNotice(t("ตั้งรหัสผ่านใหม่แล้ว กรุณาเข้าสู่ระบบ", "Password reset. Please sign in."));
      setState("login");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not reset password");
    } finally { setSubmitting(false); }
  }

  if (state === "loading") return <LoadingScreen />;
  if (state !== "authed") {
    return (
      <div className="page auth-page">
        {submitting && <LoadingScreen overlay label={state === "login" ? "กำลังเข้าสู่ระบบ / Signing in…" : state === "reset_request" ? "กำลังส่งรหัส / Sending code…" : "กำลังบันทึกรหัสผ่าน / Saving password…"} />}
        <NavBar />
        <BrandHeader title={title} />
        <div className="auth-card card">
          <div className="section-heading">
            <span className="section-kicker">SECURE ACCESS</span>
            <h2>{state === "new_password" || state === "reset_confirm" ? t("ตั้งรหัสผ่านใหม่", "Set new password") : state === "reset_request" ? t("ขอรหัสรีเซ็ต", "Request reset code") : t("ยืนยันตัวตน", "Sign in")}</h2>
          </div>
          {notice}
          {authNotice && <div className="notice-banner" role="status">{authNotice}</div>}
          {authError && <div className="error-banner" role="alert">{authError}</div>}
          {state === "new_password" ? <form onSubmit={handleNewPassword}>
            <p>{t("บัญชีนี้ใช้รหัสผ่านชั่วคราว กรุณาตั้งรหัสผ่านใหม่ก่อนดำเนินการต่อ", "This account uses a temporary password. Set a new password to continue.")}</p>
            <div className="field"><label htmlFor={newPasswordId}>{t("รหัสผ่านใหม่", "New password")}</label><input id={newPasswordId} type="password" required minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
            <div className="button-row"><button type="submit" disabled={submitting}>{submitting ? t("กำลังบันทึก", "Saving") : t("บันทึกรหัสผ่าน", "Set password")}</button></div>
          </form> : state === "reset_request" ? <form onSubmit={handleResetRequest}>
            <div className="field"><label htmlFor={emailId}>{t("อีเมล", "Email")}</label><input id={emailId} type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
            <div className="button-row"><button type="submit" disabled={submitting}>{t("ส่งรหัสรีเซ็ต", "Send reset code")}</button><button type="button" className="secondary" onClick={() => setState("login")}>{t("กลับ", "Back")}</button></div>
          </form> : state === "reset_confirm" ? <form onSubmit={handleResetConfirm}>
            <p>{t("กรอกรหัสจากอีเมลและตั้งรหัสผ่านใหม่", "Enter the code from your email and choose a new password.")}</p>
            <div className="field"><label htmlFor={emailId}>{t("อีเมล", "Email")}</label><input id={emailId} type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
            <div className="field"><label htmlFor={confirmationCodeId}>{t("รหัสยืนยัน", "Confirmation code")}</label><input id={confirmationCodeId} inputMode="numeric" autoComplete="one-time-code" required value={confirmationCode} onChange={(event) => setConfirmationCode(event.target.value)} /></div>
            <div className="field"><label htmlFor={newPasswordId}>{t("รหัสผ่านใหม่", "New password")}</label><input id={newPasswordId} type="password" autoComplete="new-password" minLength={12} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
            <div className="button-row"><button type="submit" disabled={submitting}>{t("บันทึกรหัสผ่าน", "Set password")}</button><button type="button" className="secondary" onClick={() => setState("reset_request")}>{t("ส่งรหัสอีกครั้ง", "Resend code")}</button></div>
          </form> : <form onSubmit={handleLogin}>
          <div className="field">
            <label htmlFor={emailId}>{t("อีเมล", "Email")}</label>
            <input id={emailId} type="email" autoComplete="username" placeholder="name@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={passwordId}>{t("รหัสผ่าน", "Password")}</label>
            <input id={passwordId} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="button-row">
            <button type="submit" disabled={submitting}>{submitting ? t("กำลังเข้าสู่ระบบ", "Signing in") : t("เข้าสู่ระบบ", "Sign in")}</button>
            <button type="button" className="secondary" onClick={() => { setAuthError(null); setAuthNotice(null); setState("reset_request"); }}>{t("ลืมรหัสผ่าน", "Forgot password")}</button>
            {footer}
          </div>
          </form>
          }
        </div>
      </div>
    );
  }
  return <>{children({ signOutAndReset })}</>;
}
