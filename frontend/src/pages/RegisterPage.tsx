import { useEffect, useId, useState, type FormEvent } from "react";
import { confirmSignUp, getCurrentUser, signIn, signUp } from "aws-amplify/auth";
import { ApiClientError, regweekJson } from "../api";
import BrandHeader from "../components/BrandHeader";
import LoadingScreen from "../components/LoadingScreen";
import NavBar from "../components/NavBar";
import PdpaAgreement from "../components/PdpaAgreement";
import SchoolAutocomplete from "../components/SchoolAutocomplete";
import { t } from "../i18n";

const CATEGORIES = ["Line Tracing - Open"];
type Step = "loading" | "auth" | "confirm" | "form" | "submitted";

export default function RegisterPage() {
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [step, setStep] = useState<Step>("loading");
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [school, setSchool] = useState("");
  const [certificateLanguage, setCertificateLanguage] = useState("BILINGUAL");
  const [advisorNameThai, setAdvisorNameThai] = useState("");
  const [advisorNameEnglish, setAdvisorNameEnglish] = useState("");
  const [advisorEmail, setAdvisorEmail] = useState("");
  const [advisorPhone, setAdvisorPhone] = useState("");
  const [student1NameThai, setStudent1NameThai] = useState("");
  const [student1NameEnglish, setStudent1NameEnglish] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [student2NameThai, setStudent2NameThai] = useState("");
  const [student2NameEnglish, setStudent2NameEnglish] = useState("");
  const [student3NameThai, setStudent3NameThai] = useState("");
  const [student3NameEnglish, setStudent3NameEnglish] = useState("");
  const [student1FoodAllergy, setStudent1FoodAllergy] = useState("NONE");
  const [student2FoodAllergy, setStudent2FoodAllergy] = useState("NONE");
  const [student3FoodAllergy, setStudent3FoodAllergy] = useState("NONE");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const errId = (name: string) => `${uid}-${name}-err`;

  useEffect(() => {
    getCurrentUser().then(() => setStep("form")).catch(() => setStep("auth"));
  }, []);

  async function handleAuthSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAuthError(null);
    setSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      setEmail(normalizedEmail);
      if (authMode === "signup") {
        const result = await signUp({ username: normalizedEmail, password, options: { userAttributes: { email: normalizedEmail } } });
        if (result.nextStep.signUpStep !== "DONE") {
          setStep("confirm");
          return;
        }
      }
      await signIn({
        username: normalizedEmail,
        password,
        options: { authFlowType: "USER_PASSWORD_AUTH" },
      });
      setContactEmail(normalizedEmail);
      setStep("form");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmation(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAuthError(null);
    setSubmitting(true);
    try {
      await confirmSignUp({ username: email, confirmationCode: confirmationCode.trim() });
      await signIn({ username: email, password, options: { authFlowType: "USER_PASSWORD_AUTH" } });
      setContactEmail(email);
      setPassword("");
      setConfirmationCode("");
      setStep("form");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Confirmation failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitRegistration(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await regweekJson("/register", {
        method: "POST",
        body: JSON.stringify({
          teamName, category, student1NameThai, student1NameEnglish,
          school, certificateLanguage, advisorNameThai, advisorNameEnglish, advisorEmail, advisorPhone,
          contactEmail, contactPhone, student2NameThai, student2NameEnglish,
          student3NameThai, student3NameEnglish, student1FoodAllergy, student2FoodAllergy, student3FoodAllergy,
          pdpaConsent: true,
          pdpaAuthorityConfirmed: true,
        }),
      });
      setStep("submitted");
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message);
        if (err.fields) setFieldErrors(Object.fromEntries(err.fields.map((field) => [field.field, field.message])));
      } else {
        setFormError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!agreementAccepted) return <PdpaAgreement onAccept={() => setAgreementAccepted(true)} />;

  if (step === "loading") return <LoadingScreen />;

  if (step === "auth") {
    return <div className="page auth-page">
      {submitting && <LoadingScreen overlay label="กำลังยืนยันตัวตน / Signing in…" />}
      <NavBar />
      <BrandHeader title="Register" description="สมัครฟรี ไม่มีค่าธรรมเนียม / Free registration, no payment required" />
      <div className="card auth-card">
        {authError && <div className="error-banner" role="alert">{authError}</div>}
        <form onSubmit={handleAuthSubmit}>
          <div className="field"><label htmlFor={fid("authEmail")}>{t("อีเมล", "Email")}</label><input id={fid("authEmail")} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor={fid("authPassword")}>{t("รหัสผ่าน", "Password")}</label><input id={fid("authPassword")} type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div className="button-row"><button type="submit" disabled={submitting}>{authMode === "signup" ? t("สร้างบัญชี", "Create account") : t("เข้าสู่ระบบ", "Sign in")}</button></div>
        </form>
        <div className="button-row auth-switch"><button className="secondary" type="button" onClick={() => setAuthMode((mode) => mode === "signup" ? "signin" : "signup")}>{authMode === "signup" ? t("มีบัญชีแล้ว", "Sign in") : t("สร้างบัญชีใหม่", "Create account")}</button></div>
      </div>
    </div>;
  }

  if (step === "confirm") {
    return <div className="page auth-page">
      {submitting && <LoadingScreen overlay label="กำลังยืนยันบัญชี / Confirming account…" />}
      <NavBar />
      <BrandHeader title="Confirm account" description="ตรวจสอบอีเมลเพื่อรับรหัสยืนยัน / Check your email for the confirmation code" />
      <div className="card auth-card">
        {authError && <div className="error-banner" role="alert">{authError}</div>}
        <form onSubmit={handleConfirmation}>
          <div className="field"><label htmlFor={fid("confirmationCode")}>{t("รหัสยืนยัน", "Confirmation code")}</label><input id={fid("confirmationCode")} inputMode="numeric" autoComplete="one-time-code" required value={confirmationCode} onChange={(event) => setConfirmationCode(event.target.value)} /></div>
          <div className="button-row"><button type="submit" disabled={submitting}>{t("ยืนยันและเข้าสู่ระบบ", "Confirm and sign in")}</button><button type="button" className="secondary" onClick={() => setStep("auth")}>{t("ย้อนกลับ", "Back")}</button></div>
        </form>
      </div>
    </div>;
  }

  if (step === "submitted") {
    return <div className="page"><NavBar /><BrandHeader title="Registration submitted" />
      <div className="card"><span className="status-badge success">SUBMITTED</span><h2>{t("ส่งใบสมัครเรียบร้อยแล้ว", "Registration submitted")}</h2><p>{t("ส่งใบสมัครฟรีให้คณะกรรมการตรวจสอบแล้ว", "Your free registration has been submitted for committee approval.")}</p><a href="/portal">{t("ติดตามสถานะ", "Track status")}</a></div>
    </div>;
  }

  return <div className="page registration-page">
    {submitting && <LoadingScreen overlay label="กำลังส่งใบสมัคร / Submitting registration…" />}
    <NavBar />
    <BrandHeader title="Register" description="กรอกข้อมูลทีมและสมาชิกทั้งภาษาไทยและอังกฤษ / Enter team and student details in Thai and English" />
    {formError && <div className="error-banner" role="alert">{formError}</div>}
    <form className="card" onSubmit={handleSubmitRegistration}>
      <section className="form-section">
        <span className="section-kicker">TEAM INFORMATION</span><h2>{t("ข้อมูลทีม", "Team information")}</h2>
        <div className="field"><label htmlFor={fid("teamName")}>{t("ชื่อทีม", "Team name")}</label><input id={fid("teamName")} required value={teamName} onChange={(e) => setTeamName(e.target.value)} aria-invalid={fieldErrors.teamName ? true : undefined} aria-describedby={fieldErrors.teamName ? errId("teamName") : undefined} />{fieldErrors.teamName && <small id={errId("teamName")}>{fieldErrors.teamName}</small>}</div>
        <div className="field"><label htmlFor={fid("category")}>{t("ประเภทการแข่งขัน", "Category")}</label><select id={fid("category")} value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
      </section>

      <section className="form-section">
        <span className="section-kicker">SCHOOL & ADVISOR</span><h2>{t("โรงเรียนและอาจารย์ที่ปรึกษา", "School & advisor")}</h2>
        <div className="field"><label htmlFor={fid("school")}>{t("สถานศึกษาหลัก", "School")}</label><SchoolAutocomplete id={fid("school")} lang="th" required value={school} onChange={setSchool} aria-invalid={fieldErrors.school ? true : undefined} aria-describedby={fieldErrors.school ? errId("school") : undefined} />{fieldErrors.school && <small id={errId("school")}>{fieldErrors.school}</small>}</div>
        <div className="field"><label htmlFor={fid("certificateLanguage")}>{t("ภาษาเกียรติบัตร", "Certificate language")}</label><select id={fid("certificateLanguage")} value={certificateLanguage} onChange={(e) => setCertificateLanguage(e.target.value)} aria-invalid={fieldErrors.certificateLanguage ? true : undefined} aria-describedby={fieldErrors.certificateLanguage ? errId("certificateLanguage") : undefined}><option value="BILINGUAL">{t("ไทยและอังกฤษ", "Thai and English")}</option><option value="THAI">{t("ภาษาไทย", "Thai")}</option><option value="ENGLISH">{t("ภาษาอังกฤษ", "English")}</option></select>{fieldErrors.certificateLanguage && <small id={errId("certificateLanguage")}>{fieldErrors.certificateLanguage}</small>}</div>
        <div className="field-grid">
          <div className="field"><label htmlFor={fid("advisorNameThai")}>{t("ชื่อ-นามสกุลอาจารย์ที่ปรึกษา ภาษาไทย", "Advisor full name in Thai")}</label><input id={fid("advisorNameThai")} lang="th" required value={advisorNameThai} onChange={(e) => setAdvisorNameThai(e.target.value)} aria-invalid={fieldErrors.advisorNameThai ? true : undefined} aria-describedby={fieldErrors.advisorNameThai ? errId("advisorNameThai") : undefined} />{fieldErrors.advisorNameThai && <small id={errId("advisorNameThai")}>{fieldErrors.advisorNameThai}</small>}</div>
          <div className="field"><label htmlFor={fid("advisorNameEnglish")}>{t("ชื่อ-นามสกุลอาจารย์ที่ปรึกษา ภาษาอังกฤษ", "Advisor full name in English")}</label><input id={fid("advisorNameEnglish")} required value={advisorNameEnglish} onChange={(e) => setAdvisorNameEnglish(e.target.value)} aria-invalid={fieldErrors.advisorNameEnglish ? true : undefined} aria-describedby={fieldErrors.advisorNameEnglish ? errId("advisorNameEnglish") : undefined} />{fieldErrors.advisorNameEnglish && <small id={errId("advisorNameEnglish")}>{fieldErrors.advisorNameEnglish}</small>}</div>
          <div className="field"><label htmlFor={fid("advisorEmail")}>{t("อีเมลอาจารย์ที่ปรึกษา", "Advisor email")}</label><input id={fid("advisorEmail")} type="email" autoComplete="email" required value={advisorEmail} onChange={(e) => setAdvisorEmail(e.target.value)} aria-invalid={fieldErrors.advisorEmail ? true : undefined} aria-describedby={fieldErrors.advisorEmail ? errId("advisorEmail") : undefined} />{fieldErrors.advisorEmail && <small id={errId("advisorEmail")}>{fieldErrors.advisorEmail}</small>}</div>
          <div className="field"><label htmlFor={fid("advisorPhone")}>{t("หมายเลขโทรศัพท์อาจารย์ที่ปรึกษา", "Advisor phone number")}</label><input id={fid("advisorPhone")} type="tel" inputMode="tel" autoComplete="tel" required value={advisorPhone} onChange={(e) => setAdvisorPhone(e.target.value)} aria-invalid={fieldErrors.advisorPhone ? true : undefined} aria-describedby={fieldErrors.advisorPhone ? errId("advisorPhone") : undefined} />{fieldErrors.advisorPhone && <small id={errId("advisorPhone")}>{fieldErrors.advisorPhone}</small>}</div>
        </div>
      </section>

      <section className="form-section">
        <span className="section-kicker">STUDENT 01 · TEAM LEADER</span><h2>{t("นักเรียนคนที่ 1 — หัวหน้าทีมและผู้ประสานงาน", "Student 1 — Team leader and correspondent")}</h2>
        <div className="field"><label htmlFor={fid("student1NameThai")}>{t("ชื่อ-นามสกุล ภาษาไทย", "Full name in Thai")}</label><input id={fid("student1NameThai")} lang="th" required value={student1NameThai} onChange={(e) => setStudent1NameThai(e.target.value)} aria-invalid={fieldErrors.student1NameThai ? true : undefined} aria-describedby={fieldErrors.student1NameThai ? errId("student1NameThai") : undefined} />{fieldErrors.student1NameThai && <small id={errId("student1NameThai")}>{fieldErrors.student1NameThai}</small>}</div>
        <div className="field"><label htmlFor={fid("student1NameEnglish")}>{t("ชื่อ-นามสกุล ภาษาอังกฤษ", "Full name in English")}</label><input id={fid("student1NameEnglish")} required value={student1NameEnglish} onChange={(e) => setStudent1NameEnglish(e.target.value)} aria-invalid={fieldErrors.student1NameEnglish ? true : undefined} aria-describedby={fieldErrors.student1NameEnglish ? errId("student1NameEnglish") : undefined} />{fieldErrors.student1NameEnglish && <small id={errId("student1NameEnglish")}>{fieldErrors.student1NameEnglish}</small>}</div>
        <div className="field-grid">
          <div className="field"><label htmlFor={fid("contactEmail")}>{t("อีเมลติดต่อ", "Contact email")}</label><input id={fid("contactEmail")} type="email" autoComplete="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} aria-invalid={fieldErrors.contactEmail ? true : undefined} aria-describedby={fieldErrors.contactEmail ? errId("contactEmail") : undefined} />{fieldErrors.contactEmail && <small id={errId("contactEmail")}>{fieldErrors.contactEmail}</small>}</div>
          <div className="field"><label htmlFor={fid("contactPhone")}>{t("หมายเลขโทรศัพท์", "Phone number")}</label><input id={fid("contactPhone")} type="tel" inputMode="tel" autoComplete="tel" required value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} aria-invalid={fieldErrors.contactPhone ? true : undefined} aria-describedby={fieldErrors.contactPhone ? errId("contactPhone") : undefined} />{fieldErrors.contactPhone && <small id={errId("contactPhone")}>{fieldErrors.contactPhone}</small>}</div>
        </div>
        <div className="field"><label htmlFor={fid("student1FoodAllergy")}>{t("การแพ้อาหาร (ระบุว่า ไม่มี หากไม่มี)", "Food allergy (enter NONE if there is none)")}</label><input id={fid("student1FoodAllergy")} required maxLength={500} value={student1FoodAllergy} onChange={(e) => setStudent1FoodAllergy(e.target.value)} aria-invalid={fieldErrors.student1FoodAllergy ? true : undefined} aria-describedby={fieldErrors.student1FoodAllergy ? errId("student1FoodAllergy") : undefined} />{fieldErrors.student1FoodAllergy && <small id={errId("student1FoodAllergy")}>{fieldErrors.student1FoodAllergy}</small>}</div>
      </section>

      <section className="form-section">
        <span className="section-kicker">STUDENT 02</span><h2>{t("นักเรียนคนที่ 2", "Student 2")}</h2>
        <div className="field-grid">
          <div className="field"><label htmlFor={fid("student2NameThai")}>{t("ชื่อ-นามสกุล ภาษาไทย", "Full name in Thai")}</label><input id={fid("student2NameThai")} lang="th" required value={student2NameThai} onChange={(e) => setStudent2NameThai(e.target.value)} aria-invalid={fieldErrors.student2NameThai ? true : undefined} aria-describedby={fieldErrors.student2NameThai ? errId("student2NameThai") : undefined} />{fieldErrors.student2NameThai && <small id={errId("student2NameThai")}>{fieldErrors.student2NameThai}</small>}</div>
          <div className="field"><label htmlFor={fid("student2NameEnglish")}>{t("ชื่อ-นามสกุล ภาษาอังกฤษ", "Full name in English")}</label><input id={fid("student2NameEnglish")} required value={student2NameEnglish} onChange={(e) => setStudent2NameEnglish(e.target.value)} aria-invalid={fieldErrors.student2NameEnglish ? true : undefined} aria-describedby={fieldErrors.student2NameEnglish ? errId("student2NameEnglish") : undefined} />{fieldErrors.student2NameEnglish && <small id={errId("student2NameEnglish")}>{fieldErrors.student2NameEnglish}</small>}</div>
        </div>
        <div className="field"><label htmlFor={fid("student2FoodAllergy")}>{t("การแพ้อาหาร (ระบุว่า ไม่มี หากไม่มี)", "Food allergy (enter NONE if there is none)")}</label><input id={fid("student2FoodAllergy")} required maxLength={500} value={student2FoodAllergy} onChange={(e) => setStudent2FoodAllergy(e.target.value)} aria-invalid={fieldErrors.student2FoodAllergy ? true : undefined} aria-describedby={fieldErrors.student2FoodAllergy ? errId("student2FoodAllergy") : undefined} />{fieldErrors.student2FoodAllergy && <small id={errId("student2FoodAllergy")}>{fieldErrors.student2FoodAllergy}</small>}</div>
      </section>

      <section className="form-section">
        <span className="section-kicker">STUDENT 03</span><h2>{t("นักเรียนคนที่ 3", "Student 3")}</h2>
        <div className="field-grid">
          <div className="field"><label htmlFor={fid("student3NameThai")}>{t("ชื่อ-นามสกุล ภาษาไทย", "Full name in Thai")}</label><input id={fid("student3NameThai")} lang="th" required value={student3NameThai} onChange={(e) => setStudent3NameThai(e.target.value)} aria-invalid={fieldErrors.student3NameThai ? true : undefined} aria-describedby={fieldErrors.student3NameThai ? errId("student3NameThai") : undefined} />{fieldErrors.student3NameThai && <small id={errId("student3NameThai")}>{fieldErrors.student3NameThai}</small>}</div>
          <div className="field"><label htmlFor={fid("student3NameEnglish")}>{t("ชื่อ-นามสกุล ภาษาอังกฤษ", "Full name in English")}</label><input id={fid("student3NameEnglish")} required value={student3NameEnglish} onChange={(e) => setStudent3NameEnglish(e.target.value)} aria-invalid={fieldErrors.student3NameEnglish ? true : undefined} aria-describedby={fieldErrors.student3NameEnglish ? errId("student3NameEnglish") : undefined} />{fieldErrors.student3NameEnglish && <small id={errId("student3NameEnglish")}>{fieldErrors.student3NameEnglish}</small>}</div>
        </div>
        <div className="field"><label htmlFor={fid("student3FoodAllergy")}>{t("การแพ้อาหาร (ระบุว่า ไม่มี หากไม่มี)", "Food allergy (enter NONE if there is none)")}</label><input id={fid("student3FoodAllergy")} required maxLength={500} value={student3FoodAllergy} onChange={(e) => setStudent3FoodAllergy(e.target.value)} aria-invalid={fieldErrors.student3FoodAllergy ? true : undefined} aria-describedby={fieldErrors.student3FoodAllergy ? errId("student3FoodAllergy") : undefined} />{fieldErrors.student3FoodAllergy && <small id={errId("student3FoodAllergy")}>{fieldErrors.student3FoodAllergy}</small>}</div>
      </section>

      <div className="notice-banner consent-summary"><strong>{t("ยอมรับข้อตกลง PDPA แล้ว", "PDPA agreement accepted")}</strong><button className="secondary" type="button" onClick={() => setAgreementAccepted(false)}>{t("อ่านอีกครั้ง", "Review")}</button></div>

      <div className="button-row"><button type="submit" disabled={submitting}>{submitting ? t("กำลังส่ง", "Submitting…") : t("ส่งใบสมัคร", "Submit registration")}</button></div>
    </form>
  </div>;
}
