import * as React from 'react';

/** SKRC pill badge / tag — uppercase mono category and status labels. */
export interface BadgeProps {
  children: React.ReactNode;
  /** @default "primary" */
  variant?: 'primary' | 'secondary' | 'success' | 'error';
  style?: React.CSSProperties;
}

export function Badge(props: BadgeProps): JSX.Element;
