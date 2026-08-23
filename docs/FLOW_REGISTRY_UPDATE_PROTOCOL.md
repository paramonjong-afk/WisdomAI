# Flow Registry Update Protocol

## ล่าสุด: Cloudflare Production Account Token Gate v1.1 — 23/8/2569

- **เหตุผล:** User API Token อาจตอบว่า valid แต่ไม่มีสิทธิ์ Account Pages และ clean worktree อาจไม่มี `.env` ทำให้ build ผ่านแต่หน้า Production ว่าง
- **ผลกระทบ:** เพิ่ม `npm run deploy:cloudflare` เพื่อตรวจ clean commit, Account Token, Pages project, `.env`/`.env.local`, release manifest และ runtime smoke ก่อนถือว่า deploy สำเร็จ; ไม่เก็บ Token ลง repository
- **Migration:** ไม่มี และไม่เปลี่ยนข้อมูล Production
- **การตรวจสอบ:** deploy contract test, lint, typecheck, build, remote `release.json`, `/login` และ authenticated Module UAT
- **Rollback:** deploy revision ก่อนหน้าที่ผ่าน smoke testด้วยคำสั่งกลาง; Token สามารถ revoke จาก Cloudflare Account API Tokens โดยไม่กระทบข้อมูลธุรกิจ

## ล่าสุด: Intake Classification Gateway 6 Modules v1.0 — 23/8/2569

- **เหตุผล:** ให้ Intake คัดแยก Web Chat/เอกสาร/สลิปเป็นโมดูลปลายทางด้วยกฎ deterministic, structured classifier และ policy gate ก่อนส่งต่อ
- **ผลกระทบ:** `src/services/intakeClassificationGateway.ts`, local precision/recall fixture contract และเอกสาร Intake flow; ไม่เขียน Production และไม่เปลี่ยน schema
- **Migration:** ไม่มี
- **การตรวจสอบ:** deterministic routing, low-confidence hold, duplicate idempotency, system-context, count reconciliation, typecheck/lint/build และ Local browser HR Pending
- **Rollback:** หยุดเรียก gateway/ซ่อน filter classification ได้ โดยเก็บ raw/source และ audit เดิมไว้

## ล่าสุด: HR Pending/Confirmation Bundle แยกจาก Document Queue v1.0 — 23/8/2569

- **เหตุผล:** แยกข้อมูล Web Chat ที่เกี่ยวกับ HR ออกจากคิวสลิป/Accounting และไม่ถือว่าเป็น HR ที่ยืนยันแล้วจนกว่าจะผ่าน HR Confirmation Gate
- **ผลกระทบ:** Document Flow มุมมอง `HR Confirmation`, local HR bundle fixture และ metadata gate candidate/system/duplicate/low-confidence; เก็บ raw/source/message ID และไม่เปลี่ยน schema หรือปลายทาง Production
- **Migration:** ไม่มี
- **การตรวจสอบ:** Local fixture วันที่ 22–23/8/2569, filter HR Pending, bundle detail/4 gate groups, ESLint, typecheck และ build
- **Rollback:** เอา `document_view=hr_confirmation` ออกจาก URL/ซ่อนตัวเลือกมุมมองได้ โดยไม่ลบ source, message หรือ audit

## ล่าสุด: HR Intake Gate + Confirmation Bundle v1.0 — 23/8/2569

- **เหตุผล:** เก็บ Web Chat Raw เป็น pending ก่อนคัด System/Daily Summary เป็น context, แยก duplicate/already-confirmed/not-HR/low-confidence และรวมเฉพาะ Candidate ที่ครบเป็นชุดตามบริษัท+ช่าง+วันที่ Bangkok+โครงการ
- **ผลกระทบ:** เพิ่ม Raw/Gate event ledger และ count ก่อน/หลัง พร้อม source/reason/duplicate link; เพิ่ม bundle/item/event ledger, validation คู่เข้าออก/ชื่อ/โครงการ/เวลา/duplicate/conflict, manager Action ยืนยัน/ขอข้อมูลเพิ่ม/ปฏิเสธ/ปิด 100%, System Confirmation หนึ่งข้อความต่อ bundle และใช้ approval RPC เดิมเขียน attendance
- **Migration:** `20260823060547_hr_confirmation_bundle.sql` local-only ระหว่างพัฒนา; ห้าม Apply Production จน local database fixture/RLS/runtime ผ่านและได้รับอนุมัติ
- **การตรวจสอบ:** fixture Raw จำนวนมากเหลือเฉพาะ candidate, context/duplicate/already-confirmed/not-HR/low-confidence, bundle normal/missing/conflict/reject/idempotency/RLS, targeted/full tests, typecheck/lint/build และ Cloudflare read-only smoke ภายหลัง
- **Rollback:** ปิด bundle trigger/RPC/UI และคืน individual confirmation projection; เก็บ ledger/audit และ attendance ที่บันทึกแล้ว ห้ามลบข้อมูลจริง

## ล่าสุด: Intake Local Test Fixture และ Filter Consistency v1.0 — 23/8/2569

- **เหตุผล:** แก้กรณีจำนวนหัว Tab ไม่ตรงกับแถวตาราง และทำให้ทดสอบ Intake ใน Local ได้โดยไม่ปะปนข้อมูล Production
- **ผลกระทบ:** `documentFlowLocalFixture`, `documentFlowGateway`, Document Flow/Intake UI และ dev-only `local_test_data=1`; ไม่เปลี่ยน schema, สิทธิ์ Production หรือข้อมูลจริง
- **Migration:** ไม่มี
- **การตรวจสอบ:** fixture contract, Bangkok date predicate, Local browser smoke สำหรับ count/filter/empty/clear/reload และ 2 มุมมอง, typecheck/lint/build
- **Rollback:** เอา `local_test_data=1` ออกจาก URL; fixture เป็นโค้ด Local read-only จึงไม่มีข้อมูลฐานข้อมูลให้ย้อน

## ล่าสุด: Document Flow Intake Backfill Entry Removed v1.0 — 23/8/2569

- **เหตุผล:** ปุ่ม/เมนู “แยกสลิปย้อนหลัง” บน Intake ทำให้ผู้ใช้สับสนและไม่อยู่ใน Flow ใหม่ จึงต้องถอดออกจากหน้าใช้งานโดยไม่แตะข้อมูลสลิปหรือ Audit เดิม
- **ผลกระทบ:** `src/pages/IntakeRoom.tsx`, regression test สำหรับ Document Flow และเอกสาร Intake Case; backend backfill และข้อมูลเดิมยังคงอยู่ถ้าต้องอ้างอิงย้อนหลัง
- **Migration:** ไม่มี
- **การตรวจสอบ:** lint, typecheck, test, build และตรวจหน้า `/document-flows` ว่าไม่มีปุ่ม/handler backfill แล้ว
- **Rollback:** คืนปุ่ม/handler เดิมได้โดยไม่ลบสลิป, Document Flow Item หรือ Audit


## ล่าสุด: Private Program Development Room v1.0 — 23/8/2569

- **เหตุผล:** แยกคำสั่งพัฒนาโปรแกรมออกจาก Web Chat ธุรกิจด้วยห้อง canonical `program_development_primary` ชื่อ `00 | Program Development` และไม่ให้ System Result วนกลับมาสร้างคำสั่งซ้ำ
- **ผลกระทบ:** `chat_rooms.room_key/is_private/room_purpose`, `development_tasks`, `development_task_dispatches`, `program_development_audit`, owner-only provisioning/route/status RPC และ membership/mutation guards; Program Loop เงินสำรองจ่าย/ลงเวลาไม่ target ห้องนี้
- **Migration:** `20260823035207_program_development_room.sql` (Production baseline); unique room key + advisory lock, owner membership เท่านั้น, development intent allow-list และ system_result guard
- **การตรวจสอบ:** `test:program-development-room`, targeted/full lint, typecheck/build และ protected Chat/Flow Registry route; UAT ต้องใช้ session เจ้าของระบบจริง
- **Rollback:** ปิด route trigger/RPC และซ่อน room card; เก็บ Chat, task, dispatch และ audit เดิมไว้ ไม่ลบข้อมูลธุรกิจ

## ล่าสุด: Employee Advance Program Loop → Web Chat Confirmation v1.6 — 23/8/2569

- **เหตุผล:** ให้รายการเบิกล่วงหน้าช่างส่ง System Confirmation ภายใน Program Loop หลังบันทึกและ Audit สำเร็จ โดยไม่ใช้ห้อง 00 ของ Codex เป็นปลายทาง และไม่เปิดทางให้ข้อความย้อนกลับมาสร้างรายการเบิกซ้ำ
- **ผลกระทบ:** `employee_advance_message_deliveries`, `employee_advance_cases.confirmation_delivery_status`, canonical `chat_rooms.room_key`, RPC `ensure_advance_confirmation_room`/`queue_employee_advance_confirmation`/`retry_employee_advance_confirmations`, trigger หลังสร้าง case, `chat_messages.message_class=system_confirmation`; ปลายทางมาตรฐานคือ `source_room` เมื่อ source context ยืนยันได้, `hr_primary` เมื่อมีเงื่อนไขพนักงาน/ค่าแรง, และ `finance_primary` สำหรับผู้รับผิดชอบการเงิน
- **Migration:** `20260823035155_employee_advance_confirmation_outbox.sql` (Production baseline); ใช้ company-scoped advisory lock และ unique `(company_id, room_key)`/`delivery_key`, เพิ่มสมาชิกเฉพาะ role ที่กำหนด, บันทึก room setup ใน `employee_advance_audit`, และสถานะ `room_setup_failed`/`pending_retry` เมื่อสร้างห้องหรือส่งไม่ได้
- **การตรวจสอบ:** advance confirmation contract/scenario test (ห้องเดิม/สร้างใหม่/duplicate/concurrent model/member permission/success/failure/retry), migration/RPC/trigger inspection, lint, typecheck, build และ protected `/advance-settlements`; production migration ต้องได้รับ approval เพิ่มเติมเพราะมีการสร้างห้อง/สมาชิกและ trigger ส่งข้อความ
- **Rollback:** ปิด trigger/integration/retry worker และซ่อนการแจ้งเตือนใน UI; เก็บ advance cases, chat messages, rooms และ audit ไว้เพื่อ reconcile ห้ามลบข้อมูลต้นทางการเงิน

## ล่าสุด: Web Chat Attendance Approval + Close 100% v2.4 — 23/8/2569

- **เหตุผล:** แยกการรับข้อมูลลงเวลาจากการบันทึกจริง ให้ผู้รับผิดชอบตัดสินใจผ่าน Action และห้ามปิด Job ก่อนข้อมูล/บันทึก/Audit ครบ
- **ผลกระทบ:** `src/pages/Chat/index.tsx`, `chat_attendance_approval_jobs`, event audit, RPC create/review/close, test และ Chat Attendance Flow; ใช้รหัสรายการเดิมกันซ้ำ
- **Migration:** `20260823031549_web_chat_attendance_approval_jobs.sql` (Production baseline; แทน timestamp local เดิม `20260823025922` ที่มี SQL เดียวกัน); ไม่ reconcile รายการ Web Chat เดิมเพราะรายการเดิมไม่มี approval job และยังคง attendance source เดิม
- **การตรวจสอบ:** scenario tests 7 กรณี, migration contract, targeted/full tests, lint, build และ real page `/chat`
- **Rollback:** คืน Web Chat submit เดิมและ drop เฉพาะ RPC/table approval ใหม่; ห้ามลบ attendance จริงหรือ audit ที่เกิดแล้ว

## ล่าสุด: Document Flow Two-View Center and Real Filter Drawer v1.19 — 23/8/2569

- **เหตุผล:** ลด Tab หลักให้เหลือ 2 มุมมอง และแก้ Filter Drawer ให้ควบคุมมุมมอง/ตัวกรองจริงจากจุดเดียว
- **ผลกระทบ:** Intake/Omni/Document Filter/คิวปลายทางย้ายเป็นตัวเลือกใน Drawer, เพิ่มข้อมูลปลายทางและรายละเอียดเส้นทาง; ไม่เปลี่ยน schema, สิทธิ์, gateway transition หรือข้อมูลเดิม
- **Migration:** ไม่มี
- **การตรวจสอบ:** targeted lint, TypeScript, Vite build, static responsive checks และ UAT หลัง sign-in; blocker คือ browser session ไม่มีบัญชีทดสอบจึงต้องทำ click UAT ภายหลัง
- **Rollback:** คืน tabs เดิมและถอดคอลัมน์สรุปได้ โดยไม่แก้ข้อมูลหรือ Audit

## ล่าสุด: Document Flow Single Tabset v1.20 — 23/8/2569

- **เหตุผล:** แก้การแสดง Tab ซ้อนสองชั้นจาก `DocumentFlowsPage` และ `IntakeRoomPanel` ให้ผู้ใช้เห็นชุด Tab เดียวที่มีเพียง 2 มุมมอง
- **ผลกระทบ:** `src/pages/DocumentFlows/index.tsx` คง Tabset กลาง 2 ตัว (`คิวเอกสาร`, `ข้อความและบริบท`) และเปลี่ยนตัวเลือกแผนกปลายทางเป็น Dropdown; `src/pages/IntakeRoom.tsx` เป็นตารางคิวโดยไม่มี Tabset ซ้ำ; search/filter/pagination/URL/state และสิทธิ์เดิมไม่เปลี่ยน
- **Migration:** ไม่มี
- **การตรวจสอบ:** `scripts/document-flow-single-tabset.test.ts`, targeted ESLint, TypeScript, Vite build และตรวจหน้า `/document-flows` บน Desktop/Tablet/Mobile; ต้องยืนยันว่า DOM มี Tabset เดียวและสลับ content ไม่ซ้ำ
- **Rollback:** คืนส่วนแสดง Tabset ของ Intake ได้โดยไม่แตะข้อมูล, routing, schema หรือ Audit แต่ไม่ควรเปิดซ้ำเพราะจะกลับมาเกิด UI ซ้อน

## ล่าสุด: Accounting/Payroll Regression Contract v1.0 — 23/8/2569

- **เหตุผล:** แก้ regression ที่ทำให้ Accounting แจ้ง Error ไม่ระบุขั้นตอน และ Reports ไม่ใช้ค่ารูปแบบเวลา/ค่าเฉลี่ยตาม requirement เดิม พร้อมปรับ test contract ที่ล้าสมัย
- **ผลกระทบ:** `docs/ACCOUNTING_DOCUMENT_CONFIRMATION_FLOW.md`, `docs/PAYROLL_REPORTING_FLOW.md`, AccountingDocuments, Reports และ regression tests 6 รายการ; ไม่เปลี่ยน schema/RLS หรือ Production
- **Migration:** ไม่มี
- **การตรวจสอบ:** test รายตัว 6 รายการ, full test suite, lint, build และตรวจ dialog/Reports จาก local build
- **Rollback:** คืน source/test patch ชุดนี้ได้; ไม่มีข้อมูลหรือ migration ต้องย้อน

## ล่าสุด: Intake Room Compact View and Drawer Isolation v1.18 — 23/8/2569

