import { useState } from "react";
import BrandHeader from "./BrandHeader";
import NavBar from "./NavBar";
import { t } from "../i18n";

interface PdpaAgreementProps {
  onAccept: () => void;
}

export default function PdpaAgreement({ onAccept }: PdpaAgreementProps) {
  const [consented, setConsented] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  const confirmedCount = Number(consented) + Number(authorized);
  const bothConfirmed = confirmedCount === 2;

  return <div className="page privacy-page">
    <NavBar />
    <BrandHeader
      title="Personal Data Collection Agreement"
      thaiTitle="ข้อตกลงและประกาศการเก็บรวบรวมข้อมูลส่วนบุคคล"
      description="กรุณาอ่านเอกสารนี้ก่อนเริ่มลงทะเบียน / Please read this document before registration"
    />

    <div className="privacy-meta">
      <span className="status-badge">PDPA NOTICE</span>
      <span>{t("ฉบับ", "Version")} <strong className="technical">2026-07-20-v2</strong></span>
      <span>{t("มีผลใช้บังคับ", "Effective")} <strong>20 July 2026</strong></span>
    </div>

    <article className="card privacy-document">
      <section>
        <h2>{t("1. ผู้ควบคุมข้อมูลส่วนบุคคล", "1. Data controller")}</h2>
        <p>{t(
          "โรงเรียนสวนกุหลาบวิทยาลัย โดยชุมนุมหุ่นยนต์สวนกุหลาบ (SKRC) ในฐานะผู้จัดการแข่งขัน เป็นผู้ควบคุมข้อมูลส่วนบุคคลสำหรับการลงทะเบียนและดำเนินการแข่งขันนี้",
          "Suankularb Wittayalai School, acting through the Suankularb Robotics Club (SKRC) as competition organizer, is the data controller for this registration and competition.")}</p>
        <div className="privacy-contact"><strong>{t("ที่อยู่", "Address")}</strong><br />{t("88 ถนนตรีเพชร แขวงวังบูรพาภิรมย์ เขตพระนคร กรุงเทพมหานคร 10200", "88 Triphet Road, Wang Burapha Phirom, Phra Nakhon, Bangkok 10200")}<br /><strong>{t("โทรศัพท์", "Telephone")}:</strong> 02-221-6701, 02-225-5605–8</div>
      </section>

      <section>
        <h2>{t("2. ผู้ที่เอกสารนี้ใช้บังคับ", "2. Who this notice covers")}</h2>
        <p>{t(
          "เอกสารนี้ใช้กับนักเรียนทั้งสามคนในทีม ผู้สมัคร ผู้ใช้อำนาจปกครอง ผู้แทนโดยชอบธรรม และบุคคลติดต่อที่ให้ข้อมูลผ่านระบบนี้ ผู้กรอกแบบฟอร์มต้องแจ้งเนื้อหาในเอกสารนี้ให้สมาชิกทุกคนและผู้ใช้อำนาจปกครองที่เกี่ยวข้องทราบก่อนส่งข้อมูล",
          "This notice covers all three students, the submitter, parents or legal representatives, and the correspondence contact. The submitter must provide this notice to every team member and relevant parent or legal representative before submitting their information.")}</p>
      </section>

      <section>
        <h2>{t("3. ข้อมูลที่เก็บรวบรวม", "3. Personal data collected")}</h2>
        <ul>
          <li><strong>{t("ข้อมูลบัญชี", "Account data")}:</strong> {t("อีเมล รหัสผู้ใช้ Cognito และข้อมูลยืนยันตัวตนของเซสชัน", "email, Cognito user identifier, and session authentication data.")}</li>
          <li><strong>{t("ข้อมูลทีมและนักเรียน", "Team and student data")}:</strong> {t("ชื่อทีม ชื่อ-นามสกุลภาษาไทยและอังกฤษของนักเรียนทั้งสามคน และสถานะหัวหน้าทีม", "team name, Thai and English names of all three students, and team-leader status.")}</li>
          <li><strong>{t("ข้อมูลติดต่อ", "Contact data")}:</strong> {t("อีเมลและหมายเลขโทรศัพท์ของนักเรียนคนที่ 1 ซึ่งเป็นหัวหน้าทีมและผู้ประสานงาน", "email and phone number of Student 1 as team leader and correspondent.")}</li>
          <li><strong>{t("ข้อมูลการแข่งขัน", "Competition data")}:</strong> {t("หมายเลขผู้เข้าแข่งขัน ประเภทการแข่งขัน สถานะการอนุมัติ เช็คอิน ตรวจสภาพ สนาม รอบแข่งขัน เวลาดิบ เวลาปรับ การแก้ไขเวลา การตัดสิทธิ์ อันดับ และบันทึกการดำเนินงาน", "competitor number, category, approval, check-in, inspection, lane, attempts, raw time, penalties, corrections, disqualification, rank, and operational audit records.")}</li>
          <li><strong>{t("หลักฐานความยินยอม", "Consent evidence")}:</strong> {t("รุ่นเอกสาร วันเวลาให้ความยินยอม การยืนยันอำนาจ และกำหนดวันลบ", "notice version, consent timestamp, authority confirmation, and deletion deadline.")}</li>
        </ul>
        <p><strong>{t("ไม่ประสงค์เก็บข้อมูลอ่อนไหว", "No sensitive data requested")}:</strong> {t("กรุณาอย่ากรอกข้อมูลสุขภาพ ศาสนา เชื้อชาติ ความคิดเห็นทางการเมือง ข้อมูลชีวมิติ หรือข้อมูลอ่อนไหวอื่นในช่องข้อความ", "Do not submit health, religion, race, political opinion, biometric, or other sensitive data.")}</p>
      </section>

      <section>
        <h2>{t("4. แหล่งที่มา", "4. Sources")}</h2>
        <p>{t(
          "ข้อมูลมาจากผู้กรอกแบบฟอร์ม เจ้าของข้อมูลหรือผู้แทน เจ้าหน้าที่ที่ดำเนินการแข่งขัน และอุปกรณ์จับเวลาที่ส่งเหตุการณ์เริ่ม จุดตรวจ และหยุด",
          "Data comes from the submitter, data subjects or representatives, authorized competition staff, and timing devices that transmit start, checkpoint, and stop events.")}</p>
      </section>

      <section>
        <h2>{t("5. วัตถุประสงค์และฐานการประมวลผล", "5. Purposes and lawful bases")}</h2>
        <ul>
          <li>{t("สร้างบัญชี รับและตรวจสอบใบสมัคร ติดต่อทีม และยืนยันตัวตน", "create accounts, receive and review applications, contact teams, and verify identity.")}</li>
          <li>{t("เช็คอิน ตรวจสภาพ จัดสนาม จับเวลา บันทึกจุดตรวจ และจัดอันดับตามกติกาของแต่ละรอบ", "check in, inspect, assign lanes, time runs, record checkpoints, and rank under each stage's rules.")}</li>
          <li>{t("จัดการบทลงโทษ การแก้ไขเวลา ข้อโต้แย้ง ความปลอดภัย และหลักฐานตรวจสอบ", "manage penalties, corrections, disputes, security, and audit evidence.")}</li>
          <li>{t("ประกาศชื่อทีมและผลการแข่งขันต่อสาธารณะ", "publish team names and competition results.")}</li>
        </ul>
        <p>{t(
          "การประมวลผลอาศัยความยินยอมเมื่อกฎหมายกำหนด การดำเนินการตามคำขอเข้าร่วมการแข่งขัน ประโยชน์โดยชอบด้วยกฎหมายด้านความปลอดภัยและความถูกต้องของการแข่งขัน และหน้าที่ตามกฎหมายที่ใช้บังคับ ความยินยอมไม่ครอบคลุมวัตถุประสงค์ใหม่ที่ไม่เกี่ยวข้อง",
          "Processing relies on consent where required, steps requested to participate in the competition, legitimate interests in security and competition integrity, and applicable legal obligations. Consent does not cover unrelated new purposes.")}</p>
      </section>

      <section>
        <h2>{t("6. ความจำเป็นและผลหากไม่ให้ข้อมูล", "6. Required data and consequences")}</h2>
        <p>{t(
          "ข้อมูลที่ระบุในแบบฟอร์มเป็นข้อมูลจำเป็นต่อการรับสมัคร การไม่ให้ข้อมูลหรือไม่ยอมรับข้อตกลงจะทำให้ไม่สามารถส่งใบสมัครหรือเข้าร่วมการแข่งขันผ่านระบบนี้ได้ โดยไม่มีการเรียกเก็บเงิน",
          "The form data is required to process participation. If it is not provided, or this agreement is not accepted, registration through this system cannot proceed. No payment is required.")}</p>
      </section>

      <section>
        <h2>{t("7. การเปิดเผยและผู้รับข้อมูล", "7. Disclosure and recipients")}</h2>
        <ul>
          <li>{t("กรรมการและผู้ดูแลระบบที่ได้รับอนุญาตจะเข้าถึงข้อมูลเท่าที่จำเป็นตามหน้าที่", "authorized committee members and administrators on a need-to-know basis.")}</li>
          <li>{t("ผู้ให้บริการโครงสร้างพื้นฐานระบบคลาวด์ การยืนยันตัวตน ฐานข้อมูล และโฮสติ้งในฐานะผู้ประมวลผลข้อมูล", "cloud, authentication, database, and hosting providers acting as processors.")}</li>
          <li>{t("สาธารณะจะเห็นเฉพาะชื่อทีม อันดับ เวลา และผลที่เกี่ยวข้อง ไม่เผยแพร่ชื่อนักเรียน อีเมล หรือโทรศัพท์ในกระดานผล", "the public sees team name, rank, time, and relevant result only; student names, email, and phone are not published on the scoreboard.")}</li>
          <li>{t("หน่วยงานรัฐหรือบุคคลอื่นเมื่อกฎหมาย คำสั่ง หรือการคุ้มครองสิทธิเรียกร้องกำหนด", "authorities or other parties when required by law, order, or legal-claim protection.")}</li>
        </ul>
      </section>

      <section>
        <h2>{t("8. การโอนข้อมูลไปต่างประเทศ", "8. International transfers")}</h2>
        <p>{t(
          "ระบบเลือกใช้บริการในภูมิภาคประเทศไทยเมื่อมีให้บริการ ผู้ให้บริการทางเทคนิคบางรายอาจประมวลผลหรือสนับสนุนระบบจากต่างประเทศ การโอนดังกล่าวจะจำกัดเท่าที่จำเป็นและใช้มาตรการคุ้มครองตามกฎหมายที่เหมาะสม",
          "The system uses Thailand-region services where available. Some technical providers may process or support data from another country; transfers will be limited to what is necessary and protected by appropriate lawful safeguards.")}</p>
      </section>

      <section>
        <h2>{t("9. ระยะเวลาเก็บรักษาและการลบ", "9. Retention and deletion")}</h2>
        <p>{t(
          "ข้อมูลส่วนบุคคลโดยตรง บัญชีผู้ใช้ ข้อมูลติดต่อ และชื่อนักเรียนจะถูกลบหรือทำให้ไม่สามารถระบุตัวบุคคลได้ภายในหกเดือนนับจากวันที่ให้ความยินยอม ระบบจะบันทึกกำหนดวันลบเฉพาะรายการ ชื่อทีมและผลการแข่งขันที่ไม่รวมข้อมูลติดต่ออาจคงไว้เป็นบันทึกผลการแข่งขัน เว้นแต่กฎหมายหรือข้อพิพาทที่ยังไม่สิ้นสุดกำหนดให้เก็บข้อมูลเฉพาะส่วนไว้นานกว่า",
          "Direct identifiers, user accounts, contact details, and student names will be deleted or anonymized within six months of consent, with an item-specific deletion deadline recorded. Team names and results without contact details may remain as competition records unless applicable law or an unresolved dispute requires limited data to be retained longer.")}</p>
      </section>

      <section>
        <h2>{t("10. การรักษาความมั่นคงปลอดภัย", "10. Security")}</h2>
        <p>{t(
          "ผู้จัดใช้การควบคุมสิทธิ์ตามบทบาท การเข้าสู่ระบบ การแยกกุญแจอุปกรณ์ การเข้ารหัสระหว่างส่งข้อมูล บันทึกการดำเนินงาน และการจำกัดข้อมูลสาธารณะ อย่างไรก็ตาม ไม่มีระบบใดรับประกันความปลอดภัยได้ทั้งหมด โปรดแจ้งผู้จัดทันทีหากสงสัยว่าข้อมูลรั่วไหลหรือบัญชีถูกใช้โดยไม่ได้รับอนุญาต",
          "The organizer uses role-based access, authentication, separate device keys, encryption in transit, audit records, and limited public output. No system can guarantee absolute security; report suspected disclosure or account misuse promptly.")}</p>
      </section>

      <section>
        <h2>{t("11. การคำนวณผลโดยอัตโนมัติ", "11. Automated calculation")}</h2>
        <p>{t(
          "ระบบคำนวณเวลารวม เวลาปรับ และอันดับโดยอัตโนมัติตามกติกาแบบใช้เวลาเท่านั้น กรรมการสามารถตรวจสอบรอบที่ผิดปกติ แก้ไขด้วยเหตุผลที่บันทึกไว้ และพิจารณาการตัดสิทธิ์ ไม่มีระบบคะแนนหรือการทำโปรไฟล์เพื่อการตลาด",
          "The system automatically calculates checkpoint/lap progress or time averages by stage, plus penalties and advancement. Staff can review abnormal runs, make reasoned corrections, and decide disqualification. There is no marketing profiling.")}</p>
      </section>

      <section>
        <h2>{t("12. สิทธิของเจ้าของข้อมูล", "12. Data-subject rights")}</h2>
        <p>{t(
          "ภายใต้กฎหมาย เจ้าของข้อมูลอาจขอเข้าถึงและรับสำเนา ขอแก้ไข ขอให้ลบหรือทำลาย ขอจำกัดการใช้ ขอรับหรือโอนข้อมูล คัดค้านการประมวลผล และถอนความยินยอมได้ การถอนความยินยอมไม่กระทบการประมวลผลที่ชอบด้วยกฎหมายก่อนถอน และอาจทำให้ไม่สามารถเข้าร่วมการแข่งขันต่อได้หากข้อมูลจำเป็นต่อการดำเนินงาน",
          "Subject to law, data subjects may request access and copies, correction, erasure or destruction, restriction, portability, objection, and withdrawal of consent. Withdrawal does not affect prior lawful processing and may prevent continued participation where the data remains operationally necessary.")}</p>
        <p>{t(
          "ยื่นคำขอผ่านคณะกรรมการจัดการแข่งขันหรือตามที่อยู่และโทรศัพท์ในข้อ 1 ผู้จัดอาจขอข้อมูลเพื่อยืนยันตัวตนก่อนดำเนินการ เจ้าของข้อมูลมีสิทธิร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล (สคส.)",
          "Submit requests to the competition committee or through the address and telephone in section 1. Identity verification may be required. Data subjects may complain to Thailand’s Personal Data Protection Committee.")}</p>
      </section>

      <section>
        <h2>{t("13. ความยินยอม ผู้เยาว์ และอำนาจ", "13. Consent, minors, and authority")}</h2>
        <p>{t(
          "ความยินยอมต้องให้โดยสมัครใจและถอนง่ายเช่นเดียวกับการให้ หากเจ้าของข้อมูลเป็นผู้เยาว์หรือไม่สามารถให้ความยินยอมได้เอง ผู้ใช้อำนาจปกครองหรือผู้แทนโดยชอบธรรมต้องดำเนินการตามที่กฎหมายกำหนด ผู้ส่งแบบฟอร์มรับรองว่าตนมีอำนาจให้ข้อมูลและยืนยันความยินยอมสำหรับบุคคลที่ระบุ หรือได้รับการอนุญาตที่เหมาะสมจากเจ้าของข้อมูลและผู้แทนที่เกี่ยวข้องแล้ว",
          "Consent must be voluntary and as easy to withdraw as to give. Where a data subject is a minor or cannot consent independently, a parent or legal representative must act as required by law. The submitter confirms authority to provide the listed information and consent, or that appropriate permission has been obtained from each data subject and relevant representative.")}</p>
      </section>

      <section>
        <h2>{t("14. การเปลี่ยนแปลงเอกสาร", "14. Changes")}</h2>
        <p>{t(
          "หากมีการเปลี่ยนวัตถุประสงค์ ประเภทข้อมูล หรือเงื่อนไขสำคัญ ผู้จัดจะแจ้งเอกสารฉบับใหม่และขอความยินยอมใหม่เมื่อจำเป็นตามกฎหมาย รุ่นเอกสารที่ยอมรับจะถูกบันทึกพร้อมใบสมัคร",
          "If purposes, data categories, or material terms change, the organizer will provide a new notice and seek renewed consent where legally required. The accepted version is recorded with the registration.")}</p>
      </section>
    </article>

    <div className="card privacy-acceptance">
      <span className="section-kicker">EXPRESS CONSENT</span>
      <h2>{t("การรับทราบและให้ความยินยอม", "Acknowledgement and consent")}</h2>
      <p className="consent-instruction">{t("แตะเพื่อยืนยันทั้งสองข้อ", "Tap to confirm both statements")} · {confirmedCount}/2</p>
      <label className="consent-check"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /><span>{t(
        "ข้าพเจ้าได้อ่าน เข้าใจ และยินยอมโดยชัดแจ้งต่อการเก็บ ใช้ เปิดเผย เก็บรักษา และลบข้อมูลตามที่ระบุไว้ข้างต้น",
        "I have read and understood this notice and expressly consent to the collection, use, disclosure, retention, and deletion described above.")}</span></label>
      <label className="consent-check"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /><span>{t(
        "ข้าพเจ้ามีอำนาจตามกฎหมายในการส่งข้อมูลของบุคคลที่ระบุ และได้แจ้งบุคคลเหล่านั้นและผู้ปกครองหรือผู้แทนโดยชอบธรรมที่เกี่ยวข้องแล้ว",
        "I am legally authorized to submit the listed persons’ data and have informed them and any required parent or legal representative.")}</span></label>
      <p className="privacy-footnote">{t(
        "การกดปุ่มด้านล่างจะบันทึกรุ่นเอกสารและหลักฐานความยินยอมเมื่อส่งใบสมัคร",
        "Continuing will cause the notice version and consent evidence to be recorded when the registration is submitted.")}</p>
      <button type="button" disabled={!bothConfirmed} onClick={onAccept}>
        {bothConfirmed
          ? t("ยอมรับและเริ่มลงทะเบียน", "Accept and begin registration")
          : t(`ยืนยันอีก ${2 - confirmedCount} ข้อเพื่อดำเนินการต่อ`, `Confirm ${2 - confirmedCount} more to continue`)}
      </button>
    </div>
  </div>;
}
