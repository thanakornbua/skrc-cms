/* @ds-bundle: {"format":4,"namespace":"SKRCDesignSystem_2809c6","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"SectionDivider","sourcePath":"components/core/SectionDivider.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"CredentialSlip","sourcePath":"components/patterns/CredentialSlip.jsx"},{"name":"ResultCard","sourcePath":"components/patterns/ResultCard.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"4ce76d70d4b0","components/core/Button.jsx":"b3d2e3716f0f","components/core/Card.jsx":"c9e512e6216a","components/core/SectionDivider.jsx":"4204583291d5","components/forms/Input.jsx":"26a1051a1c52","components/patterns/CredentialSlip.jsx":"aa2fa4596681","components/patterns/ResultCard.jsx":"d8a1f3430628","ui_kits/email/SKRCEmail.jsx":"41c03f555e74","ui_kits/interview-timer/InterviewTimer.jsx":"10f3f7b62de8","ui_kits/results-lookup/ResultsLookup.jsx":"38176407b61f"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.SKRCDesignSystem_2809c6 = window.SKRCDesignSystem_2809c6 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * SKRC badge / tag — pill, uppercase mono, text-xs.
 * Variants: primary (gradient), secondary (surface-2 + violet),
 * success, error.
 */
function Badge({
  children,
  variant = 'primary',
  style = {},
  ...rest
}) {
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
    borderRadius: 'var(--radius-pill)'
  };
  const variants = {
    primary: {
      background: 'var(--gradient-brand)',
      color: '#fff'
    },
    secondary: {
      background: 'var(--color-surface-2)',
      color: '#7c3aed'
    },
    success: {
      background: 'var(--color-success-soft)',
      color: 'var(--color-success)'
    },
    error: {
      background: 'var(--color-error-soft)',
      color: 'var(--color-error)'
    }
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      ...base,
      ...variants[variant],
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * SKRC primary action button. Pill shape, IBM Plex Mono uppercase.
 * Variants: primary (gradient fill), secondary (gradient border + text),
 * ghost (text only). Sizes: sm, md.
 */
function Button({
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
    border: 'none'
  };
  let variantStyle = {};
  if (variant === 'primary') {
    variantStyle = {
      background: 'var(--gradient-brand)',
      color: '#fff',
      boxShadow: hover ? 'var(--shadow-lg)' : 'var(--shadow-md)',
      filter: hover ? 'brightness(1.05)' : 'none'
    };
  } else if (variant === 'secondary') {
    variantStyle = {
      background: 'var(--color-surface)',
      border: '2px solid transparent',
      backgroundImage: 'linear-gradient(var(--color-surface), var(--color-surface)), var(--gradient-brand)',
      backgroundOrigin: 'border-box',
      backgroundClip: 'padding-box, border-box',
      color: 'transparent',
      WebkitBackgroundClip: 'text, border-box',
      boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)'
    };
    // gradient text needs its own layered approach; render text span below
  } else if (variant === 'ghost') {
    variantStyle = {
      background: 'transparent',
      color: 'transparent',
      textDecoration: hover ? 'underline' : 'none'
    };
  }

  // For secondary + ghost, text must use the gradient via a clipped span.
  const gradientText = {
    background: 'var(--gradient-brand)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    WebkitTextFillColor: 'transparent'
  };
  const label = variant === 'primary' ? children : /*#__PURE__*/React.createElement("span", {
    style: gradientText
  }, children);
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    onClick: disabled ? undefined : onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    style: {
      ...base,
      ...variantStyle,
      ...style
    }
  }, rest), label);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * SKRC card surface. Variants:
 *  - standard: white, border, shadow-md, optional gradient top accent bar
 *  - accent: surface-2 fill, purple border, shadow-sm
 *  - info: white, 4px gradient LEFT border, shadow-sm
 *  - code: dark #1a1a2e, mono, gradient top border
 */
