# TIME TRACKING FLOW — ลงเวลาทำงานและทางเข้า Web Chat

```mermaid
flowchart LR
  A[Login สำเร็จ] --> B{ตรวจอุปกรณ์และบทบาท}
  B -->|มือถือ| C[เปิด / Launcher]
  B -->|คอม + admin/manager| D[เปิด /dashboard รวม]
  B -->|คอม + employee| E[เปิด /my-profile]
  C --> U[อ่าน Web Chat unread<br/>ตามสมาชิกห้อง + read state]
  U --> U1[Badge ใน Launcher<br/>และไอคอน PWA เมื่อรองรับ]
  C --> C1{เลือกเมนู}
  C1 -->|ลงเวลา| F[ตรวจ GPS + Selfie + ยืนยัน]
  C1 -->|Web Chat| I[เปิด /chat]
  F --> G[attendance-clock]
  G --> H[attendance_sessions]
  D --> J[เปิด Web Chat จาก Sidebar]
  E --> J
  I --> K[/chat ภายใน Auth session เดิม]
  J --> K
  H --> L[HR Chat Bridge เมื่อเปิด integration]
```

กราฟนี้แสดงจุดเข้าหลักหลัง Login: ระบบตรวจอุปกรณ์และบทบาทก่อนเลือกหน้าเริ่มต้น โดยมือถือเข้า `/` Launcher ที่มีปุ่มระดับเดียวกัน 2 ปุ่มคือ ลงเวลา (`/time-tracking`) และ Web Chat (`/chat`) พร้อมจำนวนข้อความที่ยังไม่ได้อ่าน; หน้าลงเวลามือถือโฟกัสเฉพาะสถานะวันนี้, GPS, ไซต์, Selfie และปุ่มเข้า/ออก โดยไม่วางปุ่ม Web Chat ซ้ำภายในหน้า การลงเวลายังคงตรวจสอบผ่าน `attendance-clock` ก่อนเขียน `attendance_sessions`

## วัตถุประสงค์

ให้พนักงานบันทึกเวลาเข้า/ออกด้วย GPS และ Selfie จากหน้า Time Tracking ที่กระชับ ใช้มือเดียวได้ และเห็นเวลาเข้า–ออกของวันนี้ โดยแยกทางเข้า Web Chat ไว้ที่ Launcher เพื่อไม่ให้ไอคอนซ้อนกัน

## Inputs / Outputs

- **Input:** บริษัทปัจจุบัน, ผู้ใช้ที่ Login แล้ว, ไซต์ที่ได้รับมอบหมาย, GPS, Selfie และ action `clock_in|clock_out`
- **Output:** `attendance_sessions`, สถานะ `normal|needs_review|failed`, ประวัติลงเวลา และข้อความระบบในห้อง HR เมื่อเปิด bridge
- **Navigation input:** device signals (`userAgent`, viewport, touch/coarse pointer), effective profile role, requested path และทางลัด Web Chat
- **Navigation output:** มือถือไป `/` Launcher แล้วเลือก `/time-tracking` หรือ `/chat`; Launcher แสดง unread badge ภายในทุกอุปกรณ์ และซิงก์ badge ไปไอคอน PWA เมื่อ Badging API รองรับ; คอม `admin/manager` ไป `/dashboard`; คอม `employee` ไป `/my-profile`
- **Mobile attendance output:** แสดงชื่อพนักงาน, วันที่/เวลาปัจจุบัน, สถานะวันนี้, ความพร้อม GPS/ไซต์/Selfie, ปุ่มเข้า–ออกหนึ่งปุ่ม และเวลาเข้า–ออกวันนี้ โดยไม่เปลี่ยน payload การบันทึก

## States

`ready → location_checked → selfie_captured → awaiting_confirmation → recording → recorded|needs_review|failed`

Web Chat และ Time Tracking แยกเป็นปลายทางระดับเดียวกันจาก Launcher; การเข้า Time Tracking ไม่สร้างหรือเปลี่ยน read state ของ Chat

## Roles / Permissions

- พนักงานที่มี active company membership ใช้ลงเวลาของตนเองและเปิด Web Chat ตามสิทธิ์ห้อง
- ผู้จัดการ/ผู้ดูแลบริษัทตั้งค่านโยบาย GPS และไซต์ได้ตาม RLS เดิม
- Backend `attendance-clock` ตรวจบริษัท, employment, assignment, GPS, Selfie และ duplicate ซ้ำก่อนเขียนข้อมูล

## Integrations

- Time Tracking UI → Supabase Storage `attendance-selfies`
- Time Tracking UI → Edge Function `attendance-clock`
- `attendance_sessions` → Chat Attendance Bridge → ห้อง HR ผ่าน `chat_room_integrations`
- App Launcher → `chat_room_members` + `chat_room_read_states` + `chat_messages` → unread badge
- App Launcher → Web Badging API (`setAppBadge`/`clearAppBadge`) เฉพาะ installed PWA/อุปกรณ์ที่รองรับ

## Failure / Retry

