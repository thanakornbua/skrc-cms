import React from 'react';

/**
 * SKRC result card for the selection-results lookup page.
 * status="passed": green left accent, interview details, bring list, consent CTA.
 * status="rejected": muted border, resource links, no CTA.
 */
export function ResultCard({
  status = 'passed',
  studentName,
  registrationNo,
  interview,        // { date, time, room }
  bringList = [],
  resources = [],   // [{ label, href }]
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
    marginBottom: 'var(--space-2)',
  };

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        borderLeft: `4px solid ${passed ? 'var(--color-success)' : 'var(--color-border)'}`,
        boxShadow: passed ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        padding: 'var(--space-6)',
        maxWidth: '440px',
        ...style,
      }}
      {...rest}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 'var(--text-xl)',
          color: passed ? 'var(--color-success)' : 'var(--color-muted)',
        }}
        className="th"
      >
        {passed ? 'ผ่านการคัดเลือก' : 'ยังไม่ผ่าน'}
        <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 'var(--text-base)' }}>
          {' '}/ {passed ? 'Selected' : 'Not selected'}
        </span>
      </div>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }} className="th">{studentName}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 'var(--space-1)' }}>
          {registrationNo}
        </div>
      </div>

      {passed && interview && (
        <div
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-2)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-4)',
            marginTop: 'var(--space-5)',
          }}
        >
          <div style={labelStyle}>สัมภาษณ์ / Interview</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--color-text)', lineHeight: 1.8 }}>
            <div>{interview.date}</div>
            <div>{interview.time} · {interview.room}</div>
          </div>
        </div>
      )}

      {passed && bringList.length > 0 && (
        <div style={{ marginTop: 'var(--space-5)' }}>
          <div style={labelStyle}>สิ่งที่ต้องเตรียม / Bring</div>
          <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--color-text-2)', fontSize: 'var(--text-sm)', lineHeight: 1.9 }} className="th">
            {bringList.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}

      {!passed && resources.length > 0 && (
        <div style={{ marginTop: 'var(--space-5)' }}>
          <div style={labelStyle}>แหล่งเรียนรู้ / Resources</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {resources.map((r, i) => (
              <a
                key={i}
                href={r.href}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: '#7c3aed', textDecoration: 'none' }}
              >
                → {r.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {passed && (
        <button
          onClick={onDownloadConsent}
          style={{
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
            cursor: 'pointer',
          }}
        >
          ดาวน์โหลดใบยินยอม / Consent PDF
        </button>
      )}
    </div>
  );
}