- **เหตุผล:** ลดข้อมูลซ้ำบนหน้า Intake และป้องกัน Drawer แสดงรูป/ข้อมูลจากรายการก่อนหน้าเมื่อผู้ใช้คลิกรายการใหม่เร็ว ๆ
- **ผลกระทบ:** ย้าย Source/วันที่ที่ซ้ำไป Filter Drawer, เหลือ Subtab มุมมองกับตาราง, ใช้ไอคอนสำหรับคำสั่งย้อนหลัง และเพิ่ม request guard/clear state ใน Drawer; ไม่เปลี่ยน Flow, state transition, destination, schema หรือสิทธิ์
- **Migration:** ไม่มี
- **การตรวจสอบ:** lint, TypeScript/Vite build, Intake/Document Flow targeted tests และ real-page check ของการสลับแถว/Filter Drawer; ตรวจว่า request เก่าถูกละทิ้ง
- **Rollback:** คืน UI แถวเดิมหรือถอด request guard ได้โดยไม่แก้ข้อมูล, Audit หรือเส้นทางงาน

## ล่าสุด: Web Chat Inline Image Preview v1.17 — 23/8/2569

- **เหตุผล:** ผู้ใช้ต้องการเห็นรูปที่ส่งในห้อง Chat แบบ inline โดยไม่ต้องเปิดลิงก์ทุกครั้ง
- **ผลกระทบ:** `src/pages/Chat/index.tsx`, `scripts/chat-launcher-attachment.test.ts`, `docs/CHAT_ATTENDANCE_BRIDGE_FLOW.md` และ Flow Registry card; ไฟล์ `image/*` แสดงภาพตัวอย่าง responsive และกดเปิดรูปเต็มได้, เอกสาร/ไฟล์อื่นยังใช้ปุ่มเปิดไฟล์, signed URL และสิทธิ์ Storage เดิมไม่เปลี่ยน
- **Migration:** ไม่มี schema/data migration และไม่มีการเปลี่ยน bucket จาก private เป็น public
- **การตรวจสอบ:** attachment regression, targeted ESLint, full lint/build, ตรวจ bundle ของ host ที่ deploy และ UAT ด้วยรูป JPG/PNG กับไฟล์ PDF/เอกสารเพื่อยืนยัน preview/fallback/สิทธิ์
- **Rollback:** revert เงื่อนไข inline preview และกลับไปแสดงปุ่ม `เปิดไฟล์` ได้โดยไม่ลบ `chat_messages`, Storage objects หรือ signed URL policy

## ล่าสุด: Web Chat Drag-and-Drop Attachment v1.16 — 23/8/2569

- **เหตุผล:** ผู้ใช้คอมพิวเตอร์ต้องการลากไฟล์จากเครื่องมาวางในห้องแชตโดยไม่ต้องเปิด file picker
- **ผลกระทบ:** `src/pages/Chat/index.tsx` รับ `dataTransfer.files`, แสดง drop overlay และนำไฟล์เข้า pending/send flow เดิม; validation, session, RLS, Storage และ `chat_messages` ไม่เปลี่ยน
- **Migration:** ไม่มี
- **การตรวจสอบ:** attachment regression, targeted ESLint, lint/build และ real-page drag/drop UAT; ตรวจ MIME/ขนาด, pending card, ส่งไฟล์, Storage object และ chat message
- **Rollback:** ถอด drag/drop handlers และ overlay ได้โดยไม่ลบไฟล์/ข้อความที่ส่งสำเร็จ

## ล่าสุด: Release Parity Gate v1.15 — 23/8/2569

- **เหตุผล:** Cloudflare fallback อาจตอบเร็วกว่าแต่เป็น frontend คนละ revision กับ Vercel ทำให้ผู้ใช้เห็นหน้าหรือ flow เก่าโดยไม่รู้ตัว
- **ผลกระทบ:** build สร้าง `release.json`/`release.js`; Smart Entry เลือก Cloudflare ได้เฉพาะเมื่อ revision ตรง Vercel, ปิดลิงก์ fallback ที่รุ่นไม่ตรง และ Top Bar แสดง host + revision; ไม่เปลี่ยนสิทธิ์, schema หรือข้อมูลธุรกิจ
- **Migration:** ไม่มี; ต้อง deploy Cloudflare จาก commit เดียวกับ Vercel เพื่อให้ fallback กลับมาใช้งานได้
- **การตรวจสอบ:** `scripts/release-indicator.test.ts`, `scripts/smart-entry-routing.test.ts`, lint/build, ตรวจ `release.json` ของทั้งสอง host และ deployment status หลัง deploy
- **Rollback:** rollback Vercel และ Cloudflare ไป revision เดียวกันเป็นทางเลือกหลัก; revert parity gate ได้ชั่วคราวแต่ไม่ควรเปิด fallback คนละรุ่น

## ล่าสุด: Web Chat Attachment Host Parity v1.14 — 23/8/2569

- **เหตุผล:** ผู้ใช้บางเครือข่ายเข้า `wisdomai.pages.dev` ซึ่งเป็น Cloudflare fallback แต่รุ่นแก้ไข attachment อยู่เฉพาะ Vercel จึงยังเห็น flow upload เก่าและข้อความ RLS/session เดิม
- **ผลกระทบ:** Vercel และ Cloudflare fallback ใช้ frontend artifact จาก commit `a722ea3` รุ่นเดียวกัน; ไม่เปลี่ยน schema, policy หรือข้อมูลเดิม
- **Migration:** ไม่มี; release parity ผ่านแล้ว เหลือ authenticated UAT upload จริง
- **การตรวจสอบ:** attachment regression, lint, build, Vercel deployment `dpl_GQfXKkqeun7kXqSL2RSgpMQTEd4q` READY/ไม่มี error log; Cloudflare `index-C9ZXTxHX.js`/`Chat-CboekurR.js` มี marker ของ attachment flow; UAT upload จริงยังต้องตรวจโดยผู้ใช้
- **Rollback:** rollback artifact ของทั้งสอง host ไป release ก่อนหน้าได้โดยไม่ลบไฟล์/ข้อความ

## ล่าสุด: Web Chat Attachment Session Recovery v1.13 — 23/8/2569

- **เหตุผล:** Production log พบ `auth refresh 400` ตามด้วย Storage RLS error ทำให้ session หมดอายุถูกแปลเป็น “ไม่มีสิทธิ์แนบไฟล์” ทั้งที่ผู้ใช้ยังเป็นสมาชิกห้อง
- **ผลกระทบ:** `src/pages/Chat/index.tsx`, `scripts/chat-launcher-attachment.test.ts`, `docs/CHAT_ATTENDANCE_BRIDGE_FLOW.md` และ Flow Registry card; ตรวจ `session.expires_at`, refresh ก่อน upload, retry 401/RLS ด้วย token ใหม่หนึ่งครั้ง และแยก error session/สิทธิ์ห้อง/UUID โดยคง pending file ไว้เมื่อ login ใหม่; ใช้ policy ผู้จัดการที่มีอยู่จาก `20260822194037_chat_attachment_manager_storage_policy.sql`
- **Migration:** ไม่มี migration ใหม่; policy ผู้จัดการเดิมถูก deploy อยู่แล้ว ไม่ขยายสิทธิ์เพิ่มใน v1.13
- **การตรวจสอบ:** targeted attachment test, ESLint, full lint/build, ตรวจ Supabase API/Postgres/Storage log และทดสอบ upload จริงด้วย session ที่ใช้งานได้/หมดอายุ
- **Rollback:** revert session freshness/error mapping ใน Chat; ไม่ลบข้อความหรือไฟล์เดิม

## ล่าสุด: Web Chat Explicit Mobile Attachment Send v1.12 — 23/8/2569

- **เหตุผล:** file input เดิมเริ่ม upload ทันที ทำให้บนมือถือไม่เห็นไฟล์ค้าง/ปุ่มส่ง และ session หรือห้องไม่พร้อมแล้วดูเหมือนแนบไม่สำเร็จ
- **ผลกระทบ:** `src/pages/Chat/index.tsx`, `scripts/chat-launcher-attachment.test.ts`, `docs/CHAT_ATTENDANCE_BRIDGE_FLOW.md` และ Flow Registry card; เพิ่ม pending attachment card, explicit `ส่งไฟล์`, session preflight และ retry โดยไม่เปลี่ยน Storage/RLS
- **Migration:** ไม่มี
- **การตรวจสอบ:** targeted attachment test, ESLint, full lint/build และทดสอบเส้นทางหน้า `/chat` ด้วยบัญชีสมาชิกห้องจริง
- **Rollback:** คืน flow upload อัตโนมัติได้โดยไม่ลบข้อความหรือไฟล์เดิม

## ล่าสุด: LINE Attendance Generic Command Disable v1.0 — 23/8/2569

- **เหตุผล:** ยกเลิกการตรวจจับข้อความกำกวมจาก LINE ที่มีเพียง `ลงเวลา`/`บันทึกเวลา` เพื่อไม่ให้ระบบสร้างคำขอลงเวลาโดยผู้ส่งไม่ได้ระบุเข้า/ออก
- **ผลกระทบ:** `supabase/functions/line-webhook/attendance-command.ts`, `supabase/functions/line-webhook/index.ts`, `scripts/line-attendance-command.test.ts`, `docs/CHAT_ATTENDANCE_BRIDGE_FLOW.md` และ Flow Registry card; คำสั่งทิศทางชัดเจนยังใช้ flow เดิม
- **Migration:** ไม่มี schema/data migration; Production query ไม่พบคำขอ `line_attendance_requests` หรือ `line_task_commands` ที่มาจากคำ generic จึงไม่ลบหรือเปลี่ยนรายการเดิม
- **การตรวจสอบ:** parser regression, lint, build, Edge Function deploy และตรวจสถานะ/รายการค้างบน Production
- **Rollback:** deploy `line-webhook` รุ่นก่อนหน้าและคืน parser เดิมได้ โดยไม่ลบ `attendance_sessions`, คำขอ, ข้อความ LINE หรือ audit

## ล่าสุด: Device and Role Entry Routing v1.0 — 23/8/2569

- **เหตุผล:** ลดความสับสนหลัง Login โดยให้มือถือเข้า Time Tracking เดิม และให้คอมพิวเตอร์ไปหน้าที่เหมาะกับบทบาท
- **ผลกระทบ:** `src/utils/authRouting.ts`, `src/pages/AppLauncher/index.tsx`, `src/pages/Login/index.tsx`, `src/router/ProtectedRoute.tsx`, `docs/NAVIGATION_FLOW.md`, `docs/TIME_TRACKING_FLOW.md`, `docs/CHAT_ATTENDANCE_BRIDGE_FLOW.md` และ Flow Registry card; mobile → `/time-tracking`, desktop admin/manager → `/dashboard`, desktop employee → `/my-profile`
- **Migration:** ไม่มี schema/data migration; เปลี่ยนเฉพาะ client routing และ fallback
- **การตรวจสอบ:** auth-routing test, targeted/full lint, build, route guard, ตรวจ manifest/route จริง และตรวจทางเข้า Web Chat จาก Sidebar/ทางลัด
- **Rollback:** คืน `getPostLoginDestination` เป็น `/`, ยกเลิก AppLauncher redirect และคืน Login post-auth fallback เป็น `/`; ข้อมูลลงเวลา ห้องแชต และ audit ไม่ถูกลบ

## ล่าสุด: WisdomAI PWA App Icon v1.0 — 22/8/2569

- **เหตุผล:** ให้ผู้ใช้มือถือมีไอคอนโปรแกรม WisdomAI เพียงตัวเดียว และเปิดเข้าสู่ Application Launcher ก่อนเลือก Web Chat หรือ ลงเวลา
- **ผลกระทบ:** `docs/NAVIGATION_FLOW.md`, `docs/CHAT_ATTENDANCE_BRIDGE_FLOW.md`, `src/pages/AppLauncher/index.tsx`, `src/pages/FlowRegistry/index.tsx`, `index.html`, `public/manifest.webmanifest` และไฟล์ไอคอน `public/branding/wisdom-ai-app-icon-*.png`; เปลี่ยน PWA `start_url` เป็น `/` โดยไม่เปลี่ยนสิทธิ์หรือข้อมูลธุรกิจ
- **Migration:** ไม่มี schema/data migration; เพิ่ม static assets และ manifest metadata
- **การตรวจสอบ:** ตรวจขนาด/ภาพจริงของไอคอน 32/180/192/512, ตรวจ manifest/HTML references, `npm run lint`, `npm run build` และตรวจ route `/` ใน browser/PWA
- **Rollback:** คืน `start_url` เป็น `/time-tracking`, ถอด favicon/Apple touch icon และซ่อน avatar บน Launcher; โลโก้หลักและข้อมูล runtime ไม่ถูกลบ

## ล่าสุด: Smart Entry Routing v1.0 — 22/8/2569

- **เหตุผล:** ผู้ใช้มือถือและคอมในเครือข่ายที่บล็อก `.app` ต้องมีลิงก์กลางซึ่งตรวจ Vercel/Cloudflare แล้วเลือกปลายทางที่ตอบได้เร็วกว่า
- **ผลกระทบ:** จุดเข้าใช้งาน `/start.html`, Login entry link และการเผยแพร่ QR/LINE; ไม่เปลี่ยนสิทธิ์หรือข้อมูลธุรกิจ
- **Migration:** ไม่มี
- **การตรวจสอบ:** targeted test, lint, build และ browser test ทั้งผลสำเร็จ/timeout
- **Rollback:** หยุดใช้ `/start.html`; URL Vercel และ Cloudflare เดิมยังทำงานแยกกัน

ทุกงานที่เปลี่ยน workflow, state, routing rule, source data, permission, action หรือ integration ต้องทำตามลำดับนี้ก่อนเริ่มงานและก่อนปิดงาน:

1. ระบุ Module ที่ได้รับผลกระทบ และตรวจใน Flow Registry ว่ามี Flow ของ Module นั้นหรือไม่
2. ถ้ายังไม่มี Flow: ต้องสร้าง Flow ใหม่ก่อนแก้โค้ด โดยเริ่มต้นด้วย **Flowchart แบบกราฟิก (Mermaid ที่ render ได้)** และมีคำอธิบายภาษาคนประกอบ จากนั้นระบุ input, output, state, สิทธิ์, integration, error/retry, audit และ owner
3. ถ้ามี Flow: อ่าน Flow ที่เกี่ยวข้องทั้งหมดก่อนแก้ และระบุผลกระทบของการเปลี่ยนแปลง
4. แก้ schema/API/UI/สิทธิ์ พร้อมอัปเดต **Flowchart แบบกราฟิกและคำอธิบาย** รวมถึงกติกาในเอกสารเดียวกัน ห้ามคง Flow เป็นข้อความล้วน
5. บันทึก version, วันที่, เหตุผล, ผลกระทบ, migration และแนวทางย้อนกลับ
6. รัน lint, build, test, migration และตรวจหน้าใช้งานจริง
7. ห้ามปิดงานหาก Flow Registry ไม่สะท้อนพฤติกรรมระบบหลังแก้

สำหรับ Intake ให้ใช้ `docs/INTAKE_CASE_FLOW.md` เป็นรายละเอียดอ้างอิง และหน้า `/flow-registry` เป็นจุดรวมสำหรับ Admin.

## ล่าสุด: Document Flow Scope v1.3 — 19/8/2569

- **เหตุผล:** Admin ต้องติดตามเอกสารชุดเดียวกันข้าม Intake → Filter → ปลายทาง โดยไม่ให้การแบ่งหน้าหรือการกรองฝั่งเว็บทำให้จำนวนต่างกัน
- **ผลกระทบ:** Document Flow Center, Intake Room, queue RPC และ Storage Preview
- **Migration:** `202608190014_document_flow_global_scope.sql`
- **การตรวจสอบ:** migration, lint, build, script tests, และตรวจ HTTP หน้า `/document-flows`
- **Rollback:** คืน UI/SDK ไปยัง parameter เดิมและใช้ migration `009/011`; migration นี้ไม่เปลี่ยนข้อมูลรายการหรือไฟล์

