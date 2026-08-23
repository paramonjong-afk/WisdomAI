# Accounting Document Confirmation Flow

```mermaid
flowchart TD
  A[เอกสารผ่าน Intake / Filter] --> B{ประเภทข้อมูล}
  B -->|สลิปโอนเงิน| Q[Accounting Pending Queue]
  Q --> Q0[Tab สลิปโอนเงินและตัวกรองสถานะ]
  Q0 --> B1[Drawer แท็บ 1 รูปต้นฉบับและ AI อ่านใหม่เฉพาะรายการ]
  B1 --> B2[Drawer แท็บ 2 ตรวจและแก้ค่ารายช่อง]
  B2 --> B3{Admin ตัดสินใจ}
  B3 -->|Draft| QD[ค้างบัญชีพร้อม before after และ Audit]
  B3 -->|ขอข้อมูลเพิ่ม| QI[Accounting task recheck required]
  B3 -->|ยืนยัน| C1[ตรวจผู้โอน ผู้รับ ยอด และหลักฐานครบ]
  C1 -->|ไม่ชัด/ซ้ำ| Q1[ค้างตรวจพร้อมเหตุผลและ Audit]
  C1 -->|ผ่าน| C[ตรวจชนิดและวัตถุประสงค์]
  B -->|เอกสารบัญชีอื่น| C
  C --> D[บันทึกประเภทเอกสาร]
  D -->|ไม่ผ่าน| D1[แจ้ง Error: ขั้นตอนบันทึกประเภท]
  D -->|ผ่าน| E[บันทึกโครงการ ไซต์ หมวดต้นทุน บัญชี และรายการ]
  E -->|ไม่ผ่าน| E1[แจ้ง Error: ขั้นตอนบันทึกโครงการ/บัญชี]
  E -->|ผ่าน| F{ยืนยันเอกสารหรือไม่}
  F -->|ยังไม่ยืนยัน| G[เก็บ Draft พร้อม Audit]
  F -->|ยืนยัน| H[สร้างรายการบัญชี / Stock / AP ตามชนิด]
  H -->|ไม่ผ่าน| H1[แจ้ง Error: ขั้นตอนยืนยันและสร้างรายการ]
  H -->|ผ่าน| I[ปิดสถานะตรวจและแสดงผลสำเร็จ]
  D1 --> C
  E1 --> C
  H1 --> C
```

## คำอธิบาย

- Input: เอกสารบัญชีที่ผ่าน Intake/Filter, ชนิดเอกสาร, ผู้ขาย, รายการสินค้า, โครงการ/ไซต์, หมวดต้นทุนและบัญชี
- Output: Draft ที่แก้ต่อได้ หรือเอกสารยืนยันที่สร้าง Accounting/Stock/AP ตามชนิด โดยไม่ posting ซ้ำ
- State: `pending/needs_correction` → draft หรือ `confirmed`; เอกสารยืนยันแล้วแก้ชนิดได้เฉพาะ correction path ที่มี Audit
- Roles/permissions: เฉพาะ company `admin/manager` ที่ผ่าน RLS/RPC guard; tenant/company จาก active company เท่านั้น
- Integrations: `classify_accounting_document`, `save_accounting_document_classification`, `confirm_accounting_document`, purchase/stock/AP RPC และ Mutation Attempt Center
- Failure/retry: ต้องบอกขั้นตอนที่ล้มเหลวชัดเจนใกล้ปุ่มดำเนินการ; retry ใช้ document เดิมและ RPC idempotency/constraint ป้องกันรายการซ้ำ
- Audit: ทุก mutation ผ่าน `runWithMutationAttempt`; correction/confirmation เก็บผู้ทำ เวลา เหตุผล และ document id
- Owner: Accounting Admin/Manager; ทีมระบบเป็นเจ้าของ RPC, validation และ error contract
- Accounting Pending Queue แยก `สลิปโอนเงิน` ออกจาก `เอกสารบัญชีทั่วไป`; ยอดสลิปหลักไม่นับ duplicate, system/context หรือ non-slip และตัวกรองทุกตัวใช้รายการ projection ชุดเดียวกัน
- Drawer ของสลิปอ่านไฟล์จาก Source Contract กลางและ Timeline จาก `document_flow_events`; ไม่คัดลอกไฟล์ ไม่สร้าง destination task ใหม่ และไม่แก้ raw source
- Drawer แบ่ง 2 แท็บ: รูปต้นฉบับ/AI และตรวจแก้ข้อมูล; AI อ่านซ้ำด้วย `item_id` เดียวเท่านั้นและรักษา Flow บัญชีเดิม ส่วน Admin บันทึกผ่าน `review_transfer_slip_details` ซึ่งตรวจสิทธิ์/ข้อมูลบังคับและเขียน before/after Audit แบบ idempotent
- Failure/retry: AI ล้มเหลวไม่แก้ routing และกดลองใหม่รายการเดิมได้; draft/ขอข้อมูลเพิ่มทำให้ Accounting task เป็น `recheck_required`; ยืนยันไม่ได้หากชื่อผู้โอน ผู้รับ ยอด หรือวันเวลาไม่ครบ
- ปลายทางแรกของสลิปยังเป็นบัญชีเสมอ ส่วนป้าย `เบิกล่วงหน้า`/`ค่าแรง` แสดงเส้นทางต่อเมื่อมี evidence ใน candidate department หรือข้อมูลธุรกรรมเท่านั้น

