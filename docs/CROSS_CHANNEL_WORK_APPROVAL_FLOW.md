```mermaid
flowchart LR
  A[Work item enters review + awaiting_approval] --> B[Approval request RPC]
  B --> C[(One pending approval record)]
  B --> D[Web Chat system confirmation]
  B --> E[Telegram Admin notification]
  D --> F{Admin or manager decides}
  E --> F
  F --> G[Idempotent decision RPC]
  G --> H{Still pending and item still review?}
  H -->|yes| I[Approve -> ready or Reject -> blocked]
  H -->|no| J[Return already_decided]
  I --> K[Audit decision channel, actor, reason, time]
  I --> L[Web Chat result message]
  G --> M[Retry-safe error / no duplicate decision]
```

# Cross-Channel Work Approval Flow

## Purpose

ให้คำขออนุมัติงานจากศูนย์สั่งงานใช้คำขอเดียวกันระหว่าง Web Chat และ Telegram ไม่สร้าง approval ซ้ำ และไม่เปิดทางให้การกดจากช่องทางที่สองย้อนผลการตัดสินใจเดิม

## Inputs and outputs

- Input: `system_work_items` ที่อยู่ `review` และมี `production_status` ระบุว่ารออนุมัติ
- Output: approval record เดียว, การ์ด Web Chat, ปุ่ม Telegram, สถานะงานใหม่ และ audit ที่ระบุช่องทาง
- Source work item, detail, evidence และประวัติเดิมไม่ถูกเขียนทับโดยการสร้างคำขอ

## States and actions

- Approval: `pending` -> `approved` หรือ `rejected`
- Work item: `review` -> `ready` เมื่ออนุมัติ หรือ `blocked` เมื่อไม่อนุมัติ
- การตัดสินใจครั้งที่สองเป็น no-op และคืน `already_decided` พร้อมช่องทางเดิม

## Roles and permissions

- Admin ใช้กับงานระดับ platform (`company_id` เป็น null)
- Company manager ใช้กับงานของบริษัทตนเอง
- Web Chat ใช้ session ผู้ใช้; Telegram ใช้ Edge Function ที่ตรวจบัญชี Admin ที่ผูกไว้
- RLS อนุญาตให้อ่าน approval เฉพาะ Admin/Manager และห้าม client insert/update/delete ตรง

## Integrations

- Database trigger/request RPC สร้างคำขอและ broadcast ไปห้องงานมาตรฐาน
- Health Monitor ส่ง Telegram ตาม rate limit เมื่อพบงานรออนุมัติ
- `telegram-admin` และ Web Chat เรียก `decide_system_work_item_approval` ตัวเดียวกัน

## Failure and retry

- การส่งข้อความล้มเหลวไม่ทำลาย approval record; รอบถัดไปตรวจ pending และ retry ตาม rate limit
- unique partial index กัน pending ซ้ำ
- row lock และเงื่อนไขสถานะกัน race ระหว่าง Telegram/Web Chat
- หากงานไม่อยู่ `review` หรือ approval ถูกตัดสินใจแล้ว จะไม่เปลี่ยนสถานะซ้ำ

## Audit and owner

Approval เก็บผู้ขอ เวลา ผู้ตัดสินใจ ช่องทาง เหตุผล และสถานะ; การเปลี่ยน `system_work_items` ใช้ evidence/current_step เดิมและ trigger audit ของงานกลาง ระบบทีมเป็นเจ้าของ flow ส่วน Admin/Manager เป็นผู้ตัดสินใจธุรกิจ

## Change record

| Version | Date | Rationale | Migration | Verification | Rollback |
|---|---|---|---|---|---|
| v1.0 | 6/9/2569 | ใช้ approval record เดียวระหว่าง Web Chat และ Telegram พร้อมกันการกดซ้ำ | `202609060001_cross_channel_work_approval.sql` | migration dry-run/apply, RPC/idempotency/permission tests, typecheck, lint, build และ authenticated Web/Telegram smoke | ปิด trigger/RPC/UI ใหม่และคง approval/audit ไว้เพื่ออ่านย้อนหลัง; revert frontend โดยไม่ลบ work item เดิม |