## ล่าสุด: Intake Preview Storage Policy v1.4 — 19/8/2569

- **เหตุผล:** ไฟล์ LINE อยู่ครบ แต่ signed URL ถูกบล็อก เพราะมีเฉพาะ restrictive Storage policy ไม่มี permissive policy ที่ผูกกับสิทธิ์ Document Flow
- **ผลกระทบ:** เปิดรูป/เอกสารจาก Intake, Filter และคิวปลายทาง
- **Migration:** `202608190015_line_attachment_preview_storage_policy.sql`
- **การตรวจสอบ:** ทดสอบ Storage SELECT ภายใต้ company admin, lint, build, และเปิด preview หน้าใช้งานจริง
- **Rollback:** ลบ policy ที่ migration เพิ่ม; ข้อมูลไฟล์และรายการไม่เปลี่ยน

## ล่าสุด: Project Work Package and Cash Receipt v1.5 — 19/8/2569

- **เหตุผล:** Filter ต้องแยก “บิลเงินสด” ได้ และผู้คัดแยกต้องผูกเอกสารเข้ากับโครงการหลัก/งานย่อยได้หลายระดับโดยไม่สร้างเอกสารซ้ำ
- **ผลกระทบ:** Document Flow Filter drawer, Accounting classification API, catalog ประเภทเอกสาร และทะเบียนงานโครงการ
- **Migration:** `202608190016_cash_receipt_and_work_packages.sql`
- **การตรวจสอบ:** migration, RPC schema, lint, build, script tests และ HTTP production
- **Rollback:** ปิด UI และหยุดสร้าง work package ใหม่; ไม่ลบ link/audit ที่สร้างแล้ว

## ล่าสุด: Multi-destination Document Tasks v1.6 — 19/8/2569

- **เหตุผล:** เอกสารหนึ่งใบอาจต้องให้บัญชีและสต็อกทำงานพร้อมกัน แต่ต้องไม่สร้าง Intake ID/ไฟล์ซ้ำ
- **ผลกระทบ:** Filter routing, คิวปลายทาง, สิทธิ์ตามแผนก, audit และเงื่อนไขปิดงาน
- **Migration:** `202608190017_document_flow_multi_destination.sql`
- **การตรวจสอบ:** migration, lint, build, script tests, production deployment/HTTP
- **Rollback:** ปิด UI route หลายปลายทางและหยุดสร้าง task ใหม่ โดยไม่ลบ task หรือ audit เดิม

## ล่าสุด: Compact Global Filters and Intake Visible Counts v1.7 — 19/8/2569

- **เหตุผล:** ประหยัดพื้นที่ตารางและห้ามแสดงจำนวน Intake ที่ผู้ใช้ไม่เห็นในตาราง
- **ผลกระทบ:** Document Flow Center header, global filter UX และ Intake tab count
- **Migration:** ไม่มี
- **การตรวจสอบ:** lint, build, script tests และ production HTTP
- **Rollback:** คืนแผงตัวกรองแบบเดิม; ไม่กระทบข้อมูลหรือ routing

## ล่าสุด: Data Review Status v1.8 — 20/8/2569

- **เหตุผล:** แยกความพร้อมของข้อมูลออกจากสถานะการเดินงาน เพื่อให้ทุกห้องรู้ทันทีว่าข้อมูลครบ, ไม่ครบ, แก้แล้วรอตรวจซ้ำ หรือผ่านตรวจซ้ำ
- **ผลกระทบ:** Document Flow Item, Intake/Filter/ปลายทางตารางและ Drawer, task ปลายทาง, Timeline และสิทธิ์ Manager
- **Migration:** `202608200001_document_flow_data_review_status.sql`
- **การตรวจสอบ:** migration, lint, build, script tests, production deployment/HTTP
- **Rollback:** ซ่อน UI และหยุดเปลี่ยน status ใหม่; ข้อมูลและ audit ที่บันทึกแล้วไม่ถูกลบ

## ล่าสุด: Direct Employee Resignation v1.9 — 20/8/2569

- **เหตุผล:** ให้ผู้ดูแลแจ้งลาออกจาก Drawer ของพนักงานได้โดยตรง ลดความสับสนกับการปิดใช้งาน/ลบข้อมูล
- **ผลกระทบ:** Employee Drawer, `manage-employee` action `resign`, employment lifecycle และ audit reason
- **Migration:** ไม่มี (ใช้ RPC/ตารางเดิม)
- **การตรวจสอบ:** TypeScript, lint/build และตรวจหน้า Employee ตามสิทธิ์
- **Rollback:** ซ่อนปุ่ม “แจ้งลาออก” และกลับไปใช้เมนูจัดการสถานะเดิม; ไม่กระทบข้อมูลที่บันทึกแล้ว

## ล่าสุด: HR Mutation Center Gateway v2.0 — 20/8/2569

- **เหตุผล:** รวมจุดเรียก Mutation ของ Modul HR และบังคับเส้นทาง Audit กลางให้สอดคล้องกัน
- **ผลกระทบ:** Employee create/dry-run/manage action และ Mutation Attempt Center
- **Migration:** ไม่มี (ใช้ RPC/Edge Function เดิม)
- **การตรวจสอบ:** TypeScript, lint, build และตรวจ flow document
- **Rollback:** คืนการเรียก Edge Function เดิมจากหน้า Employeeได้ โดยคง Audit ที่บันทึกแล้ว

## ล่าสุด: Platform Admin Boundary Repair v2.1 — 20/8/2569

- **เหตุผล:** แก้การลาออก/จัดการพนักงานของ Platform Admin ที่ถูก Trigger tenant ปฏิเสธโดยไม่จำเป็น
- **ผลกระทบ:** `enforce_company_reference_boundary`, HR manage action และ Platform Admin cross-company operations
- **Migration:** `202608200002_platform_admin_reference_boundary_fix.sql`
- **การตรวจสอบ:** Apply migration, ตรวจ PostgreSQL log, และทดสอบ HR manage action
- **Rollback:** คืนฟังก์ชัน Trigger เดิมที่ตรวจ membership ทุกกรณี

## ล่าสุด: Admin Employee Account Correction v2.2 — 20/8/2569

- **เหตุผล:** ให้ Platform Admin แก้ Email และตั้ง Password ใหม่ให้พนักงานกรณีคีย์ผิด
- **ผลกระทบ:** Employee Drawer, HR Mutation Gateway และ Edge Function `manage-employee-account`
- **Migration:** ไม่มี (ใช้ Auth Admin API และ Audit กลาง)
- **การตรวจสอบ:** ยืนยัน Password 2 ช่อง, ตรวจ Email, TypeScript, lint, build และ Deploy Edge Function
- **Rollback:** ซ่อนปุ่มและหยุดเรียก Function; บัญชีที่แก้แล้วไม่ถูกย้อนกลับอัตโนมัติ

## ล่าสุด: Multi-destination State Alignment v2.0 — 20/8/2569

- **เหตุผล:** RPC กลางของการส่งงานหลายปลายทางกำหนดสถานะ `destination_in_progress` ได้ถูกต้องตาม Flow แต่กฎตรวจสอบของทะเบียนกลางรุ่นเดิมไม่มีค่านี้ จึงปฏิเสธคำสั่งด้วย check constraint
- **ผลกระทบ:** การส่งจาก Filter ไปหลายแผนก, สถานะทะเบียนกลาง, Timeline/Audit และข้อความสถานะในหน้า Document Flow
- **Migration:** `20260820082024_document_flow_multi_destination_state_fix.sql`
- **การตรวจสอบ:** ตรวจ constraint และ RPC บนฐานข้อมูลจริง, lint, build, script tests, production deployment/HTTP และทดสอบหน้าใช้งานจริง
- **Rollback:** ปิด UI การส่งหลายปลายทางชั่วคราว; ไม่ลบ destination task, Intake ID, ไฟล์ หรือ Audit ที่ถูกสร้างแล้ว

## ล่าสุด: Shared Work Package Tree and Save Diagnostics v2.1 — 20/8/2569

- **เหตุผล:** งานหลัก/งานย่อยต้องเป็นทะเบียนกลางร่วมทุกแผนก และผู้ใช้ต้องทราบสาเหตุที่บันทึกไม่ได้แทน error ดิบจาก RPC
- **ผลกระทบ:** Filter Drawer, การเลือก/เพิ่ม Work Package และข้อความ recovery ของการบันทึก
- **Migration:** ไม่มี; ใช้ `project_work_packages` และ RPC กลางเดิม
- **การตรวจสอบ:** ตรวจจำนวนข้อมูลและ RPC บนฐานข้อมูลจริง, lint, build, script tests และหน้า production
- **Rollback:** คืน UI แบบรายการเลือกเดิม; ไม่เปลี่ยนข้อมูลหรือ routing ที่มีอยู่

## ล่าสุด: Complete Queue Counts and Intake Source Tabs v2.2 — 20/8/2569

- **เหตุผล:** ห้ามให้หัว Tap แสดงจำนวนจาก scope กว้างกว่าตาราง และต้องเห็นเส้นทางรับเข้า/บริบท LINE ก่อนเริ่มคัดแยก
- **ผลกระทบ:** Document Flow pagination/category mapping และ Intake source tabs/columns
- **Migration:** ไม่มี; อ่านผ่านทะเบียนกลางและ source message เดิม
- **การตรวจสอบ:** TypeScript, lint, script tests, ตรวจ count/row mapping และหน้า production
- **Rollback:** คืนรูปแบบ load ครั้งละหน้าและตาราง Intake เดิม; ไม่กระทบข้อมูลหรือ Audit

## ล่าสุด: Compact Queue Navigation v2.3 — 20/8/2569

- **เหตุผล:** ลดพื้นที่ที่ซ้ำกันระหว่าง Main Tap, ตัวเลือกคิวย่อย และตัวกรอง Intake เพื่อให้ตารางข้อมูลเป็นจุดสำคัญของหน้า
- **ผลกระทบ:** Document Flow Center และ Intake Room UI เท่านั้น
- **Migration:** ไม่มี; ไม่แก้ข้อมูล, routing, permission, integration หรือ audit
- **การตรวจสอบ:** TypeScript, lint, script tests, production deployment และตรวจหน้า `/document-flows`
- **Rollback:** คืน header, queue selector และ local filters เดิมได้โดยไม่ต้อง migration

## ล่าสุด: Department Destination Queues v2.4 — 20/8/2569

- **เหตุผล:** ผู้ทำงานปลายทางต้องเข้าคิวจากแผนกที่รับผิดชอบก่อน แล้วจึงกรองตามชนิดเอกสาร เพื่อไม่ให้เอกสารข้ามหน้าที่ทีม
- **ผลกระทบ:** Tap 3 ของ Document Flow Center และคอลัมน์ปลายทาง
- **Migration:** ไม่มี; อ่าน `target_department` และ `candidate_departments` จากทะเบียนกลางเดิม
- **การตรวจสอบ:** TypeScript, lint, script tests, production deployment และตรวจ Subtab/จำนวนบนหน้า `/document-flows`
- **Rollback:** ซ่อน Subtab แผนกและคืนตารางรวมเดิม; ไม่มีผลต่อ task, routing หรือ audit

## ล่าสุด: Standard Data Table Direct PDF Export v1.0 — 20/8/2569

- **เหตุผล:** การกด PDF เดิมเปิดหน้าสั่งพิมพ์และต้องให้ผู้ใช้เลือกบันทึกเอง จึงไม่ใช่การส่งออกไฟล์โดยตรง
- **ผลกระทบ:** `StandardDataTable` และทุกหน้าที่ใช้ปุ่ม PDF ของตาราง รวมถึง Document Flow Center
- **Migration:** ไม่มี; เพิ่ม browser-side dependencies `jspdf` และ `html2canvas` เท่านั้น
- **การตรวจสอบ:** TypeScript, lint, standard table regression, build และทดสอบดาวน์โหลด PDF ที่หน้า `/document-flows`
- **Rollback:** คืน `window.print()` implementation เดิมและถอน dependencies; ข้อมูลตารางและ audit เดิมไม่เปลี่ยน

## ล่าสุด: Direct PDF Render Visibility Fix v1.1 — 20/8/2569

- **เหตุผล:** renderer ของ browser อาจให้ภาพว่างเมื่อ report ชั่วคราวถูกวางนอก viewport
- **ผลกระทบ:** `StandardDataTable` PDF export ทุกหน้า
- **Migration:** ไม่มี
- **การตรวจสอบ:** TypeScript, lint, build และเปิดไฟล์ PDF ที่ดาวน์โหลดจาก `/document-flows`
- **Rollback:** คืนตำแหน่ง report เดิม; ไม่มีผลต่อข้อมูลหรือ audit

## ล่าสุด: Transfer Slip Payment Parties v2.7 — 20/8/2569

- **เหตุผล:** การจัดเส้นทางสลิปต้องอ้างข้อมูลคู่โอนจริง ไม่สับสนกับผู้ส่งไฟล์จาก LINE
- **ผลกระทบ:** Intake Room, `financial_transactions`, Document Flow gateway และ Edge Function `line-webhook`
- **Migration:** `20260820164102_transfer_slip_payment_parties.sql`
- **การตรวจสอบ:** apply migration, ตรวจ constraint, deploy `line-webhook`, TypeScript, lint, build, test และตรวจ Drawer Intake
- **Rollback:** หยุดอ่าน/บันทึก field ใหม่และซ่อนคอลัมน์; ไม่ลบข้อมูลสลิปเดิม

## ล่าสุด: Transfer Slip Historical Reprocessing v2.8 — 21/8/2569

- **เหตุผล:** สลิปเก่ามีอยู่ก่อนเพิ่มโครงสร้างคู่โอน จึงต้องอ่านจากไฟล์ต้นฉบับอีกครั้งโดยไม่สร้าง Intake ซ้ำหรือเดาข้อมูล
- **ผลกระทบ:** Intake Room, `financial_transactions`, `line_attachments`, `document_flow_events` และ Edge Function `reprocess-transfer-slips`
- **Migration:** ไม่มี; ใช้คอลัมน์ v2.7 และทะเบียนกลางเดิม
- **การตรวจสอบ:** deploy Function, เรียกผ่าน Admin session เป็น batch, ตรวจจำนวน updated/skipped/failed, ตรวจ field และ Timeline จากฐานข้อมูลจริง, TypeScript/lint/build และหน้า Production
- **Rollback:** ปิดปุ่ม/หยุด invoke Function ได้ทันที; ไม่ลบข้อมูลที่อ่านสำเร็จหรือ audit event

## ล่าสุด: Transfer Slip Automatic Route v2.9 — 21/8/2569

- **เหตุผล:** สลิปต้องไป Filter ตรวจสอบการโอนของบัญชีโดยอัตโนมัติ ไม่ค้างในเอกสารอ้างอิง/Admin
- **ผลกระทบ:** `financial_transactions`, `document_flow_items`, `document_flow_events`, Intake → Filter routing และคิว Accounting
- **Migration:** `20260820222343_transfer_slip_auto_routing.sql`; เพิ่มกฎ/trigger กลางและซ่อมรายการเดิมผ่านกฎเดียวกัน
- **การตรวจสอบ:** apply migration, ตรวจ trigger/function, ตรวจ 70 รายการบนฐานข้อมูลจริงว่าอยู่ `filter_payment_verification` / `accounting`, TypeScript/lint/build และหน้า Production
- **Rollback:** drop trigger/function หรือคืน route ที่ต้องการผ่าน workflow กลาง; ไม่มีการลบ Intake ID, ไฟล์ หรือ audit event

