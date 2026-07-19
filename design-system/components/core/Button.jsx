import React from 'react';

/**
 * SKRC primary action button. Pill shape, IBM Plex Mono uppercase.
 * Variants: primary (gradient fill), secondary (gradient border + text),
 * ghost (text only). Sizes: sm, md.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
  type = 'button',
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);

  const pad = size === 'sm' ? '8px 20px' : '12px 28px';
  const fontSize = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)';

  const base = {
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-button)',
    fontSize,
    padding: pad,
    borderRadius: 'var(--radius-pill)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    pointerEvents: disabled ? 'none' : 'auto',
    transition: 'box-shadow .15s ease, filter .15s ease, transform .08s ease',
    transform: active ? 'scale(0.98)' : 'scale(1)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    lineHeight: 1,
    border: 'none',
  };

  let variantStyle = {};
  if (variant === 'primary') {
    variantStyle = {
      background: 'var(--gradient-brand)',
      color: '#fff',
      boxShadow: hover ? 'var(--shadow-lg)' : 'var(--shadow-md)',
      filter: hover ? 'brightness(1.05)' : 'none',
    };
  } else if (variant === 'secondary') {
    variantStyle = {
      background: 'var(--color-surface)',
      border: '2px solid transparent',
      backgroundImage:
        'linear-gradient(var(--color-surface), var(--color-surface)), var(--gradient-brand)',
      backgroundOrigin: 'border-box',
      backgroundClip: 'padding-box, border-box',
      color: 'transparent',
      WebkitBackgroundClip: 'text, border-box',
      boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
    };
    // gradient text needs its own layered approach; render text span below
  } else if (variant === 'ghost') {
    variantStyle = {
      background: 'transparent',
      color: 'transparent',
      textDecoration: hover ? 'underline' : 'none',
    };
  }

  // For secondary + ghost, text must use the gradient via a clipped span.
  const gradientText = {
    background: 'var(--gradient-brand)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
  };

  const label =
    variant === 'primary'
      ? children
      : <span style={gradientText}>{children}</span>;

  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{ ...base, ...variantStyle, ...style }}
      {...rest}
    >
      {label}
    </button>
  );
}
