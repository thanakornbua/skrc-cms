import React from 'react';

/**
 * SKRC text input. surface-2 fill, focus shows violet border + purple glow.
 * Set mono for technical values (student IDs, codes).
 */
export function Input({
  label,
  hint,
  mono = false,
  style = {},
  containerStyle = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return (
    <label style={{ display: 'block', ...containerStyle }}>
      {label && (
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-label)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-muted)',
            marginBottom: 'var(--space-2)',
          }}
        >
          {label}
        </span>
      )}
      <input
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: 'var(--color-surface-2)',
          border: `1px solid ${focus ? '#7c3aed' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-sm)',
          padding: '12px 16px',
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          fontSize: 'var(--text-base)',
          color: 'var(--color-text)',
          outline: 'none',
          boxShadow: focus ? '0 0 0 3px rgba(124,58,237,0.15)' : 'none',
          transition: 'border-color .15s ease, box-shadow .15s ease',
          ...style,
        }}
        {...rest}
      />
      {hint && (
        <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--color-muted-2)', marginTop: 'var(--space-2)' }}>
          {hint}
        </span>
      )}
    </label>
  );
}
