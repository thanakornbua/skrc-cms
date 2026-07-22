import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { confirmSignIn, fetchAuthSession, signIn, signOut } from "aws-amplify/auth";
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
  const [state, setState] = useState<"loading" | "login" | "new_password" | "authed">("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const newPasswordId = useId();

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

  if (state === "loading") return <LoadingScreen />;
  if (state === "login" || state === "new_password") {
    return (
      <div className="page auth-page">
        {submitting && <LoadingScreen overlay label={state === "new_password" ? "กำลังบันทึกรหัสผ่าน / Saving password…" : "กำลังเข้าสู่ระบบ / Signing in…"} />}
        <NavBar />
        <BrandHeader title={title} />
        <div className="auth-card card">
          <div className="section-heading">
            <span className="section-kicker">SECURE ACCESS</span>
            <h2>{state === "new_password" ? t("ตั้งรหัสผ่านใหม่", "Set new password") : t("ยืนยันตัวตน", "Sign in")}</h2>
          </div>
          {notice}
          {authError && <div className="error-banner" role="alert">{authError}</div>}
          {state === "new_password" ? <form onSubmit={handleNewPassword}>
            <p>{t("บัญชีนี้ใช้รหัสผ่านชั่วคราว กรุณาตั้งรหัสผ่านใหม่ก่อนดำเนินการต่อ", "This account uses a temporary password. Set a new password to continue.")}</p>
            <div className="field"><label htmlFor={newPasswordId}>{t("รหัสผ่านใหม่", "New password")}</label><input id={newPasswordId} type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
            <div className="button-row"><button type="submit" disabled={submitting}>{submitting ? t("กำลังบันทึก", "Saving") : t("บันทึกรหัสผ่าน", "Set password")}</button></div>
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
