# Accounting Document Confirmation Flow

```mermaid
flowchart TD
  A[เอกสารผ่าน Intake / Filter] --> B{ประเภทข้อมูล}
  B -->|สลิปโอนเงิน| Q[Accounting Pending Queue]
  Q --> B1[ผู้มีสิทธิ์เปิดตรวจสลิป]
  B1 --> C1[ตรวจผู้โอน ผู้รับ ยอด และหลักฐาน]
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

## Change record

| Version | Date | Rationale | Impact | Migration | Verification | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| v1.0 | 23/8/2569 | ลงทะเบียน flow จริงและคืน error ที่ระบุขั้นตอน หลัง regression ทำให้เหลือข้อความรวม | AccountingDocuments error feedback และ regression contract | ไม่มี | focused test, lint, build และ dialog feedback | คืนข้อความรวมได้โดยไม่เปลี่ยนข้อมูลหรือ RPC |
| v1.1 | 23/8/2569 | ผู้ใช้ไม่เห็นสลิปที่ส่งบัญชี เพราะสลิปยังเป็นงานรอตรวจใน destination task ไม่ใช่ `accounting_documents` | เพิ่ม Accounting Pending Queue แบบอ่านอย่างเดียวจาก `document_flow_destination_tasks` + `document_flow_items` + `financial_transactions`; ไม่รวม/เขียนทับเอกสารที่ยืนยันแล้ว | ตรวจ count จาก Production, typecheck/lint/build และ smoke หน้าเอกสารบัญชี | ถอนส่วนคิวใหม่ได้โดยไม่แตะ raw/task/audit; เอกสารบัญชีเดิมยังใช้ query เดิม |
