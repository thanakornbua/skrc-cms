import * as React from 'react';

/**
 * SKRC card surface in four variants.
 *
 * @startingPoint section="Core" subtitle="White, accent, info and code card surfaces" viewport="700x220"
 */
export interface CardProps {
  children: React.ReactNode;
  /** @default "standard" */
  variant?: 'standard' | 'accent' | 'info' | 'code';
  /** Show 4px gradient top bar on the standard variant. @default true */
  accentBar?: boolean;
  style?: React.CSSProperties;
}

export function Card(props: CardProps): JSX.Element;
