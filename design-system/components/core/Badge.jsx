import React from 'react';

/**
 * SKRC badge / tag — pill, uppercase mono, text-xs.
 * Variants: primary (gradient), secondary (surface-2 + violet),
 * success, error.
 */
export function Badge({ children, variant = 'primary', style = {}, ...rest }) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-label)',
    fontSize: 'var(--text-xs)',
    lineHeight: 1,
    padding: '4px 12px',
    borderRadius: 'var(--radius-pill)',
  };

  const variants = {
    primary: { background: 'var(--gradient-brand)', color: '#fff' },
    secondary: { background: 'var(--color-surface-2)', color: '#7c3aed' },
    success: { background: 'var(--color-success-soft)', color: 'var(--color-success)' },
    error: { background: 'var(--color-error-soft)', color: 'var(--color-error)' },
  };

  return (
    <span style={{ ...base, ...variants[variant], ...style }} {...rest}>
      {children}
    </span>
  );
}