function Card({
  children,
  variant = 'standard',
  accentBar = true,
  style = {},
  ...rest
}) {
  const base = {
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-6)',
    position: 'relative'
  };
  let v = {};
  if (variant === 'standard') {
    v = {
      background: 'var(--gradient-brand) top left/100% 4px no-repeat, var(--color-surface)',
      border: accentBar ? 'none' : '1px solid var(--color-border)',
      boxShadow: 'var(--shadow-md)'
    };
    if (!accentBar) v.background = 'var(--color-surface)';
  } else if (variant === 'accent') {
    v = {
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-border-2)',
      boxShadow: 'var(--shadow-sm)'
    };
  } else if (variant === 'info') {
    v = {
      background: 'var(--gradient-brand) left top/4px 100% no-repeat, var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderLeft: 'none',
      boxShadow: 'var(--shadow-sm)'
    };
  } else if (variant === 'code') {
    v = {
      background: 'var(--gradient-brand) top left/100% 4px no-repeat, var(--code-bg)',
      color: 'var(--code-text)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      lineHeight: 'var(--leading-mono)',
      padding: 'var(--space-6) var(--space-5) var(--space-5)',
      boxShadow: 'var(--shadow-md)'
    };
  }
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      ...base,
      ...v,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/SectionDivider.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Full-bleed gradient section divider (slide + web).
 * Thai line above, English line below, uppercase mono, centered.
 */
function SectionDivider({
  thai,
  en,
  height,
  style = {},
  ...rest
}) {
  const h = height || 80;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
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
      ...style
    }
  }, rest), thai && /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontSize: 'var(--text-base)'
    },
    className: "th"
  }, thai), en && /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 400,
      fontSize: 'var(--text-sm)',
      opacity: 0.9
    }
  }, en));
}
Object.assign(__ds_scope, { SectionDivider });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/SectionDivider.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * SKRC text input. surface-2 fill, focus shows violet border + purple glow.
 * Set mono for technical values (student IDs, codes).
 */
function Input({
  label,
  hint,
  mono = false,
  style = {},
  containerStyle = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'block',
      ...containerStyle
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontFamily: 'var(--font-mono)',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-label)',
      fontSize: 'var(--text-xs)',
      color: 'var(--color-muted)',
      marginBottom: 'var(--space-2)'
    }
  }, label), /*#__PURE__*/React.createElement("input", _extends({
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
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
      ...style
    }
  }, rest)), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontSize: 'var(--text-sm)',
      color: 'var(--color-muted-2)',
      marginTop: 'var(--space-2)'
    }
  }, hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/patterns/CredentialSlip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * SKRC credential slip — printed login slip / email block.
 * Fixed 280px width, designed to be cut. Gradient top bar, mono code fields.
 */
