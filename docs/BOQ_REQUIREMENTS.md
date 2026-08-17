# BOQ Engine — Consolidated Requirements

เอกสารนี้รวบรวมข้อกำหนดจากบทสนทนาเดิมที่เกี่ยวข้องกับ BOQ และใช้เป็น baseline สำหรับพัฒนาใน WisdomAI React

## เป้าหมาย

สร้าง BOQ Engine กลางสำหรับทุกโครงการ ไม่ใช่เพียงตารางประมาณราคา โดยข้อมูล BOQ ต้องเชื่อมต่อไปยังใบเสนอราคา จัดซื้อ สต็อก ต้นทุนโครงการ การลงเวลา และ dashboard ได้

## ขอบเขตข้อมูล

- ข้อมูลหัวเอกสาร: บริษัท โครงการ ลูกค้า สถานที่ ผู้จัดทำ วันที่ และ revision
- รายการ BOQ: รหัส หมวดงาน รายการ รายละเอียด หน่วย ปริมาณ ราคาต่อหน่วย และยอดรวม
- ต้นทุนแยกประเภท: Material, Labour, Equipment, Subcontract และ Indirect
- การตั้งราคา: Overhead, Profit, Discount และ VAT
- การควบคุมงาน: ผู้รับผิดชอบ สถานะ เปอร์เซ็นต์ความคืบหน้า วันที่เริ่ม/สิ้นสุด ชั่วโมงประมาณ/จริง
- Revision control และสถานะ Draft, In review, Approved, Superseded
- Master data: Material, Labour, Equipment และ Assembly

## กติกาหลัก

1. BOQ ทุกฉบับต้องผูกกับ Project และมีเลข revision ที่ไม่ซ้ำภายในโครงการ
2. รายการใช้ BOQ Code; รายการวัสดุควรเชื่อม Material/Inventory Code แทนข้อความอิสระเมื่อมี master data
3. ยอดต้นทุนรายการคำนวณจากปริมาณคูณต้นทุนต่อหน่วยของแต่ละประเภท
4. ราคาขายรายการคำนวณจากปริมาณคูณราคาขายต่อหน่วย
5. เอกสารที่ Approved แล้วต้องไม่แก้ทับ แต่สร้าง revision ใหม่
6. ข้อมูลจากการอ่านแบบหรือ AI ต้องอยู่สถานะ Draft และผ่านการตรวจสอบโดยคนก่อนอนุมัติ
7. Quantity, Unit, Item Code และ Cost Category ต้องผ่าน validation ก่อน import/approve

## Cost Engine

ต้นทุนตรง = Material + Labour + Equipment + Subcontract + Indirect

ราคาก่อนภาษี = ต้นทุนตรง + Overhead + Profit - Discount

ราคาสุทธิ = ราคาก่อนภาษี + VAT

ระบบต้องเก็บทั้งค่าต่อหน่วยและยอดรวมที่คำนวณได้ เพื่อให้ตรวจสอบย้อนหลังและทำรายงานกำไรขาดทุนได้

## Assembly

Assembly คือสูตรมาตรฐานของหนึ่งหน่วยงาน เช่น “ติดตั้งปลั๊กไฟ 1 จุด” ซึ่งแตกเป็นวัสดุ อุปกรณ์ และค่าแรง ระบบระยะถัดไปต้องนำ Assembly มาเพิ่มรายการ BOQ อัตโนมัติและเก็บเวอร์ชันสูตรที่ใช้

## การเชื่อมระบบ

- Project: BOQ เป็น cost baseline ของโครงการ
- Time Tracking: ผูกเวลาวางแผน/เวลาจริงกับ BOQ item
- Inventory: ผูก material item และบันทึกเบิกใช้จริง
- Accounting/Purchase: เปรียบเทียบราคาซื้อและต้นทุนจริงกับ budget
- Dashboard: งบประมาณ ต้นทุนจริง คงเหลือ กำไร ความคืบหน้า งานล่าช้า และความเสี่ยง
- Drawing Takeoff / AI BOQ: อัปโหลด PDF/ภาพ, ระบุ scale, ตรวจจับรายการ/ระยะ/จำนวน, แสดงหลักฐานอ้างอิงหน้าแบบ และส่งเข้า staging เพื่อ review

## ลำดับพัฒนา

1. BOQ core, revision, item และ cost engine
2. Master data และ assembly
3. เชื่อม supplier price, inventory, purchase และ actual cost
4. Dashboard และ progress/time tracking
5. Drawing takeoff และ AI-assisted BOQ พร้อม human review

## ข้อมูลอ้างอิงเดิม

มีการกล่าวถึงไฟล์ `BOQ-146 คุณรุจ ใสจุล.xlsx` เป็น master reference แต่ไม่พบไฟล์ดังกล่าวใน workspace ปัจจุบัน จึงยังไม่ถือว่าการ audit รายการ สูตร ปริมาณ และหน่วยของไฟล์นั้นเสร็จสมบูรณ์
