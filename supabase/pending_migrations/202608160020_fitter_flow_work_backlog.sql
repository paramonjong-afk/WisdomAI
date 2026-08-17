-- Fitter Flow (Flow 2): deep document validation before accounting approval/posting.

insert into public.system_work_items(
  work_key,scope,title,category,status,progress,risk,detail,production_status,owner,evidence,current_step
) values
('FITTER-001','platform','Fitter Flow Orchestrator และ State Machine','automation','ready',0,'critical',
 'Flow ที่ 2 หลังห้องแรกรับ: รับ Intake ID/reference เดิม ห้าม copy ภาพหรือสร้าง document ซ้ำ; สถานะ received_from_intake→validating→needs_correction/ready_for_accounting→awaiting_approval→posting→posted พร้อม rejected/reversed/failed; ทุก transition มี idempotency, retry, dead-letter และ audit\nเกณฑ์ตรวจรับ: fault/retry/double-click ไม่สร้างปลายทางซ้ำ และ trace state ได้ครบ',
 'backlog_registered','Fitter Flow/Platform','อนุมัติชื่อและ Flow เมื่อ 16/8/2569; รายละเอียด docs/FITTER_FLOW_BACKLOG.md','ออกแบบ canonical state machine และ transition contract'),
('FITTER-002','platform','Fitter Rule Pack ตรวจละเอียดแยกตามประเภทเอกสาร','operations','ready',0,'high',
 'สร้าง rule pack มี version สำหรับใบเสนอราคา, PO, ใบรับสินค้า, ใบส่งของ, ใบวางบิล, invoice, ใบเสร็จ/ภาษี, สาธารณูปโภค, Error และเอกสารอ้างอิง; ตรวจ required fields, page completeness, vendor/company/project และเส้นทางที่อนุญาต\nเกณฑ์ตรวจรับ: test fixture ของทุกประเภทแสดงผล pass/fail/rule/reason ถูกต้องและเปลี่ยน threshold ได้แบบ audit',
 'backlog_registered','Fitter Flow/Document Rules','เกณฑ์เริ่มต้น type confidence >=95%, critical field >=90%','จัดทำ rule matrix และ version schema'),
('FITTER-003','platform','Field Confidence และกระทบยอดตัวเลขการเงิน','audit','ready',0,'critical',
 'เก็บ confidence รายช่อง: ผู้ขาย/เลขภาษี/วันที่/เลขเอกสาร/สินค้า/จำนวน/หน่วย/ราคา/ส่วนลด/VAT/WHT/ยอดสุทธิ; ตรวจสมการและแสดงส่วนต่างภาษาไทย; low-confidence หรือยอดไม่ลงตัวเข้าห้องแก้ไข\nเกณฑ์ตรวจรับ: ชุดทดสอบ VAT รวม/แยก, rounding, WHT, discount และ debit-credit mismatch ให้ผลถูกต้อง',
 'backlog_registered','Fitter Flow/Accounting QA','ห้ามส่งห้องบัญชีถ้าช่องสำคัญหรือสมการไม่ผ่าน','กำหนด field schema, tolerance และ reconciliation engine'),
('FITTER-004','platform','ตรวจเอกสารซ้ำและ Matching เอกสารต้นทาง','operations','ready',0,'critical',
 'ตรวจ SHA-256, perceptual hash และ business key; Match Quotation→PO→Goods Receipt/Delivery Note→Billing Note/Invoice→Receipt ตามผู้ขาย/เลข/วันที่/รายการ/จำนวน/ยอดและ tolerance; ป้องกันเอกสารถูกใช้ซ้ำ\nเกณฑ์ตรวจรับ: exact/near/business duplicate, partial receipt, many-to-one billing และ overbilling tests ผ่าน',
 'backlog_registered','Fitter Flow/Matching','ใช้ physical blob ร่วมได้แต่ต้องรักษา logical intake events','ออกแบบ matching ledger และ duplicate decision states'),