function CredentialSlip({
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
    marginBottom: 'var(--space-2)'
  };
  const codeField = {
    background: 'var(--code-bg)',
    color: 'var(--code-text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-base)',
    letterSpacing: '0.02em',
    padding: '10px 14px',
    borderRadius: 'var(--radius-sm)'
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      width: '280px',
      background: 'var(--color-surface)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      overflow: 'hidden',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      height: '6px',
      background: 'var(--gradient-brand)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "skrc-eyebrow skrc-gradient-text",
    style: {
      marginBottom: 'var(--space-2)'
    }
  }, "SKRC \xB7 ROBOTICS CLUB"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-thai)',
      fontWeight: 700,
      fontSize: 'var(--text-xl)',
      color: 'var(--color-text)'
    }
  }, studentName), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      marginTop: 'var(--space-1)',
      marginBottom: 'var(--space-5)',
      background: 'linear-gradient(135deg, #f59e0b, #7c3aed)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextFillColor: 'transparent'
    }
  }, loginUrl), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: fieldLabel
  }, "Username"), /*#__PURE__*/React.createElement("div", {
    style: codeField
  }, username)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: fieldLabel
  }, "Password"), /*#__PURE__*/React.createElement("div", {
    style: codeField
  }, password))));
}
Object.assign(__ds_scope, { CredentialSlip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/patterns/CredentialSlip.jsx", error: String((e && e.message) || e) }); }

// components/patterns/ResultCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * SKRC result card for the selection-results lookup page.
 * status="passed": green left accent, interview details, bring list, consent CTA.
 * status="rejected": muted border, resource links, no CTA.
 */
function ResultCard({
  status = 'passed',
  studentName,
  registrationNo,
  interview,
  // { date, time, room }
  bringList = [],
  resources = [],
  // [{ label, href }]
  onDownloadConsent,
  style = {},
  ...rest
}) {
  const passed = status === 'passed';
  const labelStyle = {
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-label)',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-muted)',
    marginBottom: 'var(--space-2)'
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--color-surface)',
      borderRadius: 'var(--radius-md)',
      borderLeft: `4px solid ${passed ? 'var(--color-success)' : 'var(--color-border)'}`,
      boxShadow: passed ? 'var(--shadow-md)' : 'var(--shadow-sm)',
      padding: 'var(--space-6)',
      maxWidth: '440px',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 'var(--text-xl)',
      color: passed ? 'var(--color-success)' : 'var(--color-muted)'
    },
    className: "th"
  }, passed ? 'ผ่านการคัดเลือก' : 'ยังไม่ผ่าน', /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontWeight: 600,
      fontSize: 'var(--text-base)'
    }
  }, ' ', "/ ", passed ? 'Selected' : 'Not selected')), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-lg)',
      fontWeight: 600
    },
    className: "th"
  }, studentName), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      color: 'var(--color-muted)',
      marginTop: 'var(--space-1)'
    }
  }, registrationNo)), passed && interview && /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-border-2)',
      borderRadius: 'var(--radius-sm)',
      padding: 'var(--space-4)',
      marginTop: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: labelStyle
  }, "\u0E2A\u0E31\u0E21\u0E20\u0E32\u0E29\u0E13\u0E4C / Interview"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      color: 'var(--color-text)',
      lineHeight: 1.8
    }
  }, /*#__PURE__*/React.createElement("div", null, interview.date), /*#__PURE__*/React.createElement("div", null, interview.time, " \xB7 ", interview.room))), passed && bringList.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: labelStyle
  }, "\u0E2A\u0E34\u0E48\u0E07\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21 / Bring"), /*#__PURE__*/React.createElement("ul", {
    style: {
      margin: 0,
      paddingLeft: '18px',
      color: 'var(--color-text-2)',
      fontSize: 'var(--text-sm)',
      lineHeight: 1.9
    },
    className: "th"
  }, bringList.map((item, i) => /*#__PURE__*/React.createElement("li", {
    key: i
  }, item)))), !passed && resources.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: labelStyle
  }, "\u0E41\u0E2B\u0E25\u0E48\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49 / Resources"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)'
    }
  }, resources.map((r, i) => /*#__PURE__*/React.createElement("a", {
    key: i,
    href: r.href,
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      color: '#7c3aed',
      textDecoration: 'none'
    }
  }, "\u2192 ", r.label)))), passed && /*#__PURE__*/React.createElement("button", {
    onClick: onDownloadConsent,
    style: {
      marginTop: 'var(--space-6)',
      background: 'var(--gradient-brand)',
      color: '#fff',
      border: 'none',
      fontFamily: 'var(--font-mono)',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-button)',
      fontSize: 'var(--text-sm)',
      padding: '12px 28px',
      borderRadius: 'var(--radius-pill)',
      boxShadow: 'var(--shadow-md)',
      cursor: 'pointer'
    }
  }, "\u0E14\u0E32\u0E27\u0E19\u0E4C\u0E42\u0E2B\u0E25\u0E14\u0E43\u0E1A\u0E22\u0E34\u0E19\u0E22\u0E2D\u0E21 / Consent PDF"));
}
Object.assign(__ds_scope, { ResultCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/patterns/ResultCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/email/SKRCEmail.jsx
try { (() => {
// SKRCEmail — selection-result notification email frame.
const {
  CredentialSlip,
  Button
} = window.SKRCDesignSystem_2809c6;
function SKRCEmail() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-bg)',
      padding: '24px',
      minHeight: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: '600px',
      margin: '0 auto',
      background: 'var(--color-surface)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-lg)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--gradient-brand)',
      padding: '28px 32px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#fff',
      fontWeight: 700,
      fontSize: '20px',
      fontFamily: 'var(--font-sans)'
    }
  }, "Suankularb Robotics Club"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      color: 'rgba(255,255,255,0.85)',
      marginTop: '4px'
    }
  }, "ADVANCED COMPETITIVE ROBOTICS SCIENCE")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '32px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "skrc-eyebrow skrc-gradient-text",
    style: {
      marginBottom: '8px'
    }
  }, "\u0E1C\u0E25\u0E01\u0E32\u0E23\u0E04\u0E31\u0E14\u0E40\u0E25\u0E37\u0E2D\u0E01 / SELECTION RESULT"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: '24px',
      fontWeight: 700,
      color: 'var(--color-text)',
      margin: '0 0 16px'
    },
    className: "th"
  }, "\u0E22\u0E34\u0E19\u0E14\u0E35\u0E14\u0E49\u0E27\u0E22 \u2014 \u0E04\u0E38\u0E13\u0E1C\u0E48\u0E32\u0E19\u0E01\u0E32\u0E23\u0E04\u0E31\u0E14\u0E40\u0E25\u0E37\u0E2D\u0E01"), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--color-text-2)',
      margin: '0 0 12px'
    },
    className: "th"
  }, "\u0E40\u0E23\u0E35\u0E22\u0E19 \u0E14.\u0E0A. \u0E20\u0E39\u0E21\u0E34 \u0E28\u0E23\u0E35\u0E2A\u0E38\u0E02"), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--color-text-2)',
      margin: '0 0 24px',
      lineHeight: 1.7
    },
    className: "th"
  }, "\u0E04\u0E38\u0E13\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E04\u0E31\u0E14\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E40\u0E02\u0E49\u0E32\u0E23\u0E48\u0E27\u0E21\u0E2B\u0E25\u0E31\u0E01\u0E2A\u0E39\u0E15\u0E23 Advanced Competitive Robotics Science \u0E02\u0E2D\u0E07\u0E0A\u0E38\u0E21\u0E19\u0E38\u0E21\u0E2B\u0E38\u0E48\u0E19\u0E22\u0E19\u0E15\u0E4C\u0E2A\u0E27\u0E19\u0E01\u0E38\u0E2B\u0E25\u0E32\u0E1A \u0E14\u0E49\u0E32\u0E19\u0E25\u0E48\u0E32\u0E07\u0E19\u0E35\u0E49\u0E04\u0E37\u0E2D\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E15\u0E31\u0E27\u0E2A\u0E31\u0E21\u0E20\u0E32\u0E29\u0E13\u0E4C"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'center',
      marginBottom: '24px'
    }
  }, /*#__PURE__*/React.createElement(CredentialSlip, {
    studentName: "\u0E14.\u0E0A. \u0E20\u0E39\u0E21\u0E34 \u0E28\u0E23\u0E35\u0E2A\u0E38\u0E02",
    loginUrl: "skr.ac.th/robotics/login",
    username: "skrc.s0418",
    password: "m0t0r-7x9-Qk"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement(Button, null, "\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A / Log in"))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-surface-2)',
      borderTop: '1px solid var(--color-border)',
      padding: '20px 32px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      color: 'var(--color-muted)',
      lineHeight: 1.7
    }
  }, "Suankularb Robotics Club \xB7 \u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E2A\u0E27\u0E19\u0E01\u0E38\u0E2B\u0E25\u0E32\u0E1A\u0E27\u0E34\u0E17\u0E22\u0E32\u0E25\u0E31\u0E22", /*#__PURE__*/React.createElement("br", null), "\u0E2D\u0E35\u0E40\u0E21\u0E25\u0E19\u0E35\u0E49\u0E2A\u0E48\u0E07\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34 \xB7 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E2D\u0E22\u0E48\u0E32\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A"))));
}
window.SKRCEmail = SKRCEmail;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/email/SKRCEmail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/interview-timer/InterviewTimer.jsx
try { (() => {
// InterviewTimer — SKRC interview-day countdown dashboard.
const {
  useState,
  useEffect
} = React;
const {
  Badge
} = window.SKRCDesignSystem_2809c6;
const SCHEDULE = [{
  no: 'SKRC-2026-0411',
  name: 'ด.ช. กฤตเมธ วงศ์ใหญ่',
  time: '09:00',
  state: 'past'
}, {
  no: 'SKRC-2026-0418',
  name: 'ด.ช. ภูมิ ศรีสุข',
  time: '09:30',
  state: 'current'
}, {
  no: 'SKRC-2026-0426',
  name: 'ด.ญ. ณิชา พัฒนกุล',
  time: '10:00',
  state: 'next'
}, {
  no: 'SKRC-2026-0433',
  name: 'ด.ช. ปุณณวิช อินทรา',
  time: '10:30',
  state: 'upcoming'
}, {
  no: 'SKRC-2026-0440',
  name: 'ด.ญ. ศุภิสรา ทองคำ',
  time: '11:00',
  state: 'upcoming'
}];
function fmt(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
}
function InterviewTimer() {
  const [sec, setSec] = useState(7 * 60 + 42);
  useEffect(() => {
    const t = setInterval(() => setSec(s => s > 0 ? s - 1 : 0), 1000);
    return () => clearInterval(t);
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100%',
      background: 'var(--color-bg)',
      padding: '32px 40px',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: '24px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "skrc-eyebrow skrc-gradient-text"
  }, "INTERVIEW DAY \xB7 12 \u0E01.\u0E04. 2569"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: '24px',
      fontWeight: 700,
      color: 'var(--color-text)',
      margin: '4px 0 0'
    }
  }, "\u0E15\u0E32\u0E23\u0E32\u0E07\u0E2A\u0E31\u0E21\u0E20\u0E32\u0E29\u0E13\u0E4C \xB7 Lab 3")), /*#__PURE__*/React.createElement(Badge, null, "Live")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr',
      gap: '24px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--gradient-brand) top left/100% 8px no-repeat, var(--color-surface)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-lg)',
      padding: '40px 32px 32px',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "skrc-eyebrow",
    style: {
      color: 'var(--color-muted)'
    }
  }, "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E31\u0E21\u0E20\u0E32\u0E29\u0E13\u0E4C / NOW"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '24px',
      fontWeight: 700,
      margin: '8px 0 2px'
    },
    className: "th"
  }, "\u0E14.\u0E0A. \u0E20\u0E39\u0E21\u0E34 \u0E28\u0E23\u0E35\u0E2A\u0E38\u0E02"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '14px',
      color: 'var(--color-muted)'
    }
  }, "SKRC-2026-0418"), /*#__PURE__*/React.createElement("div", {
    className: "skrc-gradient-text",
    style: {
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      fontSize: '64px',
      lineHeight: 1.1,
      margin: '16px 0 4px',
      letterSpacing: '0.02em'
    }
  }, fmt(sec)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      color: 'var(--color-muted-2)'
    }
  }, "\u0E40\u0E27\u0E25\u0E32\u0E17\u0E35\u0E48\u0E40\u0E2B\u0E25\u0E37\u0E2D / time remaining")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-surface-2)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-sm)',
      border: '1px solid var(--color-border-2)',
      padding: '24px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "skrc-eyebrow",
    style: {
      color: 'var(--color-muted)'
    }
  }, "\u0E16\u0E31\u0E14\u0E44\u0E1B / NEXT"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '18px',
      fontWeight: 600,
      margin: '8px 0 2px'
    },
    className: "th"
  }, "\u0E14.\u0E0D. \u0E13\u0E34\u0E0A\u0E32 \u0E1E\u0E31\u0E12\u0E19\u0E01\u0E38\u0E25"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '13px',
      color: 'var(--color-muted)'
    }
  }, "SKRC-2026-0426 \xB7 10:00 \u0E19."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '16px',
      borderTop: '1px solid var(--color-border)',
      paddingTop: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "skrc-eyebrow",
    style: {
      color: 'var(--color-muted)',
      marginBottom: '10px'
    }
  }, "\u0E04\u0E34\u0E27\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14 / QUEUE"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    }
  }, SCHEDULE.map(row => /*#__PURE__*/React.createElement("div", {
    key: row.no,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '8px 12px',
      borderRadius: 'var(--radius-sm)',
      background: row.state === 'current' ? 'var(--gradient-brand) left top/4px 100% no-repeat, var(--color-surface)' : 'transparent',
      boxShadow: row.state === 'current' ? 'var(--shadow-sm)' : 'none',
      opacity: row.state === 'past' ? 0.4 : 1,
      fontFamily: 'var(--font-mono)',
      fontSize: '12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--color-muted)',
      width: '42px'
    }
  }, row.time), /*#__PURE__*/React.createElement("span", {
    className: "th",
    style: {
      fontFamily: 'var(--font-thai)',
      flex: 1,
      color: 'var(--color-text)'
    }
  }, row.name), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--color-muted-2)'
    }
  }, row.no.slice(-4)))))))));
}
window.InterviewTimer = InterviewTimer;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/interview-timer/InterviewTimer.jsx", error: String((e && e.message) || e) }); }

