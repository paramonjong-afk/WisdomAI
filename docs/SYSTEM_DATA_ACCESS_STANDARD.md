# มาตรฐานการเข้าถึงข้อมูลขนาดใหญ่

สถานะ: บังคับใช้กับทุก Module ใหม่และทุก Module ที่แก้ไขตาราง/คิว ตั้งแต่ 19 สิงหาคม 2569

## ข้อกำหนด

1. ห้าม Browser ดึงรายการทั้งหมดเพื่อนับ/กรอง หรือสร้าง `IN (...)` จาก ID จำนวนมาก
2. การอ่านตารางหรือคิวต้องใช้ Gateway/RPC กลาง พร้อม cursor (keyset pagination) และ page size ไม่เกิน 100 รายการ
3. การ join ข้อมูลอ้างอิง เช่น ผู้ส่ง ห้อง โครงการ ต้องทำในฐานข้อมูลหรือ Gateway ไม่ใช่ join ซ้ำจาก Browser
4. จำนวน KPI/Tab ต้องคำนวณในฐานข้อมูลและส่งกลับพร้อมหน้าแรก
5. Timeline, ไฟล์, และรายละเอียดหนัก ให้โหลดเมื่อผู้ใช้เปิดเฉพาะรายการนั้น
6. ทุก query ที่เป็นคิวต้องมี index ตาม `company_id`, ตัวกรองหลัก และ `updated_at desc, id desc`
7. ตาราง UI ที่มีข้อมูลมากต้องใช้ server pagination หรือ virtualized rendering; ห้ามกำหนด `limit(2000)` เป็นรูปแบบถาวร

## มาตรฐานปฏิบัติ

- Gateway คืน `items`, `counts`, `next_cursor`.
- cursor ใช้ `(updated_at, id)` เพื่อไม่ข้าม/ซ้ำเมื่อข้อมูลใหม่เข้าระหว่างเลื่อนหน้า.
- Error ของข้อมูลประกอบต้องไม่ล้มรายการหลัก และต้องบันทึก telemetry เพื่อแก้ที่ต้นทาง.
- ทดสอบอย่างน้อย 2,000 รายการ โดยตรวจว่าไม่มี HTTP 400 จาก URL/query ที่ยาวเกินไป.

## จุดอ้างอิงต้นแบบ

`public.document_flow_queue_page(...)` และ `src/services/documentFlowGateway.ts`

## มาตรฐานประสิทธิภาพและการแจ้งปัญหากลาง

| กลุ่ม | วัด | เฝ้าระวัง | วิกฤต |
|---|---|---:|---:|
| ความพร้อมใช้ | API/Edge สำเร็จ | error rate > 1% ใน 5 นาที | > 5% หรือ API ใช้ไม่ได้ |
| API | p95 response | > 1 วินาที | > 3 วินาที |
| หน้าเว็บ | LCP | > 2.5 วินาที | > 4 วินาที |
| การโต้ตอบ | INP/Filter/Action | > 300 ms | > 800 ms |
| ข้อมูลขนาดใหญ่ | page/query size | > 100 แถว หรือ URL > 6 KB | URL/query ถูกปฏิเสธ หรือดึงทั้งหมด |
| คิวงาน | SLA และ retry | เกิน SLA หรือ retry >= 2 | dead-letter / ข้อมูลสูญหาย |

System Health ต้องบันทึก `module`, `route/action`, `company`, `latency`, `result`, `error fingerprint`, `row/page size` และสร้าง Incident แบบ deduplicate เมื่อเกินเกณฑ์ต่อเนื่อง 2 รอบตรวจ. การแจ้งซ้ำใช้ช่วง 30 นาที และปิด Incident เมื่อกลับสู่ปกติ 2 รอบ.

### Browser performance telemetry

ทุก Module ที่ผู้ใช้เข้าสู่ระบบจะบันทึกค่าที่วัดได้จริงของ page load, LCP และการโต้ตอบแรกไว้ใน `app_activity_logs` ประเภท `performance_metric` โดยไม่เก็บเนื้อหาเอกสาร, token, password หรือ request body. ค่าที่เกินเกณฑ์จะส่งต่อเข้า `system_error_events` และรวมเหตุซ้ำตามหน้า/ชนิดค่า เพื่อให้ System Health แสดง Incident ที่แก้ไขได้จริงแทนการแจ้งเตือนซ้ำจำนวนมาก.
