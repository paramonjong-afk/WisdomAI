```mermaid
flowchart TD
  A[Clean committed source] --> P[Production preflight<br/>Account Token + Pages access + Env]
  P -->|ผ่าน| B[Vite build creates client bundle + release.json + release.js]
  P -->|ไม่ผ่าน| X[Block deploy<br/>ไม่สร้าง artifact/ไม่แตะ Production]
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

## Cloudflare Production preflight

- ใช้ **Account API Token** ที่มี `Pages Write` สำหรับบัญชีเจ้าของโครงการเท่านั้น ไม่ใช้ User API Token แม้ endpoint ตรวจ User Token จะตอบว่า valid
- คำสั่งกลางคือ `npm run deploy:cloudflare`; ถ้าไม่ได้ตั้ง `CLOUDFLARE_API_TOKEN` สคริปต์จะรับค่าแบบ secure prompt และไม่เขียน Token ลง Git, `.env`, log หรือไฟล์ชั่วคราว
- ต้องกำหนด `CLOUDFLARE_ACCOUNT_ID`; สคริปต์ตรวจทั้ง `/accounts/{id}/tokens/verify` และสิทธิ์อ่าน Pages project ก่อน build/deploy
- โหลดค่า frontend จาก `.env` ก่อนและ `.env.local` เป็น override; ค่าที่ส่งผ่าน process/CI มีลำดับสูงสุด เพื่อป้องกัน build ที่ไม่มี `VITE_SUPABASE_URL` แล้วเกิดหน้าขาว
- Working tree ต้องสะอาด เพื่อให้ artifact ตรงกับ commit ที่ระบุและไม่รวมงาน Module อื่นโดยไม่ตั้งใจ
- ก่อน deploy ต้องผ่าน lint, typecheck, build และตรวจ `dist/release.json` ว่า revision ตรง HEAD และ host เป็น `cloudflare`
- หลัง deploy ต้องตรวจ revision URL, remote `release.json` และ `/login` HTTP 200; จากนั้นจึงทำ authenticated UAT หน้า Module ที่เปลี่ยน

## Audit and owner

- Smart Entry เก็บผลตรวจเฉพาะใน `sessionStorage`: เวลา, host, latency, revision, parity state และปลายทางที่เลือก
- ไม่มีการส่งข้อมูลส่วนบุคคลหรือ secret ออกไปในการตรวจ
- **Owner:** Platform / Release Management Owner

## Change record

| Version | Date | Rationale | Impact | Migration | Verification | Rollback |
|---|---|---|---|---|---|---|
| v1.0 | 23/8/2569 | แก้ปัญหา Vercel/Cloudflare แสดง frontend คนละรุ่นโดยไม่ชัดเจน | เพิ่ม manifest, parity gate, ป้าย host/revision และ no-cache header ของ Cloudflare | ไม่มี schema/data migration | release/smart-entry tests, lint/build, ตรวจ manifest และ deployment ทั้งสอง host | rollback ทั้งสอง host ไป revision เดียวกัน หรือ revert parity gate ชั่วคราว; ข้อมูลผู้ใช้ไม่ถูกกระทบ |
| v1.1 | 23/8/2569 | ป้องกัน User Token ผ่าน verify แต่ deploy Pages ไม่ได้ และป้องกัน clean worktree build โดยไม่มี `.env` จนหน้าขาว | เพิ่มคำสั่ง deploy กลาง, Account Token/Pages preflight, environment/release/runtime gates | ไม่มี | contract test, lint, typecheck, build และ Cloudflare revision smoke | ใช้ revision ก่อนหน้าที่ผ่าน smoke test หรือ deploy commit เดิมผ่านคำสั่งกลาง; ไม่กระทบฐานข้อมูล |
