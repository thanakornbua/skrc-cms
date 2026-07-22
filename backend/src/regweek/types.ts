export const CATEGORIES = ["Line Tracing - Open"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface RejectionInfo {
  reason: string;
  byUser: string;
  at: string;
}

export interface ApprovalInfo {
  byUser: string;
  at: string;
  competitorId: string;
}

export type RegistrationStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export interface PdpaConsent {
  accepted: true;
  version: string;
  at: string;
  retentionMonths: 6;
  deleteBy: string;
  authorityConfirmed: true;
  language: "th-en";
}

export interface StudentNames {
  student1NameThai: string;
  student1NameEnglish: string;
  student2NameThai: string;
  student2NameEnglish: string;
  student3NameThai: string;
  student3NameEnglish: string;
}

export interface RegistrationRecord extends StudentNames {
  sub: string;
  name: string;
  teamName: string;
  category: Category;
  contactEmail: string;
  contactPhone: string;
  pdpaConsent: PdpaConsent;
  status: RegistrationStatus;
  rejection: RejectionInfo | null;
  approval: ApprovalInfo | null;
  createdAt: string;
}

export type CompetitorStatus = "REGISTERED" | "CHECKED_IN" | "INSPECTED" | "RUN_COMPLETE";

export interface DisqualifiedInfo {
  bool: boolean;
  reason: string | null;
  byUser: string | null;
  at: string | null;
}

export interface CompetitorRecord extends StudentNames {
  competitorId: string;
  name: string;
  teamName: string;
  category: Category;
  contactEmail: string;
  contactPhone: string;
  pdpaConsent: PdpaConsent;
  cognitoSub: string;
  status: CompetitorStatus;
  disqualified: DisqualifiedInfo;
  checkedInAt: string | null;
  inspectedAt: string | null;
  createdAt: string;
}
