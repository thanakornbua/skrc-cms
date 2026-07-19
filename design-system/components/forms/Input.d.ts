import * as React from 'react';

/** SKRC text input with mono-label and focus glow. */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Uppercase mono field label rendered above the input. */
  label?: string;
  /** Helper text below the input. */
  hint?: string;
  /** Render the value in IBM Plex Mono — use for IDs, codes, usernames. @default false */
  mono?: boolean;
  containerStyle?: React.CSSProperties;
}

export function Input(props: InputProps): JSX.Element;
