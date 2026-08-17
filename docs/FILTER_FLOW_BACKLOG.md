# Filter Flow — Flow ที่ 2

Filter Flow คือชั้นตรวจสอบเชิงลึกหลังเอกสารถูกคัดแยกจาก Intake Flow แล้ว ทำหน้าที่ตรวจตามกฎเฉพาะประเภท สร้างมุมมองข้อมูลทุกมิติ และส่งเฉพาะเอกสารที่ผ่านเกณฑ์ไปยัง Posting Flow หรือ “ห้องรอบันทึกบัญชี” โดยยังไม่สร้างธุรกรรมบัญชี เจ้าหนี้ Stock หรือ PO จนกว่าผู้ใช้อนุมัติ

## เส้นทางมาตรฐาน

1. รับ `Intake ID` และ reference ไฟล์ชุดเดิมจากห้องแรกรับ ห้ามคัดลอกภาพหรือสร้างเอกสารธุรกิจซ้ำ
2. เปิดห้องตรวจตามประเภทเอกสารและโหลดกฎเฉพาะประเภท
3. ตรวจภาพ/หน้าครบ ความซ้ำ ผู้ขาย บริษัท โครงการ รายการสินค้า จำนวน ราคา ภาษี และสมการยอดเงิน
4. จับคู่เอกสารต้นทางตามประเภท เช่น Quotation/PO/Goods Receipt/Delivery Note/Billing Note/Invoice/Receipt
5. คำนวณ confidence รายช่องและผลรวม พร้อมเหตุผลและ anomaly flags
6. ผ่านเกณฑ์จึงส่งไปห้องรอบันทึกบัญชี; ไม่ผ่านส่งห้องรอแก้ไขหรือขอข้อมูล
7. ห้องรอบันทึกบัญชีแสดงภาพ ข้อมูล OCR เอกสารที่จับคู่ ค่าก่อน-หลังแก้ไข และ Timeline ทุกมิติ
8. ผู้ใช้อนุมัติจึงสร้างธุรกรรมปลายทางแบบ idempotent; การแก้หลัง posting ต้องใช้ correction/reversal

## เกณฑ์ผ่านเริ่มต้น

- ความมั่นใจชนิดเอกสารอย่างน้อย 95%
- ช่องสำคัญแต่ละช่องอย่างน้อย 90%
- ภาพผ่าน Quality Gate และชุดเอกสารครบ
- ไม่ใช่เอกสารซ้ำ หรือกรณีซ้ำได้รับการยืนยันแล้ว
- ระบุบริษัท ผู้ขาย และโครงการตามข้อบังคับของชนิดเอกสาร
- ยอดก่อนภาษี ส่วนลด VAT หัก ณ ที่จ่าย และยอดสุทธิคำนวณลงตัว
- เอกสารที่ต้อง Match ผ่าน tolerance และไม่มีเอกสารถูกใช้ซ้ำ

Threshold ต้องปรับแยกตามชนิดและข้อมูล Production จริงได้ โดยทุกการเปลี่ยนต้องมี version และ audit

## งานย่อย

### FILTER-001 — Orchestrator และ State Machine

สถานะ: received_from_intake, validating, needs_correction, ready_for_accounting, awaiting_approval, posting, posted, rejected, reversed และ failed พร้อม idempotency/retry/dead-letter

### FILTER-002 — Rule Pack เฉพาะประเภท

กฎสำหรับใบเสนอราคา, PO, ใบรับสินค้า, ใบส่งของ, ใบวางบิล, invoice, ใบเสร็จ/ใบกำกับภาษี, สาธารณูปโภค, ภาพ Error และเอกสารอ้างอิง พร้อม version และผลตรวจรายกฎ

หลักฐานงาน: `src/utils/filterRulePack.ts` เป็น rule pack รุ่น 1.0.0 ครบ 10 ประเภท ตรวจ required fields, page completeness, vendor/company/project และ allowed route โดยคืน pass/fail/rule/reason รายกฎ; `scripts/filter-rule-pack.test.ts` มี pass/fail fixture ทุกประเภทและตรวจ threshold revision พร้อม before/after, actor, reason, timestamp โดยไม่แก้ version เดิม

### FILTER-003 — Field Confidence และ Financial Reconciliation

เก็บ confidence รายช่อง ตรวจผู้ขาย/ภาษี/วันที่/เลขเอกสาร/รายการ/จำนวน/หน่วย/ราคา/ส่วนลด/VAT/WHT/ยอดสุทธิ และแสดงค่าที่ไม่ลงตัวเป็นภาษาไทย

### FILTER-004 — Duplicate และ Document Matching

ตรวจ file hash, perceptual hash และ business key; Match Quotation→PO→Goods Receipt/Delivery Note→Billing Note/Invoice→Receipt โดยกำหนด tolerance และป้องกันใช้เอกสารซ้ำ

### FILTER-005 — Dimension Model และมุมมองทุกมิติ

มิติ: สถานะ, ประเภท, บริษัท, โครงการ/ไซต์/Cost Center/WBS, ผู้ขาย, วันที่/งวดบัญชี, จำนวนเงิน/ภาษี, หมวดบัญชี/ต้นทุน, เอกสารที่จับคู่, AI confidence, anomaly, duplicate, ผู้รับผิดชอบ/ผู้อนุมัติ, SLA, ช่องทาง และสถานะบัญชี/AP/Stock/PO/ชำระเงิน

### FILTER-006 — ห้องรอแก้ไขและ Human Review

แสดงสาเหตุ ช่องที่ต้องแก้ ภาพทุกหน้า ขอภาพใหม่ เปลี่ยนประเภท/ผู้ขาย/โครงการ รวม/แยกชุด และบันทึกค่าก่อน-หลัง ผู้แก้ เหตุผล และเวลา

### FILTER-007 — ห้องรอบันทึกบัญชีและ Approval UX

แสดง badge ว่า “รออนุมัติ — ยังไม่ลงบัญชี” พร้อม preview, OCR, matching, journal preview, debit/credit/tax reconciliation, ปุ่มอนุมัติ/ตีกลับ และป้องกันกดซ้ำ

### FILTER-008 — Posting Gateway, Audit และ Monitoring

สร้าง Accounting/AP/Stock/PO เฉพาะหลังอนุมัติด้วย transaction/idempotency key; ส่งผลกลับห้องแรกและห้องประเภท; รองรับ correction/reversal, retry, dead-letter, SLA dashboard และ trace ด้วย Intake ID เดิม

## เกณฑ์ปิด Flow

- Automated tests ครบ happy path, low confidence, duplicate, missing page, mismatch, retry และ double-click
- ทดสอบอย่างน้อย 2 บริษัทและ cross-tenant negative cases
- Production smoke/UAT ครบทุกประเภทหลัก
- Trace จากรูปต้นฉบับถึง transaction และย้อนกลับได้
- ไม่มี posting ก่อนอนุมัติ ไม่มีเอกสาร/Stock/AP ซ้ำ และ debit เท่ากับ credit
