import * as React from 'react';

/**
 * SKRC credential slip — fixed-width printable login slip.
 *
 * @startingPoint section="Patterns" subtitle="Printable / email login credential slip" viewport="700x360"
 */
export interface CredentialSlipProps {
  /** Student name (Thai salutation + name). */
  studentName: string;
  /** Login URL shown in the orange→violet gradient. */
  loginUrl?: string;
  username: string;
  password: string;
  style?: React.CSSProperties;
}

export function CredentialSlip(props: CredentialSlipProps): JSX.Element;
