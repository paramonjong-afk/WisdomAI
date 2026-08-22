# WisdomAI — Canonical Handoff

> อัปเดตล่าสุด: 23/8/2569 (Asia/Bangkok)  
> ใช้เอกสารนี้เป็นสรุปหลักแทนรายละเอียดทดลองและข้อความซ้ำก่อนหน้า

## 1. Production Web

- ระบบหลัก: `https://wisdomai-react.vercel.app`
- ระบบสำรอง/จุดเข้าที่ใช้ในลาว: `https://wisdomai.pages.dev`
- Smart Entry สำหรับมือถือและคอม: `https://wisdomai.pages.dev/start.html`
- Frontend release ปัจจุบันมาจาก GitHub commit เดียวกัน: `bcabf07`
- Cloudflare production bundle ที่ตรวจแล้ว: `index-D0cYBnWL.js`
- GitHub deployment status ของ Vercel projects `wisdomai-react` และ `wisdom-ai`: `success`
- Cloudflare ตรวจพบ release marker `bcabf07`, Application Launcher และ Smart Entry Flow ครบ

## 2. Smart Entry Routing

- ตรวจ Vercel และ Cloudflare พร้อมกัน 3 probe ต่อปลายทาง
- timeout 2.5 วินาทีและเลือก median latency ที่ต่ำกว่า
- ถ้าปลายทางหนึ่งถูกบล็อก ให้เลือกอีกปลายทาง
- ถ้าทั้งคู่ล้มเหลว ไม่ redirect วน; แสดง retry และปุ่มเลือกเอง
- ป้องกัน open redirect โดยรับเฉพาะ path ภายใน
- ไม่ส่งข้อมูลบัญชี พนักงาน หรือ token ระหว่างตรวจ
- Source of truth: `docs/SMART_ENTRY_ROUTING_FLOW.md`

## 3. Verification ล่าสุด

- `npm run test:smart-entry`: ผ่าน
- `npm run test:auth-routing`: ผ่าน
- `npm run lint`: ผ่าน
- `npm run build`: ผ่าน
- Cloudflare `/`, `/start.html`, `/health-check.svg`: HTTP 200
- เครือข่ายของ agent เชื่อม `.app` ไม่ได้/SSL reset จึงตรวจหน้า Vercel โดยตรงไม่ได้ แต่ GitHub deployment status ยืนยัน Vercel deployment ของ `bcabf07` สำเร็จ

## 4. ขอบเขต Release

- Release `bcabf07` รวม frontend 90 ไฟล์: 33 เพิ่ม, 56 แก้ไข, 1 ลบ
- ตรวจไม่พบ secret pattern ในไฟล์ที่ส่ง
- ไม่รวม Supabase migrations
- ไม่รวม Supabase Edge Functions
- ไม่เปลี่ยนข้อมูล Production Database

## 5. จุดที่ยังต้องยืนยัน

1. Supabase Auth URL Configuration ต้องคง Redirect URL ของทั้งสองโดเมน:
   - `https://wisdomai.pages.dev/**`
   - `https://wisdomai-react.vercel.app/**`
2. ภาพก่อนหน้าพบ Site URL เป็น Cloudflare และเห็น Redirect URL เฉพาะ Cloudflare; ยังไม่มีหลักฐานยืนยันว่า Vercel URL ถูกเพิ่มกลับแล้ว
3. ต้องทำ signed-in UAT บนมือถือจริงในลาวอย่างน้อยหนึ่งครั้ง: Smart Entry → Login → หน้าแรก → Logout/Reset Password

## 6. Recovery / Rollback

- หาก frontend `bcabf07` ผิดปกติ ให้ rollback GitHub/Vercel/Cloudflare ไป commit `2e8cb20`
- Smart Entry แยกจากข้อมูลธุรกิจ การ rollback ไม่ต้องแก้ฐานข้อมูล
- URL ตรงของ Vercel และ Cloudflare ยังคงใช้เป็น fallback ได้

## 7. Workspace Safety

- Working tree หลักมีงานเดิมจำนวนมาก ห้ามใช้ `git reset --hard` หรือ checkout ทับ
- Production release ถูกสร้างจาก clean release snapshot เพื่อไม่รวม cache, `.env`, log และไฟล์ชั่วคราว
- ก่อนงานใหม่ต้องตรวจ Flow Registry และ `docs/END_TO_END_CHANGE_EXECUTION_STANDARD.md`
