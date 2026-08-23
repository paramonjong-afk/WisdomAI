# TIME TRACKING FLOW — ลงเวลาทำงานและทางเข้า Web Chat

```mermaid
flowchart LR
  A[Login สำเร็จ] --> B{ตรวจอุปกรณ์และบทบาท}
  B -->|มือถือ| C[เปิด / Launcher]
  B -->|คอม + admin/manager| D[เปิด /dashboard รวม]
  B -->|คอม + employee| E[เปิด /my-profile]
  C --> C1{เลือกเมนู}
  C1 -->|ลงเวลา| F[ตรวจ GPS + Selfie + ยืนยัน]
  C1 -->|Web Chat| I[เปิด /chat]
  F --> G[attendance-clock]
  G --> H[attendance_sessions]
  C --> I[กด Web Chat จากทางลัด]
  D --> J[เปิด Web Chat จาก Sidebar]
  E --> J
  I --> K[/chat ภายใน Auth session เดิม]
  J --> K
  H --> L[HR Chat Bridge เมื่อเปิด integration]
```

กราฟนี้แสดงจุดเข้าหลักหลัง Login: ระบบตรวจอุปกรณ์และบทบาทก่อนเลือกหน้าเริ่มต้น โดยมือถือเข้า `/` Launcher ที่มีปุ่มระดับเดียวกัน 2 ปุ่มคือ ลงเวลา (`/time-tracking`) และ Web Chat (`/chat`), คอมพิวเตอร์ที่เป็นผู้ดูแล/ผู้จัดการเข้า Dashboard รวม และพนักงานเข้า `/my-profile`; การลงเวลายังคงตรวจสอบผ่าน `attendance-clock` ก่อนเขียน `attendance_sessions`

## วัตถุประสงค์

ให้พนักงานบันทึกเวลาเข้า/ออกด้วย GPS และ Selfie จากหน้า Time Tracking ได้ตามเดิม พร้อมมีทางลัดไป Web Chat เพื่อพูดคุยหรือแจ้งลงเวลาผ่านคำสั่งเสียง/ข้อความ โดยใช้บัญชีและ `attendance_sessions` ชุดเดียวกัน

## Inputs / Outputs

- **Input:** บริษัทปัจจุบัน, ผู้ใช้ที่ Login แล้ว, ไซต์ที่ได้รับมอบหมาย, GPS, Selfie และ action `clock_in|clock_out`
- **Output:** `attendance_sessions`, สถานะ `normal|needs_review|failed`, ประวัติลงเวลา และข้อความระบบในห้อง HR เมื่อเปิด bridge
- **Navigation input:** device signals (`userAgent`, viewport, touch/coarse pointer), effective profile role, requested path และทางลัด Web Chat
- **Navigation output:** มือถือไป `/` Launcher แล้วเลือก `/time-tracking` หรือ `/chat`; คอม `admin/manager` ไป `/dashboard`; คอม `employee` ไป `/my-profile`; Web Chat ไป `/chat` ภายใน session เดิม โดยไม่ส่งข้อมูล GPS/Selfie ผ่าน URL

## States

`ready → location_checked → selfie_captured → awaiting_confirmation → recording → recorded|needs_review|failed`

การกด `Web Chat` ไม่เปลี่ยน state ของ attendance และไม่ยกเลิกข้อมูลที่กำลังกรอกอยู่ในหน้าเดิมหากผู้ใช้นำทางออกเอง

## Roles / Permissions

- พนักงานที่มี active company membership ใช้ลงเวลาของตนเองและเปิด Web Chat ตามสิทธิ์ห้อง
- ผู้จัดการ/ผู้ดูแลบริษัทตั้งค่านโยบาย GPS และไซต์ได้ตาม RLS เดิม
- Backend `attendance-clock` ตรวจบริษัท, employment, assignment, GPS, Selfie และ duplicate ซ้ำก่อนเขียนข้อมูล

## Integrations

- Time Tracking UI → Supabase Storage `attendance-selfies`
- Time Tracking UI → Edge Function `attendance-clock`
- `attendance_sessions` → Chat Attendance Bridge → ห้อง HR ผ่าน `chat_room_integrations`
- React Router `/time-tracking` ↔ `/chat` ใช้ Auth session เดิม

## Failure / Retry

- ไม่มีบริษัท/ไซต์/สิทธิ์: หยุดก่อนบันทึกและแสดงข้อความแก้ไข
- GPS/กล้อง/อัปโหลด/Edge Function ล้มเหลว: ไม่สร้าง attendance ที่ไม่สมบูรณ์ และให้เริ่มขั้นตอนใหม่
- ปุ่ม Web Chat ใช้ navigation ภายในแอป; หาก session หมดอายุ ระบบพาไป Login ตาม ProtectedRoute
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
