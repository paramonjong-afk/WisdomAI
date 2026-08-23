```mermaid
flowchart TD
  A[Web Chat raw message / System summary] --> G0[HR Intake Raw Ledger\nstatus pending]
  G0 --> G1{Intake classification}
  G1 -->|System / Daily summary| G2[Context only]
  G1 -->|Duplicate| G3[Duplicate link]
  G1 -->|Already confirmed| G4[Link existing bundle]
  G1 -->|Not HR / Low confidence| G5[Review queue]
  G1 -->|Complete HR facts| G6[HR Confirmation Candidate]
  G6 --> B[Existing attendance approval job]
  B --> C[Bundle key\ncompany + employee + Bangkok date + project]
  C --> D[Attach source item idempotently]
  D --> E[Central validation]
  E --> E1[Employee name and company]
  E --> E2[Project/site consistency]
  E --> E3[Clock-in/out pair and time order]
  E --> E4[Duplicate and conflict]
  E --> E5[Required location/selfie/source]
  E --> F{Complete and conflict-free?}
  F -->|No| G[Needs more information]
  F -->|Yes| H[Pending approval]
  H --> I[One system confirmation message per bundle]
  I --> J{Manager / HR action}
  J -->|Confirm| K[Approve child jobs in time order]
  J -->|Request more| G
  J -->|Reject with reason| L[Cancelled]
  K --> M{All attendance writes succeeded?}
  M -->|No| N[Keep job open + error/audit + retry]
  M -->|Yes| O[Recorded]
  O --> P{Attendance and audit complete?}
  P -->|Yes| Q[Closed 100%]
  P -->|No| N
  G --> R[Return to source owner]
  N --> R
  C --> S[(Bundle / Item / Event ledger)]
  D --> S
  E --> S
  J --> S
  K --> S
  Q --> S
```

# HR Confirmation Bundle Flow

## Purpose

รวมข้อความลงเวลาเข้า/ออกและสรุป HR ที่เกี่ยวข้องให้เป็นงานเดียวตาม `บริษัท + ช่าง + วันที่ทำงานเขตเวลา Asia/Bangkok + โครงการ` เพื่อไม่ให้ผู้อนุมัติเห็นรายการเดี่ยวปะปน และยัง trace กลับไปยัง Web Chat, request code, room, approval job, attendance session และผู้ดำเนินการทุกขั้นได้

ก่อนสร้าง Candidate ทุกข้อความต้องผ่าน **HR Intake Gate** และถูกเก็บ Raw แบบแก้ย้อนหลังไม่ได้ก่อนเสมอ หน้าจอแสดง count ก่อนคัดเทียบกับ candidate หลังคัด พร้อมเหตุผลของรายการที่ถูกแยกออก โดย Raw ไม่ถูกลบ

## HR Intake Gate

- `pending`: รับ Raw แล้ว ยังไม่ตีความเป็นงาน
- `context`: System Confirmation และ Daily Summary เป็นบริบท ไม่สร้างงานใหม่
- `duplicate`: source/content ซ้ำและมี `duplicate_of_id`
- `already_confirmed`: ผูกกับ bundle/job ที่ยืนยันแล้ว ไม่สร้างซ้ำ
- `not_hr`: ไม่เกี่ยว HR รอผู้รับผิดชอบตรวจ
- `low_confidence`: ความมั่นใจต่ำกว่ากติกา รอตรวจ
- `candidate`: มี employee, work date, project, clock action, request code และ source reference ครบ
- `needs_more_info`, `rejected`, `confirmed`: ผล Action ขอข้อมูล/ปฏิเสธ/ยืนยัน Candidate

Gate บันทึก `raw_message_id`, channel, room, source reference, content snapshot, extracted payload, confidence, reason, duplicate link, approval job/bundle link และ event audit ทุก transition โดย unique `(company_id, source_channel, source_ref)` ป้องกันรับ Raw หรือสร้าง Candidate ซ้ำ

## Inputs and outputs

- **Input:** `chat_attendance_approval_jobs`, ผู้ส่ง/โปรไฟล์, `clock_in|clock_out`, เวลา, site/project, request code, room/message, GPS, Selfie และ validation เดิม
- **Output:** `hr_confirmation_bundles`, `hr_confirmation_bundle_items`, `hr_confirmation_bundle_events`, attendance session ที่ผ่าน approval และ System Confirmation หนึ่งข้อความต่อ bundle
- System MSG เป็น projection สำหรับยืนยัน/แจ้งผู้รับผิดชอบเท่านั้น ไม่ใช่ source ใหม่ และ `message_class=system_confirmation` ต้องถูกตัดออกจาก Omni Intake

## States