## ล่าสุด: Transfer Slip Automatic Accounting Dispatch v3.0 — 21/8/2569

- **เหตุผล:** ผู้ใช้กำหนดว่าสลิปที่ผ่าน Intake ต้องเข้าห้องบัญชีทันที ไม่ค้างให้ Filter รอการส่งต่อด้วยมือ
- **ผลกระทบ:** Filter → Tap 3 Accounting, `document_flow_destination_tasks`, `document_flow_items` และ `document_flow_events`
- **Migration:** `20260820223637_transfer_slip_auto_dispatch_accounting.sql`; เพิ่ม trigger กลาง, destination task และ dispatch สลิปเดิมผ่านกฎเดียวกัน
- **การตรวจสอบ:** apply migration, ตรวจ 70 Flow Items เป็น `destination_accounting_queue`, ตรวจ 70 Accounting tasks สถานะ `queued` และ 70 dispatch events, lint/build/test และหน้า Production
- **Rollback:** ปิด trigger/function และใช้ workflow กลางส่งรายการกลับ Filter; ไม่ลบ Intake ID, ไฟล์, task หรือ audit event

## ล่าสุด: Workforce Report Status Alignment v1.2 — 20/8/2569

- **เหตุผล:** โครงสร้าง `EmployeeSummary` ต้องสะท้อนสถานะจ้าง/ลาออกที่เพิ่มในทะเบียนจ้าง มิฉะนั้น TypeScript build ของทั้งระบบจะล้มเหลว
- **ผลกระทบ:** Workforce Reports อ่านข้อมูลจาก `employee_employment_records` เท่านั้น
- **Migration:** ไม่มี; ใช้คอลัมน์ที่มีอยู่แล้ว
- **การตรวจสอบ:** TypeScript, lint, build และรายงานพนักงาน
- **Rollback:** คืนค่า fallback ของ summary โดยไม่แก้ประวัติการจ้าง

## ล่าสุด: Payroll Period Overview Layout v1.3 — 20/8/2569

- **เหตุผล:** หน้า Reports ต้องตอบโจทย์ “ยอดค่าแรงงวดนี้จ่ายใครเท่าไร และปิดงวดได้ไหม” ไม่ใช่ให้การ์ดสรุปกินพื้นที่ก่อนเห็นรายชื่อ
- **ผลกระทบ:** Tap สรุปภาพรวมของ Reports, ตารางยอดค่าแรงรายคน, การซ่อนพนักงานลาออกที่ไม่มีผลกับงวด, dialog สรุปรายคน และปุ่มเปิด Tap รายวัน
- **Migration:** ไม่มี; ใช้ `employee_employment_records`, attendance และ payroll เดิม
- **การตรวจสอบ:** lint, build และตรวจหน้า `/reports`
- **Rollback:** คืนคอลัมน์รายงานเวลาเดิมและแสดงการ์ด summary ด้านบนได้ โดยไม่เปลี่ยนข้อมูลหรือ Audit

## ล่าสุด: Payroll Resignation Status Guard v1.4 — 20/8/2569

- **เหตุผล:** พบข้อมูลพนักงาน active แต่มี `terminated_on` ค้าง ทำให้ Reports ซ่อนพนักงานผิดจากสรุปงวด
- **ผลกระทบ:** Logic การแยกพนักงานลาออกในหน้า Reports และการซ่อมข้อมูล HR ของพนักงานรายบุคคล
- **Migration:** ไม่มี; ซ่อมข้อมูลเฉพาะ record ที่สถานะหลักเป็น active/none แต่ `terminated_on` ค้าง
- **การตรวจสอบ:** Query ฐานข้อมูลจริง, lint, build, workforce/report tests และตรวจหน้า `/reports`
- **Rollback:** คืนเงื่อนไขเดิมได้ แต่จะกลับมาเสี่ยงซ่อนพนักงาน active หากมี `terminated_on` ค้าง

## ล่าสุด: Individual Payroll PDF Print Guard v1.5 — 20/8/2569

- **เหตุผล:** ปุ่ม “พิมพ์ / บันทึก PDF รายบุคคล” อาจได้กระดาษเปล่า เพราะสั่ง print ทันทีหลัง `document.write()` ก่อน browser paint ตารางเสร็จ
- **ผลกระทบ:** หน้า Reports เฉพาะการเปิดหน้าพิมพ์/PDF รายบุคคล
- **Migration:** ไม่มี; แก้ client-side print generator
- **การตรวจสอบ:** lint, build และตรวจ production page `/reports`
- **Rollback:** กลับไปใช้ `document.write()` เดิมได้ แต่จะเสี่ยง PDF หน้าเปล่าใน Chrome อีก

## ล่าสุด: Standard Table Thai PDF Export v1.6 — 20/8/2569

- **เหตุผล:** `jsPDF.html()` ทำให้ภาษาไทยใน PDF ตารางแตกเป็น glyph/สัญลักษณ์ แม้ข้อมูลบนจอถูกต้อง
- **ผลกระทบ:** `StandardDataTable` export PDF ทุก module รวมถึง Reports summary
- **Migration:** ไม่มี; เปลี่ยน client-side export จาก direct HTML text เป็น html2canvas image slices ใน PDF
- **การตรวจสอบ:** lint, build และตรวจ production bundle ว่ามี html2canvas export path
- **Rollback:** คืน `pdf.html()` เดิมได้ แต่ภาษาไทยใน PDF จะเสี่ยงแตกอีก

## ล่าสุด: Payroll Period Close Flow v1.7 — 21/8/2569

- **เหตุผล:** ต้องมีขั้นตอนปิดรอบค่าแรงที่ล็อกข้อมูลงวด, กันรายการรอตรวจ, ออก Payslip และเก็บ Audit กลางแทนการแก้สถานะกระจายหลายจุด
- **ผลกระทบ:** Reports Tap “ปิดรอบ / Payslip”, `pay_periods`, `employee_payrolls`, `employee_payslips`, `employee_workforce_audit_logs`
- **Migration:** `202608210001_payroll_period_close_flow.sql`
- **การตรวจสอบ:** Apply migration บน Supabase Production, ตรวจ RPC จริง, lint, build, `test:workforce`, และ `test:function:payroll-attendance`
- **Rollback:** ซ่อนปุ่มปิดรอบใน Reports และ revoke/drop RPC `manage_pay_period_close_flow`; ข้อมูลงวดที่ปิดแล้วไม่ควรถูกย้อนอัตโนมัติ ให้ reopen/adjust ตามสิทธิ์

## ล่าสุด: Flow Registry Workforce UI v1.8 — 21/8/2569

- **เหตุผล:** เอกสาร Flow ถูกบันทึกแล้ว แต่หน้าโปรแกรม `/flow-registry` ยังไม่แสดง HR/Workforce Flow ให้ Admin เห็นจากระบบโดยตรง
- **ผลกระทบ:** หน้า “ทะเบียน Flow ระบบ” เพิ่มส่วน HR / Workforce Flow พร้อมการ์ดงานบุคคล Backbone และปิดรอบค่าแรง รวมถึงปุ่มลัดไปหน้าพนักงานและ Reports
- **Migration:** ไม่มี migration ฐานข้อมูล
- **การตรวจสอบ:** lint/build และตรวจหน้า `/flow-registry` หลัง deploy
- **Rollback:** ย้อนเฉพาะ section HR / Workforce Flow ใน `src/pages/FlowRegistry/index.tsx`

## ล่าสุด: Payroll Summary Net Day Drilldown v1.9 — 21/8/2569

- **เหตุผล:** ผู้ใช้ต้องตรวจที่มาของ “วันสุทธิ” จากหน้าสรุปภาพรวมได้ทันที โดยไม่ต้องย้าย Tap ก่อน
- **ผลกระทบ:** Reports Tap “สรุปภาพรวม” ช่อง “วันสุทธิ” เปิด Dialog รายงานรายละเอียดรายวันเต็ม; ช่อง “สุทธิจ่าย” ยังคงเปิดสรุปกระชับ
- **Migration:** ไม่มี migration ฐานข้อมูล
- **การตรวจสอบ:** lint/build และตรวจหน้า Reports สรุปภาพรวม
- **Rollback:** ให้ `วันสุทธิ` กลับไปเปิดสรุปกระชับเหมือน `สุทธิจ่าย`

## ล่าสุด: Payroll Close Review Filter Guard v2.0 — 21/8/2569

- **เหตุผล:** หน้า Reports นับรายการเวลา `clock_out_at` ว่างเป็นรอตรวจ แม้รายการนั้นถูก `rejected`/`excluded` แล้ว ทำให้ปุ่มปิดรอบถูกบล็อกผิด
- **ผลกระทบ:** Reports Tap “รอตรวจ” และ Tap “ปิดรอบ / Payslip” ให้ใช้กติกาเดียวกับ RPC กลาง ไม่ถือรายการที่ Admin ตัดออกแล้วเป็นรายการค้าง
- **Migration:** ไม่มี migration ฐานข้อมูล
- **การตรวจสอบ:** lint/build และตรวจ checklist ปิดรอบงวด `รอบ 1-15 08/2026`
- **Rollback:** กลับไปนับ `clock_out_at` ว่างทุกสถานะเป็นรอตรวจ แต่จะทำให้รายการ rejected/excluded บล็อกปิดรอบอีก

## ล่าสุด: Auth Password Reset Recovery Flow v1.1 — 21/8/2569

- **เหตุผล:** Reset password link บางกรณีกลับมาที่ `/` หรือ `/login` พร้อม Supabase recovery hash/error แทน `/reset-password` ทำให้ผู้ใช้ไม่ถึงหน้าตั้งรหัสใหม่หรือกดแล้วเจอ session missing
- **ผลกระทบ:** Login forgot password, ResetPassword page, Protected/Public route guard, Flow Registry System/Auth section
- **Migration:** ไม่มี migration ฐานข้อมูล
- **การตรวจสอบ:** lint/build, ตรวจ route guard รองรับ `type=recovery`, token hash, PKCE `code`, และ error `otp_expired/access_denied`
- **Rollback:** ลบ `authRecovery` route guard และกลับไปให้ `/reset-password` รับเฉพาะลิงก์ตรง แต่ reset link ที่กลับ root/login จะเสียอีก

## ล่าสุด: Advance Settlement Navigation v1.1 — 21/8/2569

- **เหตุผล:** หน้าเงินทดรอง/ปิดยอดมี route `/advance-settlements` แล้ว แต่ไม่มีเมนูซ้าย ทำให้ผู้ใช้หาไม่เจอ
- **ผลกระทบ:** Sidebar และ Navigation เพิ่มเมนู `การเงินและบัญชี → เงินทดรองและปิดยอด`
- **Migration:** ไม่มี migration ฐานข้อมูล
- **การตรวจสอบ:** lint/build และตรวจเมนูซ้ายหลัง deploy
- **Rollback:** เอา navigation item `/advance-settlements` และ icon mapping ออก

## ล่าสุด: Central Permission Resolver v1.0 — 20/8/2569

## ล่าสุด: Authentication Attempt Audit v1.0 — 20/8/2569

- **เหตุผล:** ให้ส่วนกลางเห็นทั้งการเข้าสู่ระบบสำเร็จและล้มเหลวก่อนเกิด Session โดยไม่เก็บอีเมลจริง
- **ผลกระทบ:** Login page, ตาราง `auth_login_attempts`, RPC `register_login_attempt`, สิทธิ์อ่านเฉพาะ Admin
- **Migration:** `202608200005_login_attempt_audit.sql`
- **การตรวจสอบ:** TypeScript, lint, build และตรวจ RPC/ตารางบนฐานข้อมูลจริง
- **Rollback:** หยุดเรียก RPC และลบ migration ได้โดยไม่กระทบบัญชีหรือ Session

- **เหตุผล:** หลายหน้าตรวจ `platform_role` แยกกัน ทั้งที่ฐานข้อมูลใช้ `profiles.role` เป็นค่าหลัก ทำให้สิทธิ์ Admin แสดงไม่ตรงกัน
- **ผลกระทบ:** RoleRoute, Sidebar, TopBar, Settings, Platform Control Center, Line Monitor และ Reports
- **Migration:** ไม่มี; เพิ่ม `src/utils/permissions.ts`
- **การตรวจสอบ:** TypeScript, lint, build และค้นหาการอ้างสิทธิ์ที่กระจายตัว
- **Rollback:** ถอด helper และคืน guard เดิมได้ โดยไม่กระทบข้อมูล

## ล่าสุด: Backend Permission Alignment v1.1 — 20/8/2569

- **เหตุผล:** Edge Functions บางตัวใช้ `platform_role` หรือบังคับ membership แม้ผู้ใช้เป็น Platform Admin ทำให้กติกาสิทธิ์ไม่ตรงกัน
- **ผลกระทบ:** Telegram Admin, Attendance Reminders, Health Monitor, Intake Review และ Drawing AI Benchmark
- **Migration:** ไม่มี; ปรับ authorization guard ใน Edge Functions
- **การตรวจสอบ:** Deploy และตรวจสถานะ `ACTIVE` สำหรับ `telegram-admin`, `attendance-reminders`, `health-monitor`; ฟังก์ชันที่มีขอบเขตข้อมูลเสี่ยงยังรออนุมัติ Deploy
- **Rollback:** Redeploy เวอร์ชันก่อนหน้า หรือปิด action ที่ได้รับผลกระทบ; ไม่ลบข้อมูล

## ล่าสุด: Same-scope Update Boundary v1.0 — 20/8/2569

- **เหตุผล:** Trigger เดิมบังคับ membership active แม้เป็น UPDATE แถวเดิมระหว่างลาออก ทำให้เกิด Cross-company profile reference denied
- **ผลกระทบ:** การลาออก/ปิดสถานะพนักงานที่มีประวัติไซต์งาน โดยยังห้าม INSERT หรือเปลี่ยน company/profile ข้ามบริษัท
- **Migration:** `202608200003_allow_same_scope_updates_for_resignation.sql`
- **การตรวจสอบ:** ตรวจ Trigger บนฐานข้อมูลจริง และทดสอบ Flow ลาออกผ่าน Production
- **Rollback:** คืนฟังก์ชัน Trigger เดิมได้ โดยไม่ลบข้อมูลพนักงานหรือประวัติการทำงาน

## ล่าสุด: Resignation Audit Ordering v1.0 — 20/8/2569

- **เหตุผล:** Audit log ถูกเขียนหลังปิด membership ทำให้ Trigger กลางตรวจ profile ที่ inactive และปฏิเสธการลาออก
- **ผลกระทบ:** Flow ลาออกของ HR เท่านั้น
- **Migration:** `202608200004_resignation_audit_before_membership_close.sql`
- **การตรวจสอบ:** ทดสอบ Production กับ นิติกร ไร่พิมาย และตรวจสถานะ/ไซต์งาน/Audit ในฐานข้อมูลจริง
- **Rollback:** คืนลำดับเดิมได้ แต่จะทำให้กรณี membership ถูกปิดก่อน Audit กลับมาเกิดปัญหาเดิม

## ล่าสุด: Employee Resignation Pending Lifecycle v1.1 — 20/8/2569

