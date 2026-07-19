import React from 'react';

/**
 * SKRC card surface. Variants:
 *  - standard: white, border, shadow-md, optional gradient top accent bar
 *  - accent: surface-2 fill, purple border, shadow-sm
 *  - info: white, 4px gradient LEFT border, shadow-sm
 *  - code: dark #1a1a2e, mono, gradient top border
 */
export function Card({
  children,
  variant = 'standard',
  accentBar = true,
  style = {},
  ...rest
}) {
  const base = {
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-6)',
    position: 'relative',
  };

  let v = {};
  if (variant === 'standard') {
    v = {
      background: 'var(--gradient-brand) top left/100% 4px no-repeat, var(--color-surface)',
      border: accentBar ? 'none' : '1px solid var(--color-border)',
      boxShadow: 'var(--shadow-md)',
    };
    if (!accentBar) v.background = 'var(--color-surface)';
  } else if (variant === 'accent') {
    v = {
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-border-2)',
      boxShadow: 'var(--shadow-sm)',
    };
  } else if (variant === 'info') {
    v = {
      background: 'var(--gradient-brand) left top/4px 100% no-repeat, var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderLeft: 'none',
      boxShadow: 'var(--shadow-sm)',
    };
  } else if (variant === 'code') {
    v = {
      background: 'var(--gradient-brand) top left/100% 4px no-repeat, var(--code-bg)',
      color: 'var(--code-text)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      lineHeight: 'var(--leading-mono)',
      padding: 'var(--space-6) var(--space-5) var(--space-5)',
      boxShadow: 'var(--shadow-md)',
    };
  }

  return (
    <div style={{ ...base, ...v, ...style }} {...rest}>
      {children}
    </div>
  );
}
