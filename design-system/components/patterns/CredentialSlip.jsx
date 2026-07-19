import React from 'react';

/**
 * SKRC credential slip — printed login slip / email block.
 * Fixed 280px width, designed to be cut. Gradient top bar, mono code fields.
 */
export function CredentialSlip({
  studentName,
  loginUrl = 'skr.ac.th/robotics/login',
  username,
  password,
  style = {},
  ...rest
}) {
  const fieldLabel = {
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-label)',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-muted)',
    marginBottom: 'var(--space-2)',
  };
  const codeField = {
    background: 'var(--code-bg)',
    color: 'var(--code-text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-base)',
    letterSpacing: '0.02em',
    padding: '10px 14px',
    borderRadius: 'var(--radius-sm)',
  };

  return (
    <div
      style={{
        width: '280px',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
        ...style,
      }}
      {...rest}
    >
      <div style={{ height: '6px', background: 'var(--gradient-brand)' }} />
      <div style={{ padding: 'var(--space-5)' }}>
        <div
          className="skrc-eyebrow skrc-gradient-text"
          style={{ marginBottom: 'var(--space-2)' }}
        >
          SKRC · ROBOTICS CLUB
        </div>
        <div style={{ fontFamily: 'var(--font-thai)', fontWeight: 700, fontSize: 'var(--text-xl)', color: 'var(--color-text)' }}>
          {studentName}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            marginTop: 'var(--space-1)',
            marginBottom: 'var(--space-5)',
            background: 'linear-gradient(135deg, #f59e0b, #7c3aed)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {loginUrl}
        </div>

        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={fieldLabel}>Username</div>
          <div style={codeField}>{username}</div>
        </div>
        <div>
          <div style={fieldLabel}>Password</div>
          <div style={codeField}>{password}</div>
        </div>
      </div>
    </div>
  );
}
