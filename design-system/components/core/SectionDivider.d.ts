import * as React from 'react';

/** Full-bleed gradient section divider — Thai over English, uppercase mono. */
export interface SectionDividerProps {
  thai?: string;
  en?: string;
  /** Band height in px. 80 for slides, 48 for web. @default 80 */
  height?: number;
  style?: React.CSSProperties;
}

export function SectionDivider(props: SectionDividerProps): JSX.Element;