- **เหตุผล:** แยกวันสุดท้ายทำงาน, วันตัดสิทธิ์ และวันคิดเงินถึง เพื่อรองรับลาออกล่วงหน้า/ย้อนหลัง/ไม่แจ้งล่วงหน้า โดยไม่ตัดสิทธิ์ก่อนเวลาจริง
- **ผลกระทบ:** Employee Drawer, Edge Function `manage-employee`, RPC `resign_employee`, field cutoff สำหรับ Payroll และ Audit กลาง
- **Migration:** `202608200007_employee_resignation_pending_lifecycle.sql`
- **การตรวจสอบ:** TypeScript build, lint, apply migration แบบจำกัด, deploy Edge Function และตรวจ schema/RPC บนฐานข้อมูลจริง
- **Rollback:** คืน RPC `resign_employee` และ `generate_pay_period` รุ่นก่อนหน้า แล้วซ่อน field วันที่ใหม่ใน UI; ข้อมูลลาออกที่บันทึกแล้วไม่ถูกลบ

## ล่าสุด: Resigned Employee Profile Visibility v1.2 — 20/8/2569

- **เหตุผล:** หลังปิด membership แล้ว RLS ของ `profiles` ซ่อนพนักงานที่ลาออก ทำให้หน้า Employees ไม่แสดงในแท็บลาออก
- **ผลกระทบ:** หน้า Employees, filter รายชื่อปกติ/ลาออก/ทั้งหมด, RLS `profiles`, การตรวจสอบย้อนหลังของ Admin
- **Migration:** `202608200008_resigned_employee_profile_visibility.sql`
- **การตรวจสอบ:** Apply migration, ตรวจหน้า `/employees`, lint/build
- **Rollback:** คืน policy เดิมที่บังคับเห็นเฉพาะสมาชิก active; รายการลาออกจะถูกซ่อนจากหน้า UI อีกครั้ง

## ล่าสุด: Retroactive Resignation Constraint Guard v1.3 — 20/8/2569

- **เหตุผล:** การแจ้งลาออกย้อนหลังอาจทำให้ `company_members.ends_on` หรือ `employee_site_assignments.ends_on` ย้อนก่อน `starts_on` และชน check constraint ของฐานข้อมูล
- **ผลกระทบ:** RPC `resign_employee`, Employee resignation dialog, membership/site assignment technical close date และ Audit กลาง
- **Migration:** `202608200009_resignation_retroactive_membership_clamp.sql`
- **การตรวจสอบ:** Apply migration, ตรวจ constraint จริง, lint/build และทดสอบหน้า `/employees`
- **Rollback:** คืน RPC `resign_employee` รุ่นก่อนหน้า; เคสลาออกย้อนหลังที่วันที่สิ้นสภาพก่อนวันเริ่ม record จะกลับมาถูกปฏิเสธ

## ล่าสุด: Resignation Audit Before Close v1.4 — 20/8/2569

- **เหตุผล:** RPC รุ่นแก้ลาออกย้อนหลังย้าย Audit ไปหลังปิด membership ทำให้ trigger tenant เห็น profile เป็น inactive แล้วโยน `Cross-company profile reference denied` ทั้งที่ข้อมูลอยู่บริษัทเดียวกัน
- **ผลกระทบ:** RPC `resign_employee`, Audit log, trigger tenant boundary และข้อความ error ในหน้า Employees
- **Migration:** `202608200010_resignation_audit_before_retroactive_close.sql`
- **การตรวจสอบ:** Apply migration และตรวจ production function ว่า Audit เกิดก่อน `company_members` close พร้อมคง clamp วันที่ย้อนหลัง
- **Rollback:** คืน RPC รุ่น `202608200009`; แต่จะทำให้เคสลาออกย้อนหลังกลับมาเสี่ยง error cross-company ตอนเขียน Audit

## ล่าสุด: Transfer Slip Accounting Drawer v3.1 — 21/8/2569

- **เหตุผล:** สลิปที่ส่งเข้าคิวบัญชีอัตโนมัติยังมีรายละเอียดผู้โอน/ผู้รับอยู่ในทะเบียนธุรกรรม แต่ Drawer ปลายทางไม่อ่านข้อมูลนั้น จึงทำให้ทีมบัญชีต้องย้อนกลับ Intake
- **ผลกระทบ:** Document Flow Tap 3 Drawer และ `documentFlowGateway`; อ่าน `financial_transactions` ด้วย `source_message_id` จาก Flow item เดิม ภายใต้ RLS เดิม
- **Migration:** ไม่มี; ไม่ย้ายหรือคัดลอกข้อมูล และไม่มี routing/action/integration ใหม่
- **การตรวจสอบ:** TypeScript, lint, document pipeline test, build, production deployment และเปิดสลิปในคิวบัญชีจริงเพื่อยืนยันรายละเอียดคู่โอน/การปกปิดบัญชี
- **Rollback:** ซ่อน Paper รายละเอียดสลิปใน Drawer ได้ทันที; ไม่มีข้อมูลหรือ Audit ถูกแก้ไข

## ล่าสุด: Daily Employee Transfer Slip HR Route v3.2 — 21/8/2569

- **เหตุผล:** สลิปที่จ่ายให้พนักงานรายวันต้องให้ HR ตรวจความสัมพันธ์กับค่าจ้างด้วย แต่ต้องไม่ตัดคิวบัญชีหรือสร้าง Intake/ไฟล์ซ้ำ
- **ผลกระทบ:** `financial_transactions`, Document Flow destination tasks, Tap 3 HR/Accounting, Audit และ Workforce employee registry
- **Migration:** `20260820231427_transfer_slip_daily_employee_hr_routing.sql`; trigger กลางเทียบเฉพาะ `recipient_name` กับพนักงานรายวัน active ของบริษัทเดียวกันแบบ exact-normalized และเพิ่ม HR task แบบ idempotent
- **การตรวจสอบ:** apply migration, ตรวจจำนวน match/task/event บนฐานข้อมูลจริง, lint/build/document pipeline test และหน้า production Tap 3 ทั้งบัญชี/HR
- **Rollback:** ปิด trigger/function; task HR เดิมให้ cancel ตาม workflow กลาง ไม่ลบ source, Accounting task หรือ Audit

## ล่าสุด: Employee Advance & Settlement v1.0 — 21/8/2569

- **เหตุผล:** เงินที่โอนให้พนักงานรายเดือนเพื่อจ่ายแทนบริษัทต้องแตกยอด, แนบหลักฐาน, ตรวจ และปิดยอดได้โดยย้อนกลับถึงสลิป/Intake เดิม
- **ผลกระทบ:** Financial Summary, หน้าเงินทดรอง/ปิดยอด, Accounting/HR review, Document Flow event และ Workforce employee registry
- **Migration:** `20260820233529_employee_advance_settlement_flow.sql`; เพิ่ม case, settlement line, append-only audit และ RPC กลางสำหรับสร้าง/เพิ่มรายการ/เปลี่ยนสถานะ
- **การตรวจสอบ:** migration/schema/RLS/RPC, lint/build/document pipeline test และ production route `/advance-settlements`
- **Rollback:** ซ่อนหน้าและหยุด RPC; ไม่ลบสลิป, Intake ID, หลักฐาน, case หรือ Audit เดิม

## ล่าสุด: Employee Technician Sub-Advance v1.1 — 21/8/2569

- **เหตุผล:** เงินที่ผู้ถือเงินทดรองนำไปจ่ายให้ช่างต้องเป็น “เงินเบิกล่วงหน้า” ของช่าง ไม่ใช่ค่าแรงหรือค่าใช้จ่ายที่ปิดยอดทันที
- **ผลกระทบ:** Employee Advance & Settlement, settlement line, ผู้ถือเงินทดรอง, ช่าง/พนักงานรายวัน และเส้นทางตรวจสอบของบัญชี
- **Migration:** `20260821001815_employee_sub_advance_flow.sql`; เพิ่ม parent-child advance, RPC สร้างเงินเบิกช่าง, audit และกติกาปิดยอด parent หลัง child ทุกใบปิดแล้ว
- **การตรวจสอบ:** apply migration, ตรวจ constraint/RPC/audit, lint/build/document pipeline test และเปิดหน้าจริง `/advance-settlements` เพื่อสร้าง/ดูเงินเบิกช่าง
- **Rollback:** ซ่อนปุ่ม/หยุด RPC ใหม่; ไม่ลบ case, audit หรือความเชื่อมโยงกับสลิปเดิม

## ล่าสุด: Transfer Slip Account-Pair Registry v3.3 — 21/8/2569

- **เหตุผล:** สลิปที่ AI อ่านบัญชีต้นทางและปลายทางครบด้วยความมั่นใจสูง ต้องเข้าสู่ทะเบียนกลางโดยอัตโนมัติ เพื่อใช้ตรวจและ map บัญชีบริษัทในลำดับถัดไป
- **ผลกระทบ:** `financial_transactions`, ทะเบียนคู่บัญชีสลิป, Audit และ Intake/Accounting source trace; ไม่เปลี่ยนสถานะอนุมัติหรือสร้าง journal อัตโนมัติ
- **Migration:** `20260821004635_transfer_slip_account_pair_registry.sql`; เพิ่ม registry/audit แบบ RLS, trigger sync สำหรับสลิปใหม่ และ backfill เฉพาะคู่ที่ครบ/มั่นใจ ≥90%
- **การตรวจสอบ:** apply migration, นับคู่ที่ auto_registered เทียบกับสลิปเข้าเกณฑ์, lint/build/test และเปิดหน้า Production
- **Rollback:** ปิด trigger/function; ข้อมูลต้นทาง, registry และ audit ไม่ถูกลบ

## ล่าสุด: Transfer Slip Account-Pair Visibility v3.4 — 21/8/2569

- **เหตุผล:** คู่บัญชีที่ระบบรับเข้าอัตโนมัติอยู่ในทะเบียนกลาง แต่ผู้ใช้ยังไม่มีหน้าจอสำหรับตรวจรายการที่รับเข้า
- **ผลกระทบ:** Financial Summary เพิ่ม Tap คู่บัญชีอัตโนมัติ แสดงต้นทาง/ปลายทางแบบปกปิดเลขบัญชี, เวลาโอน, ความมั่นใจ และสถานะ
- **Migration:** ไม่มี; อ่านทะเบียนกลางเดิมตาม RLS
- **การตรวจสอบ:** lint/build/test และเปิดหน้า Production Financial Summary ยืนยันจำนวน/ตาราง
- **Rollback:** ซ่อน Tap; registry/audit และสลิปต้นทางไม่ถูกแก้ไข

## ล่าสุด: Transfer Slip Account-Pair Detail Timeline v3.5 — 21/8/2569

- **เหตุผล:** ตารางคู่บัญชีแบบรวมทำให้แยกผู้โอน/ผู้รับและธนาคารต้นทาง/ปลายทางได้ยาก และยังไม่เห็นลำดับเหตุการณ์ที่ระบบรับคู่บัญชีเข้าทะเบียนกลาง
- **ผลกระทบ:** Financial Summary Tap คู่บัญชีอัตโนมัติ แยกทุกข้อมูลต้นทาง/ปลายทางเป็นคอลัมน์ และเปิด Drawer รายละเอียดที่แสดงเวลาโอน, ความมั่นใจ, สถานะ และ Audit timeline แบบอ่านอย่างเดียว
- **Migration:** ไม่มี; อ่าน `financial_transaction_account_pairs` และ `financial_transaction_account_pair_audit` ผ่าน RLS เดิม
- **การตรวจสอบ:** lint, typecheck, document pipeline test, build และเปิดหน้า Production ด้วยบัญชีที่มีสิทธิ์บริษัทเพื่อตรวจตาราง/Drawer
- **Rollback:** คืนคอลัมน์รวมและซ่อน Drawer ได้ทันที; สลิป, registry และ Audit ไม่ถูกแก้ไข

## ล่าสุด: Safe Transfer Slip Advance Automation v3.6 — 21/8/2569

- **เหตุผล:** ข้อมูลสลิปที่อ่านได้ต้องเห็นแต่ละช่องแยกกัน และสลิปที่ยืนยันผู้รับพนักงานรายเดือนได้จริงควรสร้างเงินสำรองจ่ายฉบับร่างผ่านเส้นทางกลาง โดยไม่เดาหรือบันทึกจ่ายเอง
- **ผลกระทบ:** Financial Summary แยกผู้โอน/ธนาคาร/บัญชีต้นทางและผู้รับ/ธนาคาร/บัญชีปลายทาง พร้อมสถานะข้อมูลและปลายทางเงินสำรอง; เพิ่ม trigger กลางสร้าง `employee_advance_cases` เฉพาะสลิปที่ไม่ซ้ำ, มียอด, คู่บัญชีครบ, AI ≥90%, เข้าคิวบัญชีแล้ว และชื่อผู้รับ match พนักงานรายเดือน active เพียงหนึ่งคน
- **Migration:** `20260821040841_safe_transfer_slip_advance_automation.sql`; พนักงานรายวันยังคง HR/Accounting queue เพราะเงินเบิกช่างต้องมีเงินสำรองแม่ จึงไม่สร้าง child advance แบบเดา
- **การตรวจสอบ:** apply migration และ repair history, trigger 2 จุดมีอยู่จริง, ตรวจข้อมูลจริงพบสลิปเข้าเกณฑ์ AI 54 รายการแต่ monthly exact-match 0 รายการ จึงไม่สร้างเคสผิด, lint/typecheck/document-pipeline/build ผ่าน
- **Rollback:** ปิด trigger/function ใหม่และซ่อนคอลัมน์ปลายทาง; ไม่ลบสลิป, Intake, คู่บัญชี, advance case หรือ audit ที่สร้างแล้ว

## ล่าสุด: Advance Holder Registry v3.7 — 21/8/2569

- **เหตุผล:** ชื่อบนสลิปไม่ควรถูกเดาเป็นผู้ถือเงินสำรอง จึงต้องมีทะเบียนผู้รับที่อนุมัติ พร้อมชื่อ alias และลายนิ้วมือบัญชีปลายทาง เพื่อจับคู่สลิปได้อย่างปลอดภัย
- **ผลกระทบ:** เพิ่มหน้า `/advance-holders`, ทะเบียนผู้ถือเงิน/alias/audit, RPC กลางสำหรับ Manager และเปลี่ยน auto-advance ให้ใช้ทะเบียน active ที่ match ชื่อ+ธนาคาร+4 หลักท้ายเพียงหนึ่งรายการ
- **Migration:** `20260821045518_advance_holder_registry.sql`; เงินเบิกช่างยังต้องอ้าง parent advance และไม่สร้างจากสลิปโดยตรง
- **การตรวจสอบ:** apply migration/repair history, ตรวจ table/RPC จริง, lint/typecheck/document-pipeline/build; Production route ต้องเปิดด้วย session Manager เพื่อเพิ่มผู้ถือเงินจริง
- **Rollback:** ปิด trigger/function และซ่อน route; ไม่ลบสลิป, Intake, holder, case หรือ audit เดิม

## ล่าสุด: Advance Holder Historical Reprocess v3.8 — 21/8/2569

