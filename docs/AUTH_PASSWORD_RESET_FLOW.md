# AUTH PASSWORD RESET FLOW — Login / Reset Password

## วัตถุประสงค์

Flow นี้กำหนดเส้นทาง “ลืมรหัสผ่าน / ตั้งรหัสใหม่” ให้รับลิงก์จาก Supabase Auth ได้ถูกต้อง ไม่ว่าลิงก์จะกลับมาที่ `/reset-password`, `/`, หรือ `/login` พร้อม recovery hash/code

## Inputs

- Email จากหน้า Login
- Supabase recovery link ที่ส่งจาก `resetPasswordForEmail`
- URL state จาก Supabase Auth:
  - `type=recovery`
  - `access_token` + `refresh_token`
  - `code` สำหรับ PKCE
  - `error`, `error_code`, `error_description`

## Outputs

- Session recovery ที่พร้อมเรียก `supabase.auth.updateUser({ password })`
- Password ใหม่ที่ผ่าน validation และบันทึกสำเร็จ
- ข้อความ error ชัดเจนเมื่อ link หมดอายุ, ไม่ถูกต้อง, หรือไม่มี session
- Auth security event เมื่อ reset/recovery มีปัญหาสำคัญ เช่น rate limit, banned, expired/access denied link
- หลังสำเร็จ sign out และกลับหน้า Login

## States

1. `request_link` — ผู้ใช้กรอก email และกด “ลืมรหัสผ่าน / ตั้งรหัสใหม่”
2. `email_sent` — ระบบแจ้งว่าได้ส่งลิงก์แล้วโดยไม่เปิดเผยว่า email มีบัญชีหรือไม่
3. `recovery_redirect` — Supabase redirect กลับ app พร้อม hash/code/error
4. `session_checking` — หน้า Reset ตรวจ session หรือ exchange PKCE code
5. `ready_to_reset` — พบ recovery session และเปิดให้กรอกรหัสใหม่
6. `password_updated` — update password สำเร็จ, sign out, redirect Login
7. `blocked` — link หมดอายุ/ไม่มี session/invalid link

## Roles / Permissions

- ผู้ใช้ทั่วไปสามารถขอลิงก์ reset ได้จากหน้า Login
- การเปลี่ยน password ต้องมี Supabase recovery session เท่านั้น
- Admin reset password ให้พนักงานใช้ Flow แยกผ่าน `manage-employee-account` และ Audit กลาง

## Integrations

- Supabase Auth:
  - `resetPasswordForEmail(email, { redirectTo })`
  - `onAuthStateChange(PASSWORD_RECOVERY)`
  - `exchangeCodeForSession(code)` สำหรับ PKCE
  - `updateUser({ password })`
- Central Auth Security:
  - หน้า Login/Reset บันทึกเหตุการณ์สำคัญผ่าน `register_login_attempt(...)` โดยเก็บเฉพาะ email hash
  - `health-monitor` ตรวจ `auth_login_attempts` รอบ 15 นาทีล่าสุด และส่ง Telegram Admin alert ผ่านกติกา incident เดิม
- Frontend route guard:
  - recovery URL จาก `/`, `/login`, หรือ route protected ต้องถูกส่งเข้า `/reset-password`

## Failure / Retry

- `otp_expired`: แจ้งลิงก์หมดอายุหรือถูกใช้แล้ว ให้ขอลิงก์ใหม่
- `access_denied`: แจ้งลิงก์ใช้ไม่ได้ ให้ขอลิงก์ใหม่
- `over_email_send_rate_limit` / HTTP 429: แจ้งว่าขอลิงก์ถี่เกินไป ให้รอประมาณ 5-15 นาทีแล้วขอใหม่ ห้ามให้ผู้ใช้กดซ้ำต่อเนื่อง
- `User is banned`: แจ้งว่าบัญชีถูกปิดใช้งาน ต้องให้ Admin เปิดใช้งานบัญชีก่อน reset password
- ไม่มี session หลังเปิดหน้า Reset: ปิดปุ่มบันทึกและให้กลับ Login เพื่อขอลิงก์ใหม่
- Password ไม่ครบ 10 ตัวหรือยืนยันไม่ตรง: หยุดก่อนส่ง Supabase
- ปัญหาสำคัญต้องถูกบันทึก `auth_login_attempts` เป็น failure reason ที่ขึ้นต้น `auth_warning:` หรือ `auth_critical:` แล้วให้ Health Monitor ส่ง Telegram ให้ Admin รับทราบ

## Audit / Security

- ไม่บันทึก password, access token, refresh token หรือ recovery code ลง log
- ไม่ส่งอีเมลจริงเข้า Telegram; audit ใช้ email hash และ Telegram แสดงเฉพาะประเภทปัญหา/เหตุผล
- เมื่อ recovery session พร้อมแล้ว ล้าง token/hash ออกจาก URL ด้วย `history.replaceState`
- Auth token HTTP 400/401 เป็น expected auth outcome ไม่ควรเปิด incident ระบบกลางซ้ำ

## Owner

- System/Auth owner
- HR/Admin owner เฉพาะกรณี reset password ให้พนักงานผ่าน Admin account management
