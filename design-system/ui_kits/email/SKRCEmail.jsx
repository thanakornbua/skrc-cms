// SKRCEmail — selection-result notification email frame.
const { CredentialSlip, Button } = window.SKRCDesignSystem_2809c6;

function SKRCEmail() {
  return (
    <div style={{ background: 'var(--color-bg)', padding: '24px', minHeight: '100%' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        {/* header band */}
        <div style={{ background: 'var(--gradient-brand)', padding: '28px 32px' }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: '20px', fontFamily: 'var(--font-sans)' }}>Suankularb Robotics Club</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.85)', marginTop: '4px' }}>
            ADVANCED COMPETITIVE ROBOTICS SCIENCE
          </div>
        </div>

        {/* body */}
        <div style={{ padding: '32px' }}>
          <div className="skrc-eyebrow skrc-gradient-text" style={{ marginBottom: '8px' }}>ผลการคัดเลือก / SELECTION RESULT</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 16px' }} className="th">ยินดีด้วย — คุณผ่านการคัดเลือก</h1>
          <p style={{ color: 'var(--color-text-2)', margin: '0 0 12px' }} className="th">
            เรียน ด.ช. ภูมิ ศรีสุข
          </p>
          <p style={{ color: 'var(--color-text-2)', margin: '0 0 24px', lineHeight: 1.7 }} className="th">
            คุณได้รับคัดเลือกเข้าร่วมหลักสูตร Advanced Competitive Robotics Science
            ของชุมนุมหุ่นยนต์สวนกุหลาบ ด้านล่างนี้คือข้อมูลเข้าสู่ระบบสำหรับเตรียมตัวสัมภาษณ์
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
            <CredentialSlip
              studentName="ด.ช. ภูมิ ศรีสุข"
              loginUrl="skr.ac.th/robotics/login"
              username="skrc.s0418"
              password="m0t0r-7x9-Qk"
            />
          </div>

          <div style={{ textAlign: 'center' }}>
            <Button>เข้าสู่ระบบ / Log in</Button>
          </div>
        </div>

        {/* footer band */}
        <div style={{ background: 'var(--color-surface-2)', borderTop: '1px solid var(--color-border)', padding: '20px 32px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-muted)', lineHeight: 1.7 }}>
            Suankularb Robotics Club · โรงเรียนสวนกุหลาบวิทยาลัย<br />
            อีเมลนี้ส่งอัตโนมัติ · กรุณาอย่าตอบกลับ
          </div>
        </div>
      </div>
    </div>
  );
}

window.SKRCEmail = SKRCEmail;