('FITTER-005','platform','โมเดลมุมมองเอกสารทุกมิติใน Fitter Flow','report','ready',0,'high',
 'มิติ: สถานะ, ประเภท, บริษัท, โครงการ/ไซต์/Cost Center/WBS, ผู้ขาย, วันที่/งวด, จำนวนเงิน/ภาษี, หมวดบัญชี/ต้นทุน, matched documents, AI confidence, anomaly, duplicate, ผู้รับผิดชอบ/ผู้อนุมัติ, SLA, ช่องทาง และสถานะ Accounting/AP/Stock/PO/Payment; รองรับ filter/sort/search/saved view/export และ drill-through ถึงภาพ/Timeline\nเกณฑ์ตรวจรับ: จำนวนและยอดจากแต่ละมิติ reconcile กับ source และ tenant/role export policy ผ่าน',
 'backlog_registered','Fitter Flow/UX Analytics','ห้องประเภทและห้องรอบัญชีต้องใช้ dimension model กลางเดียวกัน','ออกแบบ canonical dimension view และ saved views'),
('FITTER-006','platform','ห้องรอแก้ไขและ Human Review','operations','ready',0,'high',
 'แสดงสาเหตุ/ช่องที่ต้องแก้/ภาพทุกหน้า; ขอภาพใหม่, เปลี่ยนประเภท/ผู้ขาย/โครงการ, รวม/แยก/เรียงหน้า; เก็บค่าก่อน-หลัง ผู้แก้ เหตุผล เวลา และส่งกลับ validation\nเกณฑ์ตรวจรับ: แก้แล้ว revalidate ได้โดยไม่สร้าง document ใหม่ และ audit/rollback ครบ',
 'backlog_registered','Fitter Flow/Review UX','รายการไม่ผ่านห้ามหายหรือส่งต่อเงียบ ๆ','ออกแบบ correction task และ revalidation loop'),
('FITTER-007','platform','ห้องรอบันทึกบัญชีและ Approval UX','report','ready',0,'critical',
 'แสดง badge รออนุมัติ—ยังไม่ลงบัญชี; preview ภาพ/OCR/matching/ค่าก่อน-หลัง/journal preview/debit-credit-tax reconciliation; อนุมัติหรือตีกลับพร้อมเหตุผล; disable หลังบันทึกและแสดง mode/status ชัดเจน\nเกณฑ์ตรวจรับ: กดซ้ำ/refresh/concurrent approval ไม่ post ซ้ำ และผู้ไม่มีสิทธิ์อนุมัติไม่ได้',
 'backlog_registered','Fitter Flow/Accounting UX','ห้องนี้เป็น staging approval ไม่ใช่ ledger จริง','ออกแบบ approval snapshot และ optimistic concurrency'),
('FITTER-008','platform','Posting Gateway, Audit และ Monitoring ของ Fitter Flow','automation','ready',0,'critical',
 'หลังอนุมัติเท่านั้นจึง transactionally สร้าง Accounting/AP/Stock/PO ตาม route ด้วย idempotency key; ส่งสถานะ/ลิงก์กลับห้องแรกและห้องประเภท; ก่อน post re-route ได้ หลัง postใช้ correction/reversal; มี retry/dead-letter/SLA/fingerprint/trace ด้วย Intake ID\nเกณฑ์ตรวจรับ: end-to-end ทุก route, rollback, partial failure และ restore test ผ่าน; ไม่มี orphan หรือ duplicate transaction',
 'backlog_registered','Fitter Flow/Integration','แยก classification/validation/approval/posting เป็นคนละขั้นชัดเจน','ออกแบบ posting command contract และ compensation actions')
on conflict(work_key) do update set
  title=excluded.title,
  category=excluded.category,
  risk=excluded.risk,
  detail=excluded.detail,
  owner=excluded.owner,
  evidence=case
    when public.system_work_items.evidence is null or public.system_work_items.evidence='' then excluded.evidence
    when position(excluded.evidence in public.system_work_items.evidence)>0 then public.system_work_items.evidence
    else left(public.system_work_items.evidence||E'\n'||excluded.evidence,4000)
  end,
  current_step=coalesce(public.system_work_items.current_step,excluded.current_step),
  updated_at=now();
