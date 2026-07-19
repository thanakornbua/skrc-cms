Selection-result card for the public results lookup page. Two states share one component.

```jsx
<ResultCard
  status="passed"
  studentName="ด.ช. ภูมิ ศรีสุข"
  registrationNo="SKRC-2026-0418"
  interview={{ date: '12 ก.ค. 2569', time: '09:30 น.', room: 'ห้องปฏิบัติการหุ่นยนต์ (Lab 3)' }}
  bringList={['บัตรประจำตัวนักเรียน', 'ใบยินยอมผู้ปกครอง', 'อุปกรณ์เครื่องเขียน']}
  onDownloadConsent={download}
/>

<ResultCard
  status="rejected"
  studentName="ด.ญ. ปาริฉัตร ทองดี"
  registrationNo="SKRC-2026-0571"
  resources={[{ label: 'intro-to-arduino.pdf', href: '#' }, { label: 'sensor-basics.pdf', href: '#' }]}
/>
```

`passed` → green left accent, interview details in a nested accent card, bring list, consent CTA. `rejected` → muted border, resource links, no CTA. Keep the green / muted distinction for state — don't recolor.
