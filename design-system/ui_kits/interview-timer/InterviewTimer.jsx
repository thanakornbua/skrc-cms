// InterviewTimer — SKRC interview-day countdown dashboard.
const { useState, useEffect } = React;
const { Badge } = window.SKRCDesignSystem_2809c6;

const SCHEDULE = [
  { no: 'SKRC-2026-0411', name: 'ด.ช. กฤตเมธ วงศ์ใหญ่', time: '09:00', state: 'past' },
  { no: 'SKRC-2026-0418', name: 'ด.ช. ภูมิ ศรีสุข', time: '09:30', state: 'current' },
  { no: 'SKRC-2026-0426', name: 'ด.ญ. ณิชา พัฒนกุล', time: '10:00', state: 'next' },
  { no: 'SKRC-2026-0433', name: 'ด.ช. ปุณณวิช อินทรา', time: '10:30', state: 'upcoming' },
  { no: 'SKRC-2026-0440', name: 'ด.ญ. ศุภิสรา ทองคำ', time: '11:00', state: 'upcoming' },
];

function fmt(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
}

function InterviewTimer() {
  const [sec, setSec] = useState(7 * 60 + 42);
  useEffect(() => {
    const t = setInterval(() => setSec((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ minHeight: '100%', background: 'var(--color-bg)', padding: '32px 40px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '24px' }}>
        <div>
          <div className="skrc-eyebrow skrc-gradient-text">INTERVIEW DAY · 12 ก.ค. 2569</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text)', margin: '4px 0 0' }}>ตารางสัมภาษณ์ · Lab 3</h1>
        </div>
        <Badge>Live</Badge>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '24px', alignItems: 'start' }}>
        {/* current candidate + countdown */}
        <div style={{ background: 'var(--gradient-brand) top left/100% 8px no-repeat, var(--color-surface)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: '40px 32px 32px', textAlign: 'center' }}>
          <div className="skrc-eyebrow" style={{ color: 'var(--color-muted)' }}>กำลังสัมภาษณ์ / NOW</div>
          <div style={{ fontSize: '24px', fontWeight: 700, margin: '8px 0 2px' }} className="th">ด.ช. ภูมิ ศรีสุข</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--color-muted)' }}>SKRC-2026-0418</div>
          <div className="skrc-gradient-text" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '64px', lineHeight: 1.1, margin: '16px 0 4px', letterSpacing: '0.02em' }}>
            {fmt(sec)}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-muted-2)' }}>เวลาที่เหลือ / time remaining</div>
        </div>

        {/* next candidate */}
        <div style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--color-border-2)', padding: '24px' }}>
          <div className="skrc-eyebrow" style={{ color: 'var(--color-muted)' }}>ถัดไป / NEXT</div>
          <div style={{ fontSize: '18px', fontWeight: 600, margin: '8px 0 2px' }} className="th">ด.ญ. ณิชา พัฒนกุล</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--color-muted)' }}>SKRC-2026-0426 · 10:00 น.</div>
          <div style={{ marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
            <div className="skrc-eyebrow" style={{ color: 'var(--color-muted)', marginBottom: '10px' }}>คิวทั้งหมด / QUEUE</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {SCHEDULE.map((row) => (
                <div
                  key={row.no}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                    background: row.state === 'current'
                      ? 'var(--gradient-brand) left top/4px 100% no-repeat, var(--color-surface)'
                      : 'transparent',
                    boxShadow: row.state === 'current' ? 'var(--shadow-sm)' : 'none',
                    opacity: row.state === 'past' ? 0.4 : 1,
                    fontFamily: 'var(--font-mono)', fontSize: '12px',
                  }}
                >
                  <span style={{ color: 'var(--color-muted)', width: '42px' }}>{row.time}</span>
                  <span className="th" style={{ fontFamily: 'var(--font-thai)', flex: 1, color: 'var(--color-text)' }}>{row.name}</span>
                  <span style={{ color: 'var(--color-muted-2)' }}>{row.no.slice(-4)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.InterviewTimer = InterviewTimer;
