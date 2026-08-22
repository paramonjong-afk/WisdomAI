```mermaid
flowchart TD
  A[Commit on main] --> B[Vite build creates client bundle + release.json + release.js]
  B --> C[Vercel Production deploy]
  B --> D[Cloudflare Pages deploy]
  C --> E[Smart Entry probes health and release revision]
  D --> E
  E --> F{Cloudflare revision equals Vercel revision?}
  F -->|Yes| G[Both current: choose the faster available host]
  F -->|No or missing| H[Cloudflare stale: disable auto/manual fallback]
  G --> I[Show host + revision in top bar]
  H --> J[Use Vercel only or show retry]
  I --> K[User enters authenticated application]
  J --> K
```

# Release Parity Flow

## Purpose

รักษาให้ Vercel Production เป็นระบบหลักและ Cloudflare Pages เป็นระบบสำรองที่ใช้ได้เฉพาะเมื่อ frontend artifact มาจาก Git revision เดียวกัน ผู้ใช้จึงไม่ถูกพาไปใช้หน้าเก่าแม้ Cloudflare จะตอบเร็วกว่า

## Inputs, outputs and states

- **Inputs:** Git revision, Vite release metadata, `health-check.svg`, `release.js`, deployment result ของ Vercel และ Cloudflare
- **Outputs:** การเลือก host ที่ปลอดภัย, revision ที่ตรวจแล้วใน Smart Entry, ป้าย `Vercel`/`Cloudflare` พร้อม revision บน Top Bar
- **States:** `building`, `deployed`, `probing`, `current`, `stale`, `unknown`, `selected`, `blocked`

## Roles and permissions

- Smart Entry และ release manifest เป็นข้อมูลสาธารณะก่อน Login และไม่มีข้อมูลบริษัท, ผู้ใช้ หรือ token
- Platform Owner เป็นผู้ deploy/reconcile host; ผู้ใช้ทั่วไปเห็นเฉพาะชื่อ host กับ revision ใน Top Bar
- Authentication, route guard และสิทธิ์ข้อมูลยังคงทำงานตามระบบเดิม ไม่มีการขยายสิทธิ์

## Integrations

- Vite สร้าง `release.json` และ `release.js` พร้อม bundle ทุกครั้ง
- Vercel รับ deployment จาก `main`; Cloudflare Pages ต้อง deploy artifact/revision เดียวกัน
- `public/_headers` ป้องกัน Cloudflare cache ของ manifest เพื่อให้ Smart Entry เห็น revision ล่าสุด

## Failure, retry and recovery

- Smart Entry ตรวจ health 3 รอบและอ่าน `release.js` จากทั้งสอง host
- ถ้า Cloudflare ไม่มี Release ID หรือ revision ไม่ตรง Vercel: สถานะ `stale`/`unknown`, ไม่ถูกเลือกอัตโนมัติและปิดลิงก์เลือกเอง
- ถ้า Vercel ตอบได้แต่ Cloudflare stale: ใช้ Vercel เท่านั้น
- ถ้าไม่มี host ที่ผ่านเงื่อนไข: แสดงปุ่มลองใหม่ ไม่ redirect วน และต้องแก้ deployment ก่อนเปิด fallback
- การกู้คืนคือ deploy Cloudflare จาก commit เดียวกับ Vercel แล้วตรวจ `release.json` อีกครั้ง; ไม่ต้องเปลี่ยน database หรือข้อมูลธุรกิจ

## Audit and owner

- Smart Entry เก็บผลตรวจเฉพาะใน `sessionStorage`: เวลา, host, latency, revision, parity state และปลายทางที่เลือก
- ไม่มีการส่งข้อมูลส่วนบุคคลหรือ secret ออกไปในการตรวจ
- **Owner:** Platform / Release Management Owner

## Change record

| Version | Date | Rationale | Impact | Migration | Verification | Rollback |
|---|---|---|---|---|---|---|
| v1.0 | 23/8/2569 | แก้ปัญหา Vercel/Cloudflare แสดง frontend คนละรุ่นโดยไม่ชัดเจน | เพิ่ม manifest, parity gate, ป้าย host/revision และ no-cache header ของ Cloudflare | ไม่มี schema/data migration | release/smart-entry tests, lint/build, ตรวจ manifest และ deployment ทั้งสอง host | rollback ทั้งสอง host ไป revision เดียวกัน หรือ revert parity gate ชั่วคราว; ข้อมูลผู้ใช้ไม่ถูกกระทบ |