- **เหตุผล:** เพิ่มผู้ถือเงินหรือชื่อ alias แล้วต้องใช้ได้กับสลิปย้อนหลัง มิฉะนั้นระบบจับคู่ได้เฉพาะรายการใหม่และข้อมูลค้างไม่สอดคล้องกัน
- **ผลกระทบ:** trigger ที่ทะเบียนผู้ถือเงิน/alias เรียกกติกา auto-advance กลางกับสลิปของบริษัทเดียวกัน; กติกายังสร้างได้เพียง draft ที่ match แบบครบและไม่ซ้ำ
- **Migration:** `20260821050826_advance_holder_match_reprocess.sql`; ดำเนินการหลังได้รับอนุมัติ reprocess สลิปย้อนหลังจากผู้ใช้
- **การตรวจสอบ:** apply migration/repair history, พบ trigger holder+alias ครบ 2 จุด; ปัจจุบัน auto case = 0 เพราะยังไม่มี holder ลงทะเบียน จึงไม่มีการสร้างเคสผิด
- **Rollback:** ปิด trigger reprocess ได้โดยไม่กระทบ source, holder, case หรือ audit ที่มีอยู่

## ล่าสุด: Advance Holder Name Candidate Confirmation v3.9 — 21/8/2569

- **เหตุผล:** ช่วงเริ่มใช้งานยังไม่มั่นใจข้อมูลธนาคาร/บัญชีปลายทาง ระบบจึงควรเสนอผู้ถือเงินจากชื่อใกล้เคียง 2–3 คนก่อน แล้วให้ Admin ยืนยัน ไม่สร้างเคสจากชื่ออย่างเดียวอัตโนมัติ
- **ผลกระทบ:** Financial Summary คอลัมน์สำรองจ่าย/ตรวจสอบ, RPC `create_employee_advance_from_transaction_with_holder`, `employee_advance_cases`, `employee_advance_audit` และ Document Flow timeline
- **Migration:** `20260821052000_advance_admin_confirm_name_match.sql`; เพิ่ม RPC กลางที่รับ holder ที่ Admin เลือก explicit และยังตรวจบริษัท/สิทธิ์/พนักงานรายเดือน active
- **การตรวจสอบ:** apply migration, lint/build และตรวจหน้า `/financial-summary` ให้แสดง candidate และสร้าง draft advance หลัง Admin กดยืนยันเท่านั้น
- **Rollback:** ซ่อน candidate buttons และ revoke RPC ใหม่; เคสที่ Admin ยืนยันแล้วคงอยู่พร้อม audit

## ล่าสุด: Auth Reset Error Clarity v1.2 — 21/8/2569

- **เหตุผล:** ผู้ใช้ขอลิงก์ reset ซ้ำแล้วไม่มีอีเมลเข้า เพราะ Supabase Auth ตอบ `over_email_send_rate_limit` / HTTP 429 และบางบัญชีถูก `User is banned` แต่ข้อความหน้า Login ยังไม่อธิบายสาเหตุชัดเจน
- **ผลกระทบ:** Error Center กลาง, หน้า Login / Forgot Password และเอกสาร Auth Password Reset Flow
- **Migration:** ไม่มี; เป็นการเพิ่ม mapping error กลางเท่านั้น ไม่แก้ข้อมูล Auth หรือ password
- **การตรวจสอบ:** ตรวจ Supabase Auth logs พบ `/recover` 429 และ `User is banned`; ต้องรัน lint/build ก่อน deploy
- **Rollback:** ถอด mapping `AUTH_EMAIL_RATE_LIMIT` และ `AUTH_USER_BANNED`; ระบบจะกลับไปใช้ข้อความ fallback เดิม

## ล่าสุด: Auth Security Telegram Alert v1.3 — 21/8/2569

- **เหตุผล:** ปัญหา reset password สำคัญ เช่น email rate limit, banned user, expired/access denied link ไม่ถูกแจ้ง Admin/Telegram ทำให้ผู้ดูแลไม่รู้ทันที
- **ผลกระทบ:** หน้า Login, หน้า Reset Password, audit `auth_login_attempts`, Edge Function `health-monitor` และ Telegram Admin alert
- **Migration:** ไม่มี; ใช้ RPC audit เดิม `register_login_attempt` เพื่อหลีกเลี่ยงการเปิดช่อง anon ไปสั่ง Telegram โดยตรง
- **การตรวจสอบ:** lint/build, deploy `health-monitor`, ทดสอบบันทึก auth failure reason จำลอง และตรวจให้ Health Monitor เห็นเป็น Auth incident
- **Rollback:** ถอดการเรียก auth security audit ใน frontend และ redeploy `health-monitor` เวอร์ชันก่อนหน้า; audit login เดิมยังทำงานตามปกติ

## ล่าสุด: Central Error Capture Coverage v1.4 — 21/8/2569

- **เหตุผล:** Error บางกรณีถูกจับแล้วแสดงผู้ใช้ผ่าน `userError()` หรือ mutation runner แต่ไม่ถูกส่งเข้า `system_error_events` จึงไม่ขึ้นศูนย์ปัญหา/Health Monitor ครบถ้วน
- **ผลกระทบ:** `userError`, `centralErrorReporter`, `mutationAttemptRunner`, System Error Center และ SYS-004 Health Monitor
- **Migration:** ไม่มี; ใช้ RPC เดิม `register_client_error_event` และ dedupe ฝั่ง browser 2 นาที
- **การตรวจสอบ:** lint/build และตรวจว่า request/global/mutation/visible user error มีเส้นทางเข้าส่วนกลาง โดยไม่บันทึก password/token/secret
- **Rollback:** ถอด `reportCentralError` จาก `userError` และ `mutationAttemptRunner`; request/global telemetry เดิมยังทำงานต่อ

## ล่าสุด: Project Dashboard Payroll Accrual v1.0 — 21/8/2569

- **เหตุผล:** หน้า Dashboard รวมอ่านค่าแรงจาก `employee_payrolls` เป็นหลัก จึงอาจไม่ขึ้นค่าแรงเมื่อยังไม่ได้ generate/lock payroll แม้หน้า Reports มีค่าแรงเกิดขึ้นจริงจาก forecast แล้ว
- **ผลกระทบ:** Dashboard ศูนย์บริหารโครงการ, Tap ค่าแรงและกำลังคน, Flow Registry หน้าโปรแกรม และ `docs/PROJECT_DASHBOARD_FLOW.md`
- **Migration:** ไม่มี; อ่าน RPC เดิม `get_realtime_payroll_forecast(target_month)` และไม่เขียนข้อมูล
- **การตรวจสอบ:** lint, build, payroll forecast test และตรวจหน้า `/dashboard` หลัง deploy ให้เห็นยอดค่าแรงรวมพร้อมแหล่งที่มา Payroll/Forecast
- **Rollback:** ถอดการอ่าน forecast RPC และการ์ดค่าแรงเกิดขึ้นจริงออกจาก Dashboard; Reports/Payroll เดิมไม่ถูกกระทบ

## ล่าสุด: Manual Leave / Absence Record v1.0 — 21/8/2569

- **เหตุผล:** ช่างโทรแจ้งลา/ขาดงานกับ Admin แต่ไม่มีจุดบันทึกในระบบ ทำให้วันลาไม่เข้าสรุปรายงานและค่าแรง
- **ผลกระทบ:** Reports Tap “ขาด–ลา–สาย”, `employee_leave_requests`, Mutation Attempt Center และ `docs/WORKFORCE_BACKBONE_FLOW.md`
- **Migration:** ไม่มี; ใช้ตารางลาเดิมและบันทึกเป็น `approved` พร้อม `reviewed_by/reviewed_at`
- **การตรวจสอบ:** lint/build และตรวจหน้า Reports ว่ามีปุ่ม/ฟอร์มบันทึกลา Manual โดยไม่สร้าง attendance ปลอม
- **Rollback:** ซ่อนปุ่ม/ฟอร์ม Manual Leave; รายการลาที่บันทึกแล้วเป็นหลักฐาน HR ไม่ลบอัตโนมัติ

## ล่าสุด: Chat Attendance Bridge v1.0 — 21/8/2569

- **เหตุผล:** ให้ HR เลือกห้อง Chat เป็นปลายทางกลางสำหรับ log ลงเวลาเข้า/ออกของช่าง โดยยังคงใช้ `attendance_sessions` เป็นข้อมูลต้นทางเดียว
- **ผลกระทบ:** Chat Web Room, Workforce Attendance, Realtime message feed, mapping สิทธิ์บริษัท→ห้อง และ delivery audit/retry
- **Migration:** `20260821040239_chat_attendance_bridge.sql` + `20260821040539_chat_attendance_bridge_hardening.sql`; เพิ่ม `chat_room_integrations`, `chat_attendance_delivery_events`, RLS และ trigger/function idempotent พร้อม pin `search_path`
- **การตรวจสอบ:** ตรวจ schema/RLS/trigger, TypeScript, lint, build, attendance/chat tests และเปิดหน้า `/chat` จริงเพื่อเลือกห้องและรับข้อความจำลอง
- **Rollback:** ปิด integration ของบริษัทหรือ drop trigger/function; ไม่ลบ `attendance_sessions`, `chat_messages` หรือ delivery audit เดิม

## HR Morning Status Summary v1.0 (22/08/2569)

- **Flow:** `docs/HR_MORNING_STATUS_SUMMARY_FLOW.md`
- **ขอบเขต:** สรุปงานค้างของวันก่อนหน้าและความพร้อมข้อมูลพนักงานทุกวัน 07:30 Asia/Bangkok เข้า HR Web Chat
- **Migration:** `202608220003_hr_morning_status_summary.sql`
- **ผลกระทบ:** เพิ่มฟังก์ชัน `publish_hr_morning_status_summary`, cron `wisdomai-hr-morning-status-summary`, และใช้ delivery ledger กลางเดิม
- **การตรวจสอบ:** ตรวจ SQL function/cron, migration smoke, lint/build และตรวจข้อความในห้อง HR
- **Rollback:** unschedule cron/drop function; ไม่ลบข้อความหรือ audit ที่ส่งแล้ว

## ล่าสุด: Chat Attendance Command v1.1 — 21/8/2569

- **เหตุผล:** ให้ช่างเริ่มลงเวลาเข้า/ออกจากห้อง Chat ได้ทั้งการพิมพ์และการพูด โดยมี GPS, Selfie และ confirmation เป็นด่านก่อนบันทึก
- **ผลกระทบ:** `src/pages/Chat/index.tsx`, command parser, Web Speech input และเส้นทางเรียก `attendance-clock`; bridge/Realtime เดิมยังเป็นผู้ส่งผลเข้า HR room
- **Migration:** ไม่มี migration ใหม่; ใช้ `attendance_sessions`, `attendance-selfies` และ bridge schema v1.0 เดิม
- **การตรวจสอบ:** `npm run build`, `npm run lint`, `test:attendance-channel`, `test:attendance-tenant`, `test:communication-event-feed` และตรวจ auth redirect ของ `/chat` ใน browser
- **Rollback:** ปิด command/voice controls ใน Chat; หน้า Time Tracking และ trigger ส่ง log เดิมทำงานต่อได้

## ล่าสุด: Time Tracking → Web Chat Shortcut v1.1 — 21/8/2569

- **เหตุผล:** ให้ผู้ใช้เห็นทางเข้า Web Chat จากหน้าลงเวลาโดยตรง ลดความสับสนระหว่างการลงเวลาแบบฟอร์มกับการพูดคุย/แจ้งลงเวลาผ่าน Chat
- **ผลกระทบ:** `src/pages/TimeTracking/index.tsx`, React Router navigation และ Flow Registry; ไม่เปลี่ยน schema, GPS, Selfie หรือ `attendance-clock`
- **Migration:** ไม่มี
- **การตรวจสอบ:** targeted ESLint หน้า TimeTracking/Chat, Vite build และตรวจว่า route ปลายทางคือ `/chat` ภายใน session เดิม
- **Rollback:** ลบปุ่ม Web Chat และรายการ Flow Registry; การลงเวลาเดิมยังทำงานเหมือนเดิม

## ล่าสุด: Chat Room Create RLS Fix v1.2 — 21/8/2569

- **เหตุผล:** แก้ปุ่มสร้างห้องที่ล้มเหลว เพราะ RLS ไม่ให้ผู้สร้างอ่านห้องก่อนมี owner membership และไม่อนุญาต owner + invitee ใน statement เดียวสำหรับสมาชิกทั่วไป
- **ผลกระทบ:** `src/pages/Chat/index.tsx`, policy `chat_rooms`/`chat_room_members` และขอบเขตอ่านสมาชิกต่อห้อง
- **Migration:** `20260821060000_chat_room_create_rls_fix.sql` + `20260821060001_chat_room_member_read_rls_fix.sql`
- **การตรวจสอบ:** authenticated Supabase rollback transaction สร้างห้องพร้อม owner/invitee สำเร็จ, `npm run build`, `npm run lint` และ `test:chat-attendance-command`
- **Rollback:** revert policy และคืนลำดับ insert เดิม; ไม่ลบห้องหรือสมาชิกที่สร้างไว้แล้ว

## ล่าสุด: Web Chat Dedicated Shell v1.3 — 21/8/2569

- **เหตุผล:** ให้ผู้ใช้เห็นหน้า Web Chat ที่ชัดเจนหลังเข้าใช้งาน และมีทางกลับหน้าลงเวลาแบบไอคอนเดียว ลดความสับสนบนมือถือ
- **ผลกระทบ:** `src/pages/Chat/index.tsx` เปลี่ยน header เป็น Web Chat toolbar; ปุ่มสร้างห้องย้ายไปอยู่ข้างรายการห้อง; เพิ่ม navigation ไป `/time-tracking`
- **Migration:** ไม่มี
- **การตรวจสอบ:** `npm run build`, `npm run lint` และตรวจ route/navigation ของหน้า Chat
- **Rollback:** คืน header/ตำแหน่งปุ่มเดิมได้ โดยไม่กระทบ Chat data, RLS หรือ attendance bridge

## ล่าสุด: Web Chat Read State + Presence v1.4 — 21/8/2569

- **เหตุผล:** ให้ผู้ใช้เห็นห้องที่มีข้อความใหม่ และเห็นสมาชิกออนไลน์/ออฟไลน์แบบ Realtime บนมือถือและเดสก์ท็อป
- **ผลกระทบ:** `src/pages/Chat/index.tsx` แสดง unread badge, จำนวนออนไลน์ และสถานะรายสมาชิก; เพิ่ม Supabase Realtime Presence และ read cursor ต่อผู้ใช้
- **Migration:** `20260821060002_chat_read_states.sql`; ตารางมี RLS 3 policies สำหรับ select/insert/update เฉพาะ cursor ของผู้ใช้ในห้องที่มีสิทธิ์
- **การตรวจสอบ:** ตรวจ schema/RLS บน Supabase, `npm run build`, `npm run lint`, `test:chat-attendance-command`, `test:attendance-channel`, `test:attendance-channel-identity`, `test:attendance-tenant`, `test:communication-event-feed`
- **Rollback:** ถอด listener/indicator และการ mark-read จาก Chat ได้โดยไม่กระทบข้อความเดิม; ลบตาราง cursor เฉพาะเมื่อไม่มี client รุ่นที่ใช้งานอยู่แล้ว

## ล่าสุด: Web Chat Room Rename v1.5 — 21/8/2569

- **เหตุผล:** ให้ room owner หรือ company manager เปลี่ยนชื่อห้องได้จากหน้า Chat โดยไม่สร้างห้องใหม่
- **ผลกระทบ:** `src/pages/Chat/index.tsx` เพิ่มช่องแก้ชื่อใน Dialog จัดการสมาชิกและบันทึกผ่าน mutation attempt เดิม; การแสดงข้อความ/สมาชิก/Presence ใช้ room id เดิม
- **Migration:** `20260821060003_chat_room_rename_owner_rls.sql`; แก้ `chat_rooms` update policy ให้ owner ผ่านทั้ง `USING` และ `WITH CHECK` ภายใต้บริษัทปัจจุบัน
- **การตรวจสอบ:** ตรวจ migration/policy บน Supabase, `npm run lint`, Vite build และตรวจ mutation path ของ rename room
- **Rollback:** ซ่อนช่องแก้ชื่อและ revert policy ได้โดยไม่ลบชื่อที่บันทึกหรือข้อมูลในห้อง

