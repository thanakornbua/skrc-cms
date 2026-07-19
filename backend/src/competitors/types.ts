export type CompetitorStatus = "REGISTERED" | "CHECKED_IN" | "INSPECTED" | "RUN_COMPLETE";

export interface DisqualifiedInfo {
  bool: boolean;
  reason: string | null;
  byUser: string | null;
  at: string | null;
}

export interface CompetitorRecord {
  competitorId: string;
  name: string;
  teamName: string;
  category: string;
  contactEmail: string;
  contactPhone: string;
  student1NameThai: string;
  student1NameEnglish: string;
  student2NameThai: string;
  student2NameEnglish: string;
  student3NameThai: string;
  student3NameEnglish: string;
  pdpaConsent: {
    accepted: true;
    version: string;
    at: string;
    retentionMonths: 6;
    deleteBy: string;
    authorityConfirmed: true;
    language: "th-en";
  };
  cognitoSub: string;
  status: CompetitorStatus;
  disqualified: DisqualifiedInfo;
  checkedInAt: string | null;
  inspectedAt: string | null;
  createdAt: string;
}
