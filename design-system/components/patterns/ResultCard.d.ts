import * as React from 'react';

interface InterviewInfo {
  date: string;
  time: string;
  room: string;
}
interface ResourceLink {
  label: string;
  href: string;
}

/**
 * SKRC selection-result card with passed / rejected states.
 *
 * @startingPoint section="Patterns" subtitle="Pass / fail selection result lookup card" viewport="700x520"
 */
export interface ResultCardProps {
  /** @default "passed" */
  status?: 'passed' | 'rejected';
  studentName: string;
  registrationNo: string;
  /** Interview details — shown only when passed. */
  interview?: InterviewInfo;
  /** Items to bring — shown only when passed. */
  bringList?: string[];
  /** Study resources — shown only when rejected. */
  resources?: ResourceLink[];
  onDownloadConsent?: () => void;
  style?: React.CSSProperties;
}

export function ResultCard(props: ResultCardProps): JSX.Element;
