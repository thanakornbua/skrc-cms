import assert from "node:assert/strict";
import test from "node:test";
import { registerSchema } from "./handler.js";

const validRegistration = {
  teamName: "ทีมทดสอบ",
  category: "Line Tracing - Open",
  school: "โรงเรียนตัวอย่าง",
  certificateLanguage: "BILINGUAL",
  advisorNameThai: "อาจารย์ ตัวอย่าง",
  advisorNameEnglish: "Advisor Example",
  advisorEmail: "advisor@example.com",
  advisorPhone: "0812345678",
  student1NameThai: "นักเรียน หนึ่ง",
  student1NameEnglish: "Student One",
  contactEmail: "leader@example.com",
  contactPhone: "0812345678",
  student2NameThai: "นักเรียน สอง",
  student2NameEnglish: "Student Two",
  student3NameThai: "นักเรียน สาม",
  student3NameEnglish: "Student Three",
  pdpaConsent: true,
  pdpaAuthorityConfirmed: true,
} as const;

test("registration accepts every applicant-supplied field in ltrc_application.docx", () => {
  assert.equal(registerSchema.safeParse(validRegistration).success, true);
});

test("registration requires every template identity and advisor field", () => {
  for (const field of [
    "student2NameThai", "student2NameEnglish", "student3NameThai", "student3NameEnglish",
  ] as const) {
    const invalid = { ...validRegistration } as Record<string, unknown>;
    delete invalid[field];
    assert.equal(registerSchema.safeParse(invalid).success, false, field);
  }
  for (const field of [
    "school", "certificateLanguage", "advisorNameThai", "advisorNameEnglish", "advisorEmail", "advisorPhone",
  ] as const) {
    const invalid = { ...validRegistration } as Record<string, unknown>;
    delete invalid[field];
    assert.equal(registerSchema.safeParse(invalid).success, false, field);
  }
});