## Change record

| Version | Date | Rationale | Impact | Migration | Verification | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| v1.0 | 23/8/2569 | ลงทะเบียน flow จริงและคืน error ที่ระบุขั้นตอน หลัง regression ทำให้เหลือข้อความรวม | AccountingDocuments error feedback และ regression contract | ไม่มี | focused test, lint, build และ dialog feedback | คืนข้อความรวมได้โดยไม่เปลี่ยนข้อมูลหรือ RPC |
| v1.1 | 23/8/2569 | ผู้ใช้ไม่เห็นสลิปที่ส่งบัญชี เพราะสลิปยังเป็นงานรอตรวจใน destination task ไม่ใช่ `accounting_documents` | เพิ่ม Accounting Pending Queue แบบอ่านอย่างเดียวจาก `document_flow_destination_tasks` + `document_flow_items` + `financial_transactions`; ไม่รวม/เขียนทับเอกสารที่ยืนยันแล้ว | ตรวจ count จาก Production, typecheck/lint/build และ smoke หน้าเอกสารบัญชี | ถอนส่วนคิวใหม่ได้โดยไม่แตะ raw/task/audit; เอกสารบัญชีเดิมยังใช้ query เดิม |
| v1.2 | 23/8/2569 | แยกคิวสลิปให้ทีมบัญชีเห็นหลักฐาน สถานะ และงานต่อเนื่องโดยไม่ปะปนเอกสารทั่วไป | เพิ่ม Tab สลิป/เอกสารทั่วไป, count และ filter กลาง, คอลัมน์ธุรกรรม/Source/ปลายทาง, Drawer รูปจริงและ Audit; query เดิมยังเป็น read-only | ไม่มี | contract test, typecheck, lint, build, Local และ Production authenticated smoke | ถอน Tab/Drawer/helper ได้โดยไม่แตะ raw, task, transaction หรือ audit |
| v1.2.1 | 23/8/2569 | Production smoke พบชื่อคอลัมน์ duplicate ใน query ไม่ตรง schema จริง | เปลี่ยน projection เป็น `financial_transactions.duplicate_of` ทำให้ข้อมูลธุรกรรมและ count แสดงตามข้อมูลจริง | ไม่มี | authenticated Production smoke ต้องไม่มี schema alert และ count duplicate ต้องตรงรายการ | คืน query ก่อนหน้าได้แต่จะทำให้รายละเอียดสลิปโหลดไม่สำเร็จ จึงควร rollback ทั้ง v1.2 แทน |
| v1.3 | 23/8/2569 | ให้ทีมบัญชีแก้ค่าที่ AI อ่านไม่ได้และสั่งอ่านใหม่จากรูปเดียวกันโดยไม่หลุด Flow | Drawer 2 แท็บ, single-item AI reread, manual draft/confirm/request info และ before/after Audit | `20260823110613_transfer_slip_drawer_review.sql`; deploy `reprocess-transfer-slips` | review contract, queue test, typecheck, lint, build และ authenticated page smoke | ซ่อน action/UI, ถอน EXECUTE RPC และ rollback Edge Function; raw source/task/audit เดิมไม่ถูกลบ |
