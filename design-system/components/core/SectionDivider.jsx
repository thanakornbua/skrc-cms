import React from 'react';

/**
 * Full-bleed gradient section divider (slide + web).
 * Thai line above, English line below, uppercase mono, centered.
 */
export function SectionDivider({ thai, en, height, style = {}, ...rest }) {
  const h = height || 80;
  return (
    <div
      style={{
        background: 'var(--gradient-brand)',
        height: `${h}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        color: '#fff',
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-label)',
        textAlign: 'center',
        ...style,
      }}
      {...rest}
    >
      {thai && (
        <span style={{ fontWeight: 600, fontSize: 'var(--text-base)' }} className="th">
          {thai}
        </span>
      )}
      {en && (
        <span style={{ fontWeight: 400, fontSize: 'var(--text-sm)', opacity: 0.9 }}>
          {en}
        </span>
      )}
    </div>
  );
}