// ui_kits/results-lookup/ResultsLookup.jsx
try { (() => {
// ResultsLookup screens — SKRC public selection-results page.
// Loaded as text/babel by index.html; exports to window.
const {
  useState
} = React;
const {
  Button,
  Input,
  ResultCard,
  Badge
} = window.SKRCDesignSystem_2809c6;
const lookupShell = {
  minHeight: '100%',
  background: 'var(--color-bg)',
  display: 'flex',
  flexDirection: 'column'
};
function LookupHeader() {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      background: 'var(--gradient-brand)',
      padding: '20px 32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      color: 'rgba(255,255,255,0.85)'
    }
  }, "SUANKULARB ROBOTICS CLUB"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#fff',
      fontWeight: 700,
      fontSize: '20px'
    }
  }, "Advanced Competitive Robotics Science")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      color: 'rgba(255,255,255,0.9)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    }
  }, "\u0E1C\u0E25\u0E01\u0E32\u0E23\u0E04\u0E31\u0E14\u0E40\u0E25\u0E37\u0E2D\u0E01 / Results"));
}

// fake data store
const RESULTS = {
  'SKRC-2026-0418': {
    status: 'passed',
    studentName: 'ด.ช. ภูมิ ศรีสุข',
    registrationNo: 'SKRC-2026-0418',
    interview: {
      date: '12 ก.ค. 2569',
      time: '09:30 น.',
      room: 'Lab 3 — ห้องปฏิบัติการหุ่นยนต์'
    },
    bringList: ['บัตรประจำตัวนักเรียน', 'ใบยินยอมผู้ปกครอง (พิมพ์จากลิงก์ด้านล่าง)', 'อุปกรณ์เครื่องเขียน']
  },
  'SKRC-2026-0571': {
    status: 'rejected',
    studentName: 'ด.ญ. ปาริฉัตร ทองดี',
    registrationNo: 'SKRC-2026-0571',
    resources: [{
      label: 'intro-to-arduino.pdf',
      href: '#'
    }, {
      label: 'sensor-basics.pdf',
      href: '#'
    }, {
      label: 'join-next-cohort.html',
      href: '#'
    }]
  }
};
function ResultsLookup() {
  const [id, setId] = useState('SKRC-2026-0418');
  const [result, setResult] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const submit = e => {
    e && e.preventDefault();
    const r = RESULTS[id.trim().toUpperCase()];
    if (r) {
      setResult(r);
      setNotFound(false);
    } else {
      setResult(null);
      setNotFound(true);
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    style: lookupShell
  }, /*#__PURE__*/React.createElement(LookupHeader, null), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      display: 'flex',
      justifyContent: 'center',
      padding: '48px 24px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      maxWidth: '480px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "skrc-eyebrow skrc-gradient-text",
    style: {
      marginBottom: '8px'
    }
  }, "\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E1C\u0E25 / CHECK YOUR RESULT"), /*#__PURE__*/React.createElement("h1", {
    className: "skrc-gradient-text",
    style: {
      fontSize: '30px',
      fontWeight: 700,
      marginBottom: '8px'
    }
  }, "\u0E04\u0E49\u0E19\u0E2B\u0E32\u0E1C\u0E25\u0E01\u0E32\u0E23\u0E04\u0E31\u0E14\u0E40\u0E25\u0E37\u0E2D\u0E01"), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--color-muted)',
      marginTop: 0,
      marginBottom: '24px'
    }
  }, "\u0E01\u0E23\u0E2D\u0E01\u0E40\u0E25\u0E02\u0E1B\u0E23\u0E30\u0E08\u0E33\u0E15\u0E31\u0E27\u0E2A\u0E2D\u0E1A\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E14\u0E39\u0E2A\u0E16\u0E32\u0E19\u0E30\u0E01\u0E32\u0E23\u0E04\u0E31\u0E14\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E40\u0E02\u0E49\u0E32\u0E0A\u0E38\u0E21\u0E19\u0E38\u0E21"), /*#__PURE__*/React.createElement("form", {
    onSubmit: submit,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      marginBottom: '32px'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "\u0E40\u0E25\u0E02\u0E1B\u0E23\u0E30\u0E08\u0E33\u0E15\u0E31\u0E27\u0E2A\u0E2D\u0E1A / Student ID",
    mono: true,
    value: id,
    onChange: e => setId(e.target.value),
    placeholder: "SKRC-2026-____"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Button, {
    type: "submit"
  }, "\u0E14\u0E39\u0E1C\u0E25\u0E01\u0E32\u0E23\u0E04\u0E31\u0E14\u0E40\u0E25\u0E37\u0E2D\u0E01")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      color: 'var(--color-muted-2)'
    }
  }, "\u0E25\u0E2D\u0E07: SKRC-2026-0418 (\u0E1C\u0E48\u0E32\u0E19) \xB7 SKRC-2026-0571 (\u0E44\u0E21\u0E48\u0E1C\u0E48\u0E32\u0E19)")), result && /*#__PURE__*/React.createElement(ResultCard, {
    status: result.status,
    studentName: result.studentName,
    registrationNo: result.registrationNo,
    interview: result.interview,
    bringList: result.bringList,
    resources: result.resources,
    onDownloadConsent: () => {}
  }), notFound && /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-surface)',
      borderLeft: '4px solid var(--color-warning)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-sm)',
      padding: '20px 24px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "error"
  }, "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '12px 0 0',
      color: 'var(--color-text-2)'
    }
  }, "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E40\u0E25\u0E02\u0E1B\u0E23\u0E30\u0E08\u0E33\u0E15\u0E31\u0E27\u0E2A\u0E2D\u0E1A\u0E19\u0E35\u0E49 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07")))));
}
window.ResultsLookup = ResultsLookup;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/results-lookup/ResultsLookup.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.SectionDivider = __ds_scope.SectionDivider;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.CredentialSlip = __ds_scope.CredentialSlip;

__ds_ns.ResultCard = __ds_scope.ResultCard;

})();
