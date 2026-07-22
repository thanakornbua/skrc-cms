import assert from "node:assert/strict";
import test from "node:test";
import { registerSchema } from "./handler.js";

const validRegistration = {
  teamName: "ทีมทดสอบ",
  category: "Line Tracing - Open",
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

test("registration accepts the documented payload without legacy advisor fields", () => {
  assert.equal(registerSchema.safeParse(validRegistration).success, true);
});

test("registration requires all three bilingual student identities", () => {
  for (const field of [
    "student2NameThai", "student2NameEnglish", "student3NameThai", "student3NameEnglish",
  ] as const) {
    const invalid = { ...validRegistration } as Record<string, unknown>;
    delete invalid[field];
    assert.equal(registerSchema.safeParse(invalid).success, false, field);
  }
});
