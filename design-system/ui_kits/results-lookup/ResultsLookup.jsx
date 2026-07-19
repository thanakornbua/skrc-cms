// ResultsLookup screens — SKRC public selection-results page.
// Loaded as text/babel by index.html; exports to window.
const { useState } = React;
const { Button, Input, ResultCard, Badge } = window.SKRCDesignSystem_2809c6;

const lookupShell = {
  minHeight: '100%',
  background: 'var(--color-bg)',
  display: 'flex',
  flexDirection: 'column',
};

function LookupHeader() {
  return (
    <header style={{ background: 'var(--gradient-brand)', padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.85)' }}>
          SUANKULARB ROBOTICS CLUB
        </div>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: '20px' }}>Advanced Competitive Robotics Science</div>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        ผลการคัดเลือก / Results
      </div>
    </header>
  );
}

// fake data store
const RESULTS = {
  'SKRC-2026-0418': {
    status: 'passed',
    studentName: 'ด.ช. ภูมิ ศรีสุข',
    registrationNo: 'SKRC-2026-0418',
    interview: { date: '12 ก.ค. 2569', time: '09:30 น.', room: 'Lab 3 — ห้องปฏิบัติการหุ่นยนต์' },
    bringList: ['บัตรประจำตัวนักเรียน', 'ใบยินยอมผู้ปกครอง (พิมพ์จากลิงก์ด้านล่าง)', 'อุปกรณ์เครื่องเขียน'],
  },
  'SKRC-2026-0571': {
    status: 'rejected',
    studentName: 'ด.ญ. ปาริฉัตร ทองดี',
    registrationNo: 'SKRC-2026-0571',
    resources: [
      { label: 'intro-to-arduino.pdf', href: '#' },
      { label: 'sensor-basics.pdf', href: '#' },
      { label: 'join-next-cohort.html', href: '#' },
    ],
  },
};

function ResultsLookup() {
  const [id, setId] = useState('SKRC-2026-0418');
  const [result, setResult] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const submit = (e) => {
    e && e.preventDefault();
    const r = RESULTS[id.trim().toUpperCase()];
    if (r) { setResult(r); setNotFound(false); }
    else { setResult(null); setNotFound(true); }
  };

  return (
    <div style={lookupShell}>
      <LookupHeader />
      <main style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '48px 24px' }}>
        <div style={{ width: '100%', maxWidth: '480px' }}>
          <div className="skrc-eyebrow skrc-gradient-text" style={{ marginBottom: '8px' }}>ตรวจสอบผล / CHECK YOUR RESULT</div>
          <h1 className="skrc-gradient-text" style={{ fontSize: '30px', fontWeight: 700, marginBottom: '8px' }}>ค้นหาผลการคัดเลือก</h1>
          <p style={{ color: 'var(--color-muted)', marginTop: 0, marginBottom: '24px' }}>
            กรอกเลขประจำตัวสอบเพื่อดูสถานะการคัดเลือกเข้าชุมนุม
          </p>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '32px' }}>
            <Input
              label="เลขประจำตัวสอบ / Student ID"
              mono
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="SKRC-2026-____"
            />
            <div>
              <Button type="submit">ดูผลการคัดเลือก</Button>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-muted-2)' }}>
              ลอง: SKRC-2026-0418 (ผ่าน) · SKRC-2026-0571 (ไม่ผ่าน)
            </div>
          </form>

          {result && (
            <ResultCard
              status={result.status}
              studentName={result.studentName}
              registrationNo={result.registrationNo}
              interview={result.interview}
              bringList={result.bringList}
              resources={result.resources}
              onDownloadConsent={() => {}}
            />
          )}
          {notFound && (
            <div style={{ background: 'var(--color-surface)', borderLeft: '4px solid var(--color-warning)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', padding: '20px 24px' }}>
              <Badge variant="error">ไม่พบข้อมูล</Badge>
              <p style={{ margin: '12px 0 0', color: 'var(--color-text-2)' }}>ไม่พบเลขประจำตัวสอบนี้ กรุณาตรวจสอบอีกครั้ง</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

window.ResultsLookup = ResultsLookup;
