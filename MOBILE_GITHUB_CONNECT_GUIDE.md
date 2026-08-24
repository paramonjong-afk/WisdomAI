# WisdomAI Mobile GitHub Connection Guide

เอกสารนี้ใช้สำหรับเชื่อมต่อโปรเจค WisdomAI จากมือถือหรือ Codex เครื่องอื่น

## Repository

- GitHub: https://github.com/paramonjong-afk/WisdomAI
- Branch หลัก: `main`
- Commit ล่าสุดที่ตรวจจาก workspace: `1319681`
- Production Cloudflare: https://wisdomai.pages.dev
- Smart Entry: https://wisdomai.pages.dev/start.html
- Production Vercel: https://wisdomai-react.vercel.app

## Prompt สำหรับส่งให้ Codex บนมือถือ

```text
เชื่อมต่อและทำงานต่อใน GitHub repository นี้:
https://github.com/paramonjong-afk/WisdomAI

ใช้ branch main และอ่านไฟล์ CODEX_HANDOFF.md, AGENTS.md,
docs/FLOW_REGISTRY_UPDATE_PROTOCOL.md และ docs/END_TO_END_CHANGE_EXECUTION_STANDARD.md ก่อนเริ่มงาน

กติกา:
1. ตรวจ git status, branch และ commit ล่าสุดก่อนแก้ไข
2. ห้ามใช้ git reset --hard หรือ checkout ทับงานเดิม
3. ห้ามอ่าน แสดง หรือส่งค่าใน .env, .env.local, API key, token หรือ password
4. แยกงานเป็น branch ใหม่เมื่อมีการแก้ไขหลายไฟล์
5. ก่อน commit ให้ตรวจ diff และ git diff --check
6. รัน test ที่เกี่ยวข้อง, npm run typecheck, npm run lint และ npm run build
7. ห้าม apply migration หรือแก้ข้อมูล Production โดยไม่ระบุผลกระทบและหลักฐาน
8. สรุปไฟล์ที่แก้, test ที่ผ่าน, commit, deploy revision และ blocker ที่เหลือ

เริ่มจากตรวจโครงสร้างและสถานะจริงก่อน อย่าเดาชื่อตารางหรือข้อมูล และอย่าสร้างข้อมูลธุรกิจซ้ำ
```

## คำสั่งเชื่อมต่อด้วย Git

```bash
git clone https://github.com/paramonjong-afk/WisdomAI.git
cd WisdomAI
git switch main
git pull --ff-only origin main
git log -5 --oneline
git status --short
```

ถ้า repository ถูก clone ไว้แล้ว:

```bash
git remote -v
git fetch origin
git switch main
git pull --ff-only origin main
```

## เตรียมโปรเจคหลังเชื่อมต่อ

ต้องใช้ Node.js รุ่นที่รองรับในโปรเจค และติดตั้ง dependency จาก lockfile:

```bash
npm ci
npm run typecheck
npm run build
```

รันระบบพัฒนาในเครื่อง:

```bash
npm run dev
```

จากนั้นเปิด URL ที่ Vite แสดง เช่น `http://localhost:5173` แล้วล็อกอินด้วยบัญชีทดสอบของผู้ดูแลระบบ

## งาน Master Data ที่แก้ล่าสุด

จุดแก้ล่าสุดคือ Source Reference ในหน้า `/master-data`:

- ตารางและ Drawer ใช้ source object เดียวกัน
- Message ID ไม่ถูกใช้ Transaction ID แทนอีกต่อไป
- Drawer แสดง Document ID, Intake ID, Room, Attachment และ Audit เมื่อมีข้อมูลจริง
- ไม่แก้ Raw Data และไม่สร้าง candidate ซ้ำ
- Commit ที่แก้จุดนี้: `c783536`
- Commit ล่าสุดของ branch ใน workspace: `1319681`

ตรวจหน้า Production:

- https://wisdomai.pages.dev/master-data

## คำสั่งทดสอบงานที่เกี่ยวข้อง

```bash
npm run test:master-data-candidate-review
npm run test:omni-channel-intake
npm run test:accounting-transfer-slips
npm run test:advance-settlement-slip-preview
npm run test:flow-registry-dashboard
npm run test:web-chat-operational-core
```

## การตั้งค่า Environment

ให้ใช้ไฟล์ตัวอย่างเป็นต้นแบบเท่านั้น:

```bash
Copy-Item .env.example .env.local
```

ค่า Secret ต้องกรอกจาก Password Manager หรือระบบ CI ของเจ้าของโปรเจคเท่านั้น ห้ามส่ง Secret ผ่านแชท, GitHub issue, commit, screenshot หรือไฟล์ที่อัปโหลดขึ้น repository

## ขั้นตอนส่งงานกลับ GitHub

```bash
git switch -c codex/<short-task-name>
git status --short
git diff --check
git add <only-files-for-this-task>
git commit -m "<short task description>"
git push -u origin codex/<short-task-name>
```

ก่อน merge ให้ตรวจว่าไม่มีไฟล์ต่อไปนี้ถูก stage:

```text
.env
.env.local
*.key
*.pem
*.log
node_modules/
dist/
```

## ข้อมูลที่ต้องส่งกลับหลังทำงาน

```text
สถานะ: DONE หรือ BLOCKED
Repository/Branch:
Commit:
ไฟล์ที่แก้:
Tests:
Typecheck/Lint/Build:
Production URL และ revision:
ข้อมูล Production ถูกแก้หรือไม่:
Blocker:
```
