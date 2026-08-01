import assert from "node:assert/strict";
import test from "node:test";
import { competitorUpdateSchema, registerSchema } from "./handler.js";

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
  student1FoodAllergy: "NONE",
  student2FoodAllergy: "NONE",
  student3FoodAllergy: "Peanut",
  pdpaConsent: true,
  pdpaAuthorityConfirmed: true,
} as const;

test("registration accepts every applicant-supplied field in ltrc_application.docx", () => {
  assert.equal(registerSchema.safeParse(validRegistration).success, true);
});

test("registration accepts teams of one, two, or three members", () => {
  const oneMember = { ...validRegistration } as Record<string, unknown>;
  for (const field of [
    "student2NameThai", "student2NameEnglish", "student3NameThai", "student3NameEnglish",
    "student2FoodAllergy", "student3FoodAllergy",
  ]) delete oneMember[field];
  assert.equal(registerSchema.safeParse(oneMember).success, true);

  const twoMembers = { ...validRegistration } as Record<string, unknown>;
  for (const field of ["student3NameThai", "student3NameEnglish", "student3FoodAllergy"]) delete twoMembers[field];
  assert.equal(registerSchema.safeParse(twoMembers).success, true);
  assert.equal(registerSchema.safeParse(validRegistration).success, true);
});

test("registration accepts unaffiliated entrants without a school or advisor", () => {
  const unaffiliated = { ...validRegistration } as Record<string, unknown>;
  for (const field of ["school", "advisorNameThai", "advisorNameEnglish", "advisorEmail", "advisorPhone"]) {
    delete unaffiliated[field];
  }
  assert.equal(registerSchema.safeParse(unaffiliated).success, true);
});

test("registration requires complete details for every listed member", () => {
  for (const field of ["student1FoodAllergy"] as const) {
    const invalid = { ...validRegistration } as Record<string, unknown>;
    delete invalid[field];
    assert.equal(registerSchema.safeParse(invalid).success, false, field);
  }
  for (const field of ["certificateLanguage"] as const) {
    const invalid = { ...validRegistration } as Record<string, unknown>;
    delete invalid[field];
    assert.equal(registerSchema.safeParse(invalid).success, false, field);
  }

  for (const field of ["student2NameThai", "student2NameEnglish", "student2FoodAllergy"] as const) {
    const invalid = { ...validRegistration } as Record<string, unknown>;
    delete invalid[field];
    assert.equal(registerSchema.safeParse(invalid).success, false, field);
  }

  for (const field of ["advisorNameThai", "advisorNameEnglish", "advisorEmail", "advisorPhone"] as const) {
    const invalid = { ...validRegistration } as Record<string, unknown>;
    delete invalid[field];
    assert.equal(registerSchema.safeParse(invalid).success, false, field);
  }
});

test("registration does not allow a third member without a second member", () => {
  const invalid = { ...validRegistration } as Record<string, unknown>;
  delete invalid.student2NameThai;
  delete invalid.student2NameEnglish;
  delete invalid.student2FoodAllergy;
  assert.equal(registerSchema.safeParse(invalid).success, false);
});

test("competitor updates require an audit reason and optimistic revision", () => {
  const { pdpaConsent, pdpaAuthorityConfirmed, ...profile } = validRegistration;
  void pdpaConsent;
  void pdpaAuthorityConfirmed;
  assert.equal(competitorUpdateSchema.safeParse({
    ...profile,
    expectedUpdatedAt: "2026-08-02T04:00:00.000Z",
    reason: "Corrected spelling from registration form",
  }).success, true);
  assert.equal(competitorUpdateSchema.safeParse({ ...profile, expectedUpdatedAt: "2026-08-02T04:00:00.000Z" }).success, false);
  assert.equal(competitorUpdateSchema.safeParse({ ...profile, reason: "Corrected spelling" }).success, false);
});

test("competitor updates preserve the one-to-three member rule", () => {
  const { pdpaConsent, pdpaAuthorityConfirmed, ...profile } = validRegistration;
  void pdpaConsent;
  void pdpaAuthorityConfirmed;
  const oneMember = { ...profile } as Record<string, unknown>;
  for (const field of [
    "student2NameThai", "student2NameEnglish", "student2FoodAllergy",
    "student3NameThai", "student3NameEnglish", "student3FoodAllergy",
  ]) delete oneMember[field];
  assert.equal(competitorUpdateSchema.safeParse({
    ...oneMember,
    expectedUpdatedAt: "2026-08-02T04:00:00.000Z",
    reason: "Removed blank optional members",
  }).success, true);
});