## ล่าสุด: Web Chat Self Presence Indicator v1.6 — 22/8/2569

- **เหตุผล:** ให้ผู้ใช้เห็นสถานะของตัวเองหลังเข้า Web Chat ชัดเจนว่าออนไลน์ เชื่อมต่ออยู่ หรือออฟไลน์
- **ผลกระทบ:** `src/pages/Chat/index.tsx` เพิ่ม status chip บน toolbar และผูกสถานะกับผล `Realtime track`; online map จะเพิ่มตัวเองเมื่อ track สำเร็จเท่านั้น
- **Migration:** ไม่มี; ใช้ channel Presence ของบริษัทเดิม
- **การตรวจสอบ:** `npm run lint`, `npm run build`, `test:chat-attendance-command`, `test:communication-event-feed` และตรวจ subscription/track state path
- **Rollback:** ถอด chip และ state mapping ได้โดยไม่เปลี่ยน Chat data/RLS/attendance bridge

## ล่าสุด: Web Chat Voice Call v1.7 — 22/8/2569

- **เหตุผล:** ให้สมาชิกในห้องโทรเสียง 1 ต่อ 1 กันได้โดยไม่ออกจาก Web Chat
- **ผลกระทบ:** `src/pages/Chat/index.tsx` เพิ่ม directory โทร, สายเข้า, รับ/ปฏิเสธ/ไม่ว่าง, ปิดไมค์, วางสาย และ WebRTC lifecycle; สัญญาณแยก private channel ตามบริษัท/ห้อง และไม่เก็บเสียง/ประวัติสายใน MVP
- **Migration:** `20260821211226_chat_voice_calls_realtime.sql`; เพิ่ม Realtime `SELECT/INSERT` policies ที่ตรวจ `current_company_id()` และสมาชิก/ผู้จัดการของ `chat_rooms` ตาม topic
- **การตรวจสอบ:** ตรวจ policy/advisor บน Supabase, `npm run lint`, `npm run build`, `test:chat-attendance-command`, `test:communication-event-feed` และตรวจ route/auth ของ `/chat` ใน browser
- **Rollback:** ถอดปุ่มและ signaling effect จาก Chat แล้วลบ policies ของ migration ได้; ข้อความ, Presence, unread cursor และ attendance bridge ไม่ได้รับผลกระทบ

## ล่าสุด: Web Chat Compact Workspace v1.8 — 22/8/2569

- **เหตุผล:** หน้า Chat เดิมมีข้อความอธิบายและรายละเอียดซ้ำบนพื้นที่เดียวกัน ทำให้ผู้ใช้เห็นบทสนทนาไม่ชัด โดยเฉพาะบนมือถือ
- **ผลกระทบ:** `src/pages/Chat/index.tsx` ปรับเป็น workspace ที่ยึดข้อความเป็นศูนย์กลาง, ย่อรายการห้องและ action เป็น icon, ให้ข้อความ scroll ภายในกรอบ และซ่อนรายการห้องไว้ใน dialog บนมือถือเมื่อเลือกห้องแล้ว
- **Migration:** ไม่มี; ไม่เปลี่ยน schema, RLS, query, message payload, attendance, Presence หรือ call signaling
- **การตรวจสอบ:** `npx eslint src/pages/Chat/index.tsx`, `npm run test:chat-attendance-command`, `npm run test:communication-event-feed`, `npm run build` และตรวจ route `/chat` ใน browser (หน้าระบบ redirect ไป Login เมื่อไม่มี session)
- **Rollback:** revert เฉพาะ JSX/SX ของหน้า Chat ได้ทันที; ข้อมูลข้อความ, unread cursor, สมาชิก, attendance bridge และ HR delivery คงเดิม

## ล่าสุด: Application Launcher + Web Chat Unread Badge v1.0 — 22/8/2569

- **เหตุผล:** ผู้ใช้ต้องมีจุดเข้าด้านนอกสุดที่เห็น Web Chat และลงเวลาทันที โดยไม่ต้องผ่านปุ่มข้อความหลายชั้น
- **ผลกระทบ:** route `/` แสดง `AppLauncher`, ซ่อน Sidebar บน launcher, แสดงไอคอน Web Chat พร้อม unread badge จาก `chat_rooms`/`chat_room_read_states`/`chat_messages`, ไอคอนลงเวลา และ service `src/services/chatUnread.ts`; index route ไม่ redirect ไป Dashboard/Time Tracking โดยตรง
- **Migration:** ไม่มี schema ใหม่; ใช้ Auth/RLS และ Realtime/30-second refresh เดิม
- **การตรวจสอบ:** targeted ESLint, build, route check, unread query verification และตรวจ browser route `/`/`/chat`
- **Rollback:** คืน index route ไป `LandingRoute` และลบ launcher/service ได้โดยไม่กระทบข้อมูลข้อความหรือ attendance

## ล่าสุด: Web Chat Mobile Attachment MIME v1.9 — 22/8/2569

- **เหตุผล:** รูปจากมือถือที่เป็น HEIC/HEIF หรือ MIME ที่ browser รายงานไม่ครบถูก Storage bucket ปฏิเสธก่อนสร้าง `chat_messages`
- **ผลกระทบ:** normalize MIME จากนามสกุล, ตรวจขนาด/ชนิดไฟล์ก่อน upload, รองรับ HEIC/HEIF/AVIF/TIFF และแสดงข้อความผิดพลาดที่อ่านได้ใน `src/pages/Chat/index.tsx`
- **Migration:** `20260822003747_chat_attachment_mobile_images.sql` ขยาย allow-list bucket `chat-attachments`; bucket ยัง private และ policy สมาชิกห้องเดิม
- **การตรวจสอบ:** query bucket/policy/migration บน Supabase, targeted lint, build และ send-file regression path
- **Rollback:** ลบ MIME ใหม่จาก allow-listและคืน validation เดิมได้; ไฟล์เดิมและข้อความที่ส่งสำเร็จไม่ถูกลบ

## ล่าสุด: Web Chat Mobile File Send Reliability v1.10 — 22/8/2569

- **เหตุผล:** บาง mobile browser ไม่มี `crypto.randomUUID()` หรือเรียกแล้ว throw บน non-secure origin ทำให้เลือกไฟล์แล้วหยุดก่อน upload โดยไม่มีข้อความแจ้งผู้ใช้
- **ผลกระทบ:** `src/pages/Chat/index.tsx` เพิ่ม fallback object id, ตรวจ room/company/session ก่อนส่ง, disable composer เมื่อ auth context ยังไม่พร้อม และแปล Storage error เป็นคำแนะนำเรื่อง MIME/สิทธิ์/เครือข่าย
- **Migration:** ไม่มี; schema, bucket private และ storage.objects policy เดิมใช้ต่อ
- **การตรวจสอบ:** `npm run test:chat-launcher-attachment`, `npm run lint`, targeted ESLint, `npm run build` และตรวจ route `/chat` หลัง Login; ต้องทดสอบ upload จริงด้วยบัญชีสมาชิกห้องบนมือถือ
- **Rollback:** revert helper/guard/error mapping ใน Chat ได้โดยไม่ลบไฟล์หรือข้อความที่ส่งสำเร็จแล้ว

## ล่าสุด: Web Chat Room Selection + Realtime Auth v1.11 — 22/8/2569

- **เหตุผล:** ระหว่างเลือกไฟล์ในห้อง Error มีการ refresh/subscribe ใหม่ แล้ว state กลับไปห้องแรก (HR); logs ยังพบ Realtime websocket `401` เพราะ channel เปิดก่อนส่ง access token
- **ผลกระทบ:** `src/pages/Chat/index.tsx` เรียก `supabase.realtime.setAuth(accessToken)` ก่อน subscribe, gate channels จน auth พร้อม และจำ/restore room id ใน `sessionStorage` ต่อ company/profile
- **Migration:** ไม่มี; ไม่เปลี่ยน RLS, Storage policy หรือข้อมูลข้อความ
- **การตรวจสอบ:** `npm run test:chat-launcher-attachment`, targeted ESLint, `npm run lint`, `npm run build`; หลัง deploy ต้องตรวจ API log ว่า websocket ไม่เป็น `401` และลองแนบไฟล์ในห้อง Error จริง
- **Rollback:** revert auth gate/persistence ได้ทันที; ไม่ลบห้อง สมาชิก ข้อความ หรือไฟล์

## ล่าสุด: Time Tracking Icon Entry v1.2 — 22/8/2569

- **เหตุผล:** ลดความรกของปุ่มทางลัดบนมือถือและทำให้ Web Chat/ลงเวลาใช้ภาษาภาพเดียวกับ Application Launcher
- **ผลกระทบ:** `TimeTracking` และ `TopBar` ใช้ไอคอนพร้อม tooltip/aria-label แทนปุ่มข้อความ; ไม่เปลี่ยน attendance flow
- **Migration:** ไม่มี
- **การตรวจสอบ:** targeted lint, build และตรวจ route/navigation ภายใน Auth session
- **Rollback:** คืนปุ่มข้อความเดิมได้ทันทีโดยไม่กระทบ attendance data

## ล่าสุด: Advance Holder Name-only Learning v1.3 — 21/8/2569

- **เหตุผล:** ลดภาระ Admin ให้ลงทะเบียนผู้ถือเงินสำรองจ่ายด้วยชื่อพนักงานรายเดือนเพียงอย่างเดียว โดยใช้ข้อมูลบัญชีจากสลิปเป็นหลักฐาน และเรียนรู้ชื่อภาษาอังกฤษ/ชื่อสะกดต่างกันหลัง Admin ยืนยันครั้งแรก
- **ผลกระทบ:** `AdvanceHolders`, Financial Summary, `employee_advance_holders`, alias registry และเส้นทางสร้างเงินสำรองจ่ายฉบับร่างจากสลิป; ไม่มีการอนุมัติหรือบันทึกจ่ายอัตโนมัติ
- **Migration:** `20260821053404_simplify_advance_holder_learning.sql`; เปลี่ยนช่องบัญชีเป็น optional, เพิ่ม RPC name-only และให้การยืนยันผู้ถือเงินบันทึก alias พร้อม reprocess สลิปย้อนหลังผ่าน trigger เดิม
- **การตรวจสอบ:** ตรวจ schema/function/สิทธิ์ trigger, TypeScript, lint, build, pipeline test และตรวจหน้า protected route หลัง deploy
- **Rollback:** ปิด auto-match/reprocess trigger หรือซ่อน UI; ชื่อ alias, หลักฐานสลิป, audit และ draft เดิมคงอยู่เพื่อตรวจสอบ

## ล่าสุด: Advance Case Auto Projection v1.4 — 21/8/2569

- **เหตุผล:** เมื่อระบบสร้างหรือ Admin ยืนยันเงินสำรองจ่าย ต้องเห็นวิธีจับคู่, ความครบของสลิป และเส้นทางเอกสารทันที โดยไม่ต้องไล่ค้นหลายหน้า
- **ผลกระทบ:** หน้า `AdvanceSettlements` เพิ่มคอลัมน์ข้อมูลอัตโนมัติ และ Drawer แสดงสลิปต้นทาง, current flow และ Timeline; ไม่มีการแก้ค่าจาก OCR หรือยอดปิดยอดเดิม
- **Migration:** ไม่มี; อ่านข้อมูลจาก `employee_advance_cases`, `financial_transactions`, `document_flow_items` และ `employee_advance_audit` ที่เป็นศูนย์กลางเดิม
- **การตรวจสอบ:** TypeScript, lint, build, document-pipeline test และเปิด protected production route
- **Rollback:** ซ่อนคอลัมน์และส่วน Drawer ใหม่; ข้อมูลต้นทาง, audit, case และ route ไม่ถูกลบ

## ล่าสุด: Advance Holder Navigation v1.2 — 21/8/2569

- **เหตุผล:** ทะเบียนผู้ถือเงินสำรองจ่ายมี route แล้วแต่ไม่มีเมนูซ้าย ทำให้ผู้ใช้หาไม่พบ
- **ผลกระทบ:** Navigation registry และ Sidebar เพิ่ม `การเงินและบัญชี → ทะเบียนผู้ถือเงินสำรองจ่าย` สำหรับ Admin/Manager; route และสิทธิ์เดิมไม่เปลี่ยน
- **Migration:** ไม่มี
- **การตรวจสอบ:** lint, build และเปิด protected production route
- **Rollback:** ลบ navigation item/icon; route `/advance-holders` และข้อมูลทะเบียนเดิมคงอยู่

## ล่าสุด: Advance Holder Title-normalized Auto Route v1.5 — 21/8/2569

- **เหตุผล:** สลิปใช้คำนำหน้า `นาย/นาง/น.ส.` แต่ทะเบียนเก็บชื่อไม่มีคำนำหน้า ทำให้ชื่อคนเดียวกันไม่ match และไม่สร้างเงินสำรองจ่ายอัตโนมัติ
- **ผลกระทบ:** กติกา central auto-match และ reprocess สลิปย้อนหลัง; ไม่มีการแก้สลิปต้นทาง, OCR, ยอด, หรือการอนุมัติ/จ่ายเงินจริง
- **Migration:** `20260821071722_normalize_advance_holder_titles.sql` และ hotfix `20260821072004_fix_advance_holder_name_regex.sql`; normalize ชื่อให้ตัดคำนำหน้า/ช่องว่าง และ reprocess ด้วยกติกา idempotent เดิม
- **การตรวจสอบ:** normalize `นาย ทวีชัย ภรามร` ตรงกับชื่อทะเบียน, ตรวจ trigger/สิทธิ์ และพบ draft advance ใหม่ 4 เคส มูลค่า 52,922.39 บาท
- **Rollback:** ปิด auto-match/reprocess; คงสลิป, timeline, audit และ draft case เดิมไว้ตรวจสอบ

## ล่าสุด: HR Chat Work Event Stream v2.0 — 22/8/2569

- **เหตุผล:** ผู้ใช้ต้องการให้ “รายการแจ้งเวลา”, “รายการแจ้งออก” และ “งาน HR อื่น ๆ ทั้งหมด” ส่งข้อความเข้าห้อง HR กลาง เพื่อให้ทีมเห็นงานที่ต้องทำทันทีจากจุดเดียว
- **ผลกระทบ:** `docs/CHAT_ATTENDANCE_BRIDGE_FLOW.md`, `docs/WORKFORCE_BACKBONE_FLOW.md`, `src/pages/FlowRegistry/index.tsx`, `chat_hr_delivery_events`, delivery function/retry และ trigger จาก leave/correction/OT/document/lifecycle/resignation; attendance bridge เดิมยังทำงานเหมือนเดิม
- **Migration:** `202608220001_hr_chat_work_event_stream.sql`
- **การตรวจสอบ:** migration contract test, Supabase schema/function/trigger verification, `npm run lint`, `npm run build`, และตรวจหน้า `/chat`/`/flow-registry`
- **Rollback:** drop trigger/function/table `chat_hr_delivery_events` ได้โดยไม่ลบ `chat_messages`, `attendance_sessions` หรือข้อมูล HR ต้นทาง; ปิด integration ห้อง HR ได้ทันทีหากต้องหยุดข้อความใหม่