| State | ความหมาย | ทางออกที่อนุญาต |
| --- | --- | --- |
| `received` | รับ source item แล้ว | `under_review`, `needs_more_info`, `cancelled` |
| `under_review` | ตรวจ validation กลาง | `needs_more_info`, `pending_approval`, `cancelled` |
| `needs_more_info` | ข้อมูลไม่ครบ/ขัดแย้ง | กลับ `under_review` หลังมีข้อมูลเพิ่ม หรือ `cancelled` |
| `pending_approval` | ผ่าน validation รอผู้รับผิดชอบ | `approved`, `needs_more_info`, `cancelled` |
| `approved` | ผู้มีสิทธิ์ยืนยันแล้ว | `recorded`; ถ้าเขียนล้มเหลวคงเปิดงานและบันทึก error |
| `recorded` | child jobs ทุกตัวบันทึก attendance สำเร็จ | `closed` |
| `closed` | attendance และ audit gate ครบ 100% | terminal |
| `cancelled` | ปฏิเสธพร้อมเหตุผล | terminal; ไม่สร้าง attendance เพิ่ม |

## Validation contract

1. โปรไฟล์ช่างมีชื่อและเป็นสมาชิกบริษัทเดียวกับ bundle
2. source items ทุกตัวเป็นช่าง วัน และโครงการเดียวกัน
3. ต้องมี clock-in และ clock-out อย่างละหนึ่งรายการสำหรับการปิดชุดปกติ
4. `clock_in < clock_out`; เวลาเท่ากันหรือกลับลำดับเป็น conflict
5. request code/job/session ต้องไม่ซ้ำ และ child job ที่มี `duplicate_of_job_id` ถือเป็น conflict
6. site ต้องอยู่ใน project/company เดียวกัน; ข้อมูล GPS/Selfie และ missing fields ใช้กติกา approval เดิม
7. การกดซ้ำใช้ `bundle_key`, unique child `job_id` และ action idempotency key เดิม จึงคืนผลเดิมโดยไม่เขียน attendance หรือ System MSG ซ้ำ

## Roles and permissions

- Employee เห็น bundle ของตนเองและ source/audit ที่ตนเกี่ยวข้อง แต่แก้ ledger โดยตรงไม่ได้
- Company manager/admin/HR เห็น bundle ในบริษัทและใช้ RPC Action เท่านั้น
- `anon` ไม่มี SELECT/EXECUTE; authenticated ถูกตรวจ `current_company_id()` และ `is_company_manager()` ภายใน RLS/RPC
- Tables เปิด RLS และ revoke direct insert/update/delete จาก client; backend functions ใช้ `SECURITY DEFINER` พร้อม auth/company guard และ fixed `search_path`

## Actions

- **ยืนยัน:** ตรวจ validation ซ้ำและ approve child jobs ตามเวลา; เปลี่ยนเป็น `recorded` เฉพาะเมื่อ attendance write ครบ
- **ขอข้อมูลเพิ่ม:** ต้องมีเหตุผล ส่งกลับ source owner และคง bundle เปิด
- **ปฏิเสธ:** ต้องมีเหตุผล เปลี่ยนเป็น `cancelled`; child jobs ที่ยังไม่บันทึกถูก reject
- **ปิด Job 100%:** ทำได้เฉพาะ `recorded`, child attendance ครบ, ไม่มี duplicate/conflict/missing fields และ audit events ครบ

## Integrations, failures and retries

- ใช้ approval RPC เดิมเป็นจุดเขียน attendance เพื่อไม่สร้างกติกาค่าแรงชุดที่สอง
- ถ้า child job ตัวใดล้มเหลว transaction ต้อง rollback ทั้ง action; bundle ไม่อ้างว่า recorded และ event เก็บ error/retry context
- System Confirmation ใช้ unique bundle/message projection; trigger เดิมแบบหนึ่งข้อความต่อ job ถูกแทนด้วย bundle projection
- Legacy open jobs ถูก reconcile ผ่าน function เดียวกันโดยไม่แก้ attendance ที่บันทึกแล้ว

## Audit events

ขั้นต่ำฝั่ง Gate: `raw_received`, `intake_classified`, `candidate_confirmed`, `more_information_required`, `intake_rejected` และฝั่ง Bundle: `bundle_received`, `validation_completed`, `approval_requested`, `approval_granted`, `child_attendance_recorded`, `bundle_recorded`, `bundle_rejected`, `bundle_closed_100_percent`, `action_failed`, `confirmation_sent|confirmation_failed` พร้อม actor, source, from/to state, idempotency key และ details

## Owner

- Workflow owner: HR / Company Admin
- Technical owner: WisdomAI platform

## Change record

| Version | Date | Rationale | Impact | Migration | Verification | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| v1.0 | 23/8/2569 | เพิ่ม Intake Gate เก็บ Raw pending ก่อนคัด และรวม attendance/HR summary เป็นชุดต่อช่าง/วัน/โครงการ | Raw/gate audit + Bundle ledger, child mapping, approval RPC, System Confirmation projection และ HR queue | `20260823060547_hr_confirmation_bundle.sql` local-only; ห้าม Production จนผ่าน local runtime/UAT และอนุมัติ | Local fixture เห็น Raw จำนวนมากเหลือเฉพาะ candidate, normal/missing/duplicate/conflict/reject/idempotency/RLS, typecheck/lint/build, Cloudflare ภายหลัง | ปิด gate/bundle trigger/RPC/UI และคืน individual confirmation projection; เก็บ Raw/ledger/audit และ attendance เดิม ห้ามลบ |