- ไม่มีบริษัท/ไซต์/สิทธิ์: หยุดก่อนบันทึกและแสดงข้อความแก้ไข
- GPS/กล้อง/อัปโหลด/Edge Function ล้มเหลว: ไม่สร้าง attendance ที่ไม่สมบูรณ์ และให้เริ่มขั้นตอนใหม่
- โหลดจำนวน Chat ไม่สำเร็จ: ล้างเลขที่อาจเก่า, แสดงคำเตือน และ retry ทุก 30 วินาที/Realtime; ไม่กระทบการลงเวลา
- อุปกรณ์ไม่รองรับ PWA Badging API หรือ OS ปฏิเสธ: badge ภายใน Launcher ยังทำงาน และไม่บล็อกการใช้งาน
- การส่ง Log HR ล้มเหลวไม่ทำให้ `attendance_sessions` ต้นทางล้มเหลว; bridge เก็บ retry ledger แยก

## Audit / Owner

- Audit การลงเวลาผ่าน `mutation_attempts` และ attendance audit เดิม
- การเปิด Web Chat เป็น navigation event ของ client ไม่ส่งข้อมูลส่วนตัวเพิ่ม
- Owner: พนักงานดูแลการยืนยันรายการของตนเอง; HR/ผู้จัดการดูแลนโยบายและตรวจรายการ; ทีมระบบดูแล route และ bridge

## Change Record

### v1.1 — 21/8/2569

- เหตุผล: เพิ่มทางลัด Web Chat บนหน้าลงเวลา ลดความสับสนระหว่างการลงเวลาแบบฟอร์มกับการพูดคุย
- ผลกระทบ: เพิ่มปุ่มนำทางจาก `src/pages/TimeTracking/index.tsx` ไป `/chat`; ไม่เปลี่ยน schema หรือวิธีบันทึกเวลา
- Migration: ไม่มี
- Verification: targeted lint, Vite build และตรวจ route ผ่าน React Router
- Rollback: ลบปุ่ม/route link ได้โดยไม่กระทบ `attendance_sessions` หรือ `attendance-clock`

### v1.2 — 22/8/2569

- เหตุผล: รวมทางเข้า Web Chat และลงเวลาไว้ที่ Application Launcher และลดปุ่มข้อความบนมือถือให้เป็นไอคอน
- ผลกระทบ: route `/` แสดงไอคอน Web Chat/ลงเวลา, `TimeTracking` เปลี่ยนทางลัด Web Chat เป็นไอคอนพร้อม tooltip; วิธีตรวจ GPS/Selfie และบันทึก attendance ไม่เปลี่ยน
- Migration: ไม่มี
- Verification: targeted ESLint, Vite build, route check และตรวจว่า launcher ใช้ Auth session เดิม
- Rollback: เปลี่ยน index route กลับไป post-login destination เดิมและคืนปุ่มข้อความได้ โดยไม่กระทบ attendance data

### v1.3 — 23/8/2569

- เหตุผล: ลดขั้นตอนหน้าเลือกเมนู โดยให้ระบบเลือกหน้าเริ่มต้นจากอุปกรณ์และบทบาทที่ตรวจได้
- ผลกระทบ: `authRouting`, `ProtectedRoute`, `Login`, `AppLauncher` และเส้นทางเข้า `/dashboard`, `/my-profile`, `/time-tracking`; ไม่เปลี่ยน GPS, Selfie, `attendance-clock` หรือ `attendance_sessions`
- Migration: ไม่มี
- Verification: auth-routing test, lint, build และตรวจ route guard บนมือถือ/คอม
- Rollback: คืน `getPostLoginDestination` ให้ส่ง `/` และยกเลิก effect redirect ใน AppLauncher; attendance data ไม่ได้รับผลกระทบ

### v1.4 — 23/8/2569

- เหตุผล: คืนหน้า Launcher บนมือถือหลัง Login เพื่อให้ผู้ใช้เลือกลงเวลาหรือ Web Chat ได้โดยตรง และไม่ต้องหาไอคอนซ้อนภายในหน้าอื่น
- ผลกระทบ: `getPostLoginDestination` ส่งมือถือไป `/`; AppLauncher แสดงปุ่ม Web Chat และลงเวลาแยกกันระดับเดียวกัน; flow GPS/Selfie และข้อมูล attendance ไม่เปลี่ยน
- Migration: ไม่มี
- Verification: auth-routing/launcher contract test, lint, build และตรวจ route `/` บน mobile viewport
- Rollback: เปลี่ยน mobile destination กลับ `/time-tracking` ได้ โดยไม่ลบข้อมูลลงเวลา ห้องแชต หรือ audit

### v1.6 — 31/8/2569

- เหตุผล: ให้พนักงานเห็นข้อมูลสำคัญของการลงเวลาในจอเดียวและเห็นจำนวน Web Chat ค้างตั้งแต่ Launcher โดยไม่ใช้ไอคอนซ้อนในหน้าลงเวลา
- ผลกระทบ: `/time-tracking` บนมือถือเพิ่ม status/time/readiness/today summary และปุ่มหลักหนึ่งปุ่ม; `/` แสดง unread text/badge และซิงก์ PWA badge เมื่อรองรับ; desktop settings, GPS/Selfie, `attendance-clock`, `attendance_sessions`, RLS และ Audit เดิมไม่เปลี่ยน
- Migration: ไม่มี
- Verification: launcher/attachment contract, attendance tests, typecheck, lint, build และ authenticated mobile smoke ที่ `/` กับ `/time-tracking`
- Rollback: revert UI และ `appBadge` service; ข้อมูล Chat/read state/attendance/Selfie/Audit เดิมไม่ถูกแก้หรือลบ