## ล่าสุด: Omni Channel Intake / OutTake v1.0 — 22/8/2569

- **เหตุผล:** LINE และ Web Chat ต้องเป็นทั้ง Intake/OutTake ได้ตาม config กลาง พร้อมแก้ปัญหา LINE ปลายทางเต็ม และกันเอกสาร/ข้อความซ้ำจากสองช่องทางก่อนส่งปลายทาง
- **ผลกระทบ:** `docs/OMNI_CHANNEL_INTAKE_OUTTAKE_FLOW.md`, `docs/INTAKE_CASE_FLOW.md`, `src/pages/FlowRegistry/index.tsx`, ตาราง `omni_channel_routes`, `omni_intake_sources`, `omni_filter_tasks`, `omni_outtake_delivery_events`, trigger จาก `line_messages` และ `chat_messages`
- **Migration:** `202608220002_omni_channel_intake_outtake.sql`
- **การตรวจสอบ:** migration contract test, Supabase schema/trigger verification, `npm run lint`, `npm run build`, และตรวจหน้า Flow Registry/Document Flow
- **Rollback:** ปิด trigger `omni_register_line_message_after_insert` และ `omni_register_chat_message_after_insert`; ข้อมูล LINE, Web Chat และ Document Flow เดิมไม่ถูกลบ

## ล่าสุด: Omni Filter UI v1.1 — 22/8/2569

- **เหตุผล:** Admin/Filter ต้องเห็นข้อมูลที่ศูนย์กลาง Omni วิเคราะห์และส่งต่อแล้วบนหน้าโปรแกรมจริง
- **ผลกระทบ:** `src/pages/DocumentFlows/index.tsx` เพิ่มแท็บ `Omni Filter`; `src/services/documentFlowGateway.ts` เพิ่ม gateway อ่าน `omni_filter_tasks` พร้อม source registry
- **Migration:** ไม่มี schema ใหม่เพิ่มเติมจาก `202608220002_omni_channel_intake_outtake.sql`
- **การตรวจสอบ:** migration contract test, lint, build และตรวจหน้า `/document-flows`
- **Rollback:** ซ่อนแท็บ `Omni Filter` และหยุดเรียก `loadOmniFilterTasks`; registry/trigger backend ยังทำงานต่อโดยไม่กระทบ workflow เดิม

## ล่าสุด: Advance Detail Drawer v1.6 — 22/8/2569

- **เหตุผล:** ผู้ใช้ต้องเปิดดูว่าเงินทดรองแต่ละยอดถูกจ่ายอะไรบ้างจากแถวหรือตัวเลขยอดเงิน โดยไม่เสียบริบทของตาราง
- **ผลกระทบ:** `AdvanceSettlements` เปลี่ยนรายละเอียดเคสจาก Dialog กลางเป็น Drawer ด้านขวา; ยอดรับมา, ใช้จ่ายอนุมัติ และคงค้างกดเปิดรายละเอียดเดียวกันได้
- **Migration:** ไม่มี; อ่าน `employee_advance_cases`, `employee_advance_settlement_items`, `financial_transactions`, route และ audit กลางเดิมเท่านั้น
- **การตรวจสอบ:** TypeScript, lint, build, document-pipeline test, deploy และตรวจ protected production route
- **Rollback:** คืน Dialog เดิมได้ทันที; ไม่เปลี่ยนยอด, รายการจ่าย, route, สิทธิ์ หรือ audit

## ล่าสุด: Master Data Governance v1.0 — 22/8/2569

- **เหตุผล:** ข้อมูลบุคคล ผู้ขาย ลูกค้า โครงการ งานย่อย และบัญชีธนาคารต้องใช้ซ้ำข้าม Module โดยไม่ให้ AI เขียนทับข้อมูลที่ยืนยันแล้ว หรือปล่อยข้อมูลรอตรวจค้างถาวร
- **ผลกระทบ:** เพิ่มศูนย์ข้อมูลกลาง `/master-data`, candidate inbox, account evidence registry, customer master, audit และกติกา archive; employee/vendor/project/work package เดิมยังเป็น source-of-truth
- **Migration:** `20260821211435_master_data_governance.sql`; สลิปโอนที่พบชื่อผู้รับและเลขท้ายบัญชีสร้าง candidate อัตโนมัติ, Admin/Manager ยืนยันหรือปฏิเสธผ่าน RPC กลาง
- **การตรวจสอบ:** apply migration, RLS/RPC/schema query, TypeScript, lint, build, document-pipeline test, deploy และตรวจ protected production route
- **Rollback:** ปิด UI/trigger/RPC ใหม่ได้โดยไม่ลบสลิป, master เดิม, candidate, account evidence หรือ audit ที่เกิดแล้ว

## ล่าสุด: Master Bank Account Person Link v1.1 — 22/8/2569

- **เหตุผล:** บัญชีที่ยืนยันจากสลิปต้องเป็นข้อมูลใช้งาน/ตรวจสอบในทะเบียนพนักงานหรือช่าง ไม่ใช่เพียงชื่อที่แยกขาดจากบุคคล
- **ผลกระทบ:** การ approve candidate บัญชีจะผูก `profile_id` หรือ `employee_person_id` เฉพาะเมื่อพบชื่อ normalized ที่ active ตรงกันเพียงคนเดียว; ชื่อคลุมเครือคง unlinked เพื่อให้ Admin ตัดสินใจ
- **Migration:** `20260821212940_master_bank_account_person_link.sql`
- **การตรวจสอบ:** function/backfill, RLS/schema, TypeScript, lint, build, pipeline test และ production route
- **Rollback:** คืน function review ก่อนหน้าได้ โดยไม่ลบ account evidence, candidate, person หรือ audit

## ล่าสุด: Employee Intake Approval and Attachment Registry v1.9 — 22/8/2569

- **เหตุผล:** คำสั่งอนุมัติ New Employee เดิมอาจสร้าง `employee_people` สำเร็จ แต่ค้าง `employee_intakes.status=pending_review`; การกดซ้ำตอบสำเร็จโดยไม่ซ่อมสถานะ และ HR ไม่เห็นว่าเอกสารใดแนบมากับพนักงาน
- **ผลกระทบ:** HR Intake approval, Employee Master, Employee page registry, private attachment references และ Workforce Audit
- **Migration:** `20260822001621_employee_intake_approval_document_link.sql` เพิ่ม `employee_person_documents`, ปรับ RPC ให้ idempotent แบบซ่อมสถานะ และ reconcile ข้อมูลเดิม
- **การตรวจสอบ:** Apply migration, ตรวจ Intake/Employee/attachment link/audit จริง, RLS/function privilege, deploy Function, TypeScript/lint/build และตรวจหน้า `/employees`
- **Rollback:** ซ่อน registry และคืน RPC ก่อนหน้าได้โดยไม่ลบ Employee Master, Intake, Audit หรือไฟล์ต้นฉบับ

## ล่าสุด: End-to-End Completion Gate v1.0 — 22/8/2569

- **เหตุผล:** ป้องกันการส่งมอบที่เสร็จเพียงปุ่ม, API หรือสถานะจุดเดียว แต่ข้อมูลไม่ไปถึงคิวปลายทาง ผู้รับผิดชอบไม่เห็นงาน หรือข้อมูลเดิมค้างไม่สอดคล้องกัน
- **ผลกระทบ:** เป็นมาตรฐานบังคับใช้ทุก Module: ต้องตรวจต้นทาง → validation → data write → state → destination/owner → UI → audit/retry/recovery และรายงาน blocker เชิงรุกพร้อมหลักฐาน
- **Migration:** ไม่มี; ไม่เปลี่ยน schema หรือข้อมูล runtime
- **การตรวจสอบ:** อ่านและบันทึกใน `AGENTS.md`, `docs/END_TO_END_CHANGE_EXECUTION_STANDARD.md`; รัน TypeScript, lint, build และ test ที่เกี่ยวข้อง
- **Rollback:** ย้อนข้อความมาตรฐานได้โดยไม่กระทบข้อมูล ระบบ หรือ Flow runtime

## ล่าสุด: HR Intake Approved Exit to Onboarding v3.5 — 22/8/2569

- **เหตุผล:** HR Intake ที่อนุมัติแล้วเคยยังถูก query และนับเป็น Intake ทำให้ผู้ใช้เห็นว่ารายการไม่ย้ายห้อง แม้ Employee Master ถูกสร้างแล้ว
- **ผลกระทบ:** Intake Room และ Main Tap นับเฉพาะสถานะที่ยังต้องดำเนินการ; รายการอนุมัติไปคิว HR Onboarding ผ่าน `employee_people.employee_status=preboarding` ที่หน้าพนักงาน
- **Migration:** `20260822005245_employee_intake_approved_exit_to_onboarding.sql` ปรับ central queue count และ reconcile legacy partial approvals แบบ idempotent
- **การตรวจสอบ:** apply migration, ตรวจ count/query ก่อน-หลัง, ตรวจว่า approved ไม่อยู่ Intake แต่ปรากฏใน Employee HR Onboarding, TypeScript/lint/build/employee-intake test และหน้าจอจริง
- **Rollback:** คืน central count/query ให้รวม approved ได้; ไม่ลบ Employee Master, เอกสารต้นทาง หรือ audit

## ล่าสุด: Supabase Migration Governance v1.0 — 22/8/2569

- **เหตุผล:** พบ history บน Production กับไฟล์ migration ในโครงการไม่ตรงกัน ทำให้ `supabase db push` ปฏิเสธงานใหม่ แม้ schema หลายส่วนมีอยู่จริงแล้ว
- **ผลกระทบ:** เพิ่ม Flow มาตรฐานและ Flow Registry card สำหรับการเทียบ local/remote history, schema evidence, historical no-op marker และ repair แบบปลอดภัย
- **Migration:** ไม่มี business schema ใหม่; ใช้ marker สำหรับ remote-only history และ mark applied เฉพาะ migration local ที่ยืนยัน schema บน Production แล้ว
- **การตรวจสอบ:** `supabase migration list --linked`, schema/function/policy query, `supabase db push --dry-run`, TypeScript/lint/build และตรวจหน้า Flow Registry
- **Rollback:** ลบ marker ใน local repository ได้; ห้าม revert remote history หรือ schema โดยไม่มี backup/หลักฐาน schema

## ล่าสุด: Attendance Approval MSG v3.3 — 23/8/2569

- **เหตุผล:** รายการลงเวลาที่ระบบตรวจพบต้องแจ้ง HR ผ่าน MSG จุดกลาง พร้อมให้รับงานและตัดสินใจได้ โดยไม่สร้างรายการลงเวลาซ้ำจากข้อความยืนยันระบบ
- **ผลกระทบ:** `chat_attendance_approval_jobs` เพิ่มสถานะการส่ง/ผู้รับ/เวลารับงาน, `chat_messages.message_class`, delivery projection และ Omni trigger; `attendance_sessions` ยังเป็น source of truth
- **Migration:** `20260823031549_web_chat_attendance_approval_jobs.sql` (Production baseline); เพิ่ม RLS/metadata, System Confirmation MSG และ fallback `pending_send` เมื่อไม่มี HR recipient
- **การตรวจสอบ:** migration contract/static checks, TypeScript, targeted lint, build และ UAT หน้า `/chat` ภายใต้ session ผู้จัดการ; ตรวจสถานะ pending_send/send_failed/sent, claim จาก decision และ audit
- **Rollback:** ปิด trigger/metadata projection และคืน UI approval เดิมได้โดยไม่ลบ `attendance_sessions`, `chat_messages`, jobs หรือ audit; System Confirmation ยังคงค้นย้อนหลังได้

- **Program Loop boundary:** ปลายทางภายในระบบใช้ห้องต้นทาง/ห้องงาน, HR หลัก และห้องเงินสำรองจ่ายตาม config กลาง โดยใช้ `request_code/event_key` เดิมทุกจุด; ห้อง 00 ของ Codex ไม่ใช่ Web Chat destination และต้องไม่มี duplicate notification ไปที่นั่น
# Latest changes (23/08/2569)

- HR Confirmation Bundle trigger hardening v1.1: added a safe wrapper trigger for `chat_attendance_approval_jobs` and enriched the local HR fixture/omni projection with classification reason/rule/model metadata. Migration remains local-only; rollback restores the direct trigger call and removes the added fixture metadata while preserving raw/audit history.

- Intake AI Reprocess and Classification Audit v3.8: added append-only classification history and reprocess batch accounting, with confidence-gated routing to Filter/Accounting and held/failed retry states. Migration `20260823050000_intake_ai_reprocess_audit.sql`; source function `supabase/functions/reprocess-transfer-slips/index.ts`. Raw sources and prior classifications remain unchanged; rollback is to disable the Edge Function and stop invoking batches.

- Flow Registry Active Dashboard v1.0: added `docs/FLOW_REGISTRY_DASHBOARD_FLOW.md`, read-only runtime source aggregation, filters, refresh, nodes, exception lane, and drill-down. No migration; rollback is UI/service removal.
- General Work Room v1.0: added `docs/GENERAL_WORK_ROOM_FLOW.md` and Production baseline migration `20260823035220_general_work_room.sql`; canonical `general_work_primary`, company-scoped membership, safe classification/forwarding, audit, and pending destination retry path.
- Advance Confirmation RPC hardening v1.1: Production applied `20260823041021_lock_advance_confirmation_room_rpc`; `ensure_advance_confirmation_room` now requires a manager when called with an authenticated session, and `EXECUTE` is revoked from `PUBLIC`/`anon` (retained for `authenticated`/`service_role`). Verify with the privilege query and retain the existing no-fallback room/audit/retry flow.
- Program Development Command Inbox v1.1: add owner-only Action Cards in `/chat` for `program_development_primary`, task status transitions, Codex/developer dispatch, result drill-down, and System Result guard. Migration `20260823050000_program_development_actions.sql` adds the idempotent owner-checked dispatch RPC; rollback hides the cards and revokes the action RPC while retaining tasks/audit/messages.

- Accounting Pending Queue v1.1 (23/8/2569): `/accounting-documents` now reads pending transfer-slip work from the existing accounting destination task projection and joins the source flow item/financial transaction for display. This is read-only UI behavior; no migration, raw overwrite, reprocess, or new task creation. Verify with Production count reconciliation, typecheck/lint/build, and authenticated page smoke. Rollback is removing the pending queue projection while leaving source items, tasks, financial transactions, and audit history intact.

- Accounting Transfer Slip Queue v1.2 (23/8/2569): `/accounting-documents` separates transfer slips from general accounting documents, reconciles status filter counts from one projection, and opens source files plus audit timeline in an isolated Drawer. Duplicate/system/non-slip records are excluded from the main slip count; no schema, task, raw source, or audit mutation is introduced. Rollback removes the view/helper only.

- Accounting Transfer Slip Queue v1.2.1 (23/8/2569): authenticated Production smoke corrected the duplicate projection to the existing `financial_transactions.duplicate_of` column. This restores transaction details/counts without schema or data mutation; rollback the whole v1.2 queue view rather than restoring the invalid column name.

- Accounting Transfer Slip Drawer Review v1.3 (23/8/2569): added a two-tab source/AI and manual-review Drawer. AI re-read is scoped by `document_flow_items.id`, preserves the Accounting route, and records model/rule/guidance audit; Admin corrections use the company-guarded idempotent `review_transfer_slip_details` RPC with required-field validation and before/after audit. Migration `20260823110613_transfer_slip_drawer_review.sql`; rollback disables the actions/RPC and restores the prior Edge Function while preserving raw source and audit history.
