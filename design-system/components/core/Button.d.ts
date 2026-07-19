import * as React from 'react';

/**
 * SKRC primary action button — pill shape, IBM Plex Mono uppercase.
 *
 * @startingPoint section="Core" subtitle="Pill action buttons in three variants" viewport="700x150"
 */
export interface ButtonProps {
  children: React.ReactNode;
  /** Visual variant. @default "primary" */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** @default "md" */
  size?: 'sm' | 'md';
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  style?: React.CSSProperties;
}

export function Button(props: ButtonProps): JSX.Element;
