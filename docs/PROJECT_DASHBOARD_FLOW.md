# PROJECT DASHBOARD FLOW — Dashboard ศูนย์บริหารโครงการ

## วัตถุประสงค์

Dashboard รวมต้องสรุปภาพบริหารโครงการและต้นทุนทั้งบริษัท/โครงการที่เลือก โดยตัวเลขค่าแรงต้องสอดคล้องกับ Reports และไม่หายเมื่อยังไม่ได้ปิดงวด Payroll

## Inputs

- โครงการ, BOQ, เอกสารบัญชี, ผู้รับเหมา, คลังสินค้า และ attendance sessions
- `employee_payrolls` สำหรับยอดงวดที่ generate/approve/close/paid แล้ว
- `get_realtime_payroll_forecast(target_month)` สำหรับค่าแรงเกิดขึ้นจริงและประมาณการของเดือนที่ยังไม่ได้ปิดงวด
- ตัวกรองเดือนและโครงการ

## Outputs

- การ์ดภาพรวมงบประมาณ, ต้นทุน, ค่าแรงเกิดขึ้นจริง, ค่าแรงสิ้นเดือนคาดการณ์ และกำไรคาดการณ์
- Tap ค่าแรงและกำลังคน แสดงพนักงานใน forecast, ชั่วโมง, payroll locked และสถานะข้อมูลที่ต้องเติม
- Breakdown ต้นทุนตามหมวด โดยใช้ค่าแรงที่ดีที่สุดในขณะนั้น:
  - ถ้ามี payroll งวดที่ล็อก/อนุมัติแล้ว ใช้ยอด payroll เป็น actual locked
  - ถ้ายังไม่มี payroll ใช้ค่าแรงเกิดขึ้นจริงจาก forecast เป็น actual accrual
  - forecast สิ้นเดือนใช้เป็นภาระคาดการณ์ ไม่ใช่ยอดจ่ายจริง

## States

1. `loading` — โหลดข้อมูลจากตารางหลักและ forecast RPC
2. `ready` — แสดงตัวเลขรวมพร้อมแหล่งที่มา
3. `partial` — แสดงข้อมูลที่โหลดได้ พร้อมแจ้ง error กลางถ้า forecast/RLS/ตารางใดล้มเหลว
4. `refreshing` — รีเฟรชเมื่อ attendance, payroll, employment หรือ daily plan เปลี่ยน

## Roles / Permissions

- Admin และ Manager เข้าถึง Dashboard ได้
- Forecast RPC ต้องตรวจ active company/membership ตาม RLS เดิม
- ข้อมูลค่าแรงเป็นข้อมูลอ่อนไหว แสดงเฉพาะผู้มีสิทธิ์บริหาร

## Integrations

- Supabase tables: `projects`, `boq_documents`, `boq_document_totals`, `accounting_documents`, `employee_payrolls`, `attendance_sessions`, `contractor_contracts`, `contractor_payment_claims`, `inventory_movements`
- Supabase RPC: `get_realtime_payroll_forecast`
- Realtime: attendance, payroll, accounting, contractor claims, employee employment records, workforce daily plans
- Central Error: `userError()` และ System Error Center

## Failure / Retry

- ถ้า forecast RPC ล้มเหลว ให้ Dashboard ยังแสดงข้อมูลอื่นได้ แต่แจ้ง warning ผ่าน error center
- ถ้า payroll ยังไม่ generate ให้แสดงค่าแรงจาก forecast แทน และระบุว่าเป็น “เกิดขึ้นจริง/ประมาณการ”
- ถ้าตัวกรองโครงการถูกใช้ ค่าแรง forecast ที่ยังไม่มี allocation รายโครงการจะแสดงเป็นภาพรวมบริษัทเท่านั้น เพื่อไม่จัดสรรผิด

## Audit / Events

- การโหลดล้มเหลวส่งผ่าน `userError()` เข้าศูนย์กลาง
- ไม่มีการเขียนข้อมูลจาก Dashboard; เป็น read/report only

## Owner

- Project Management / Finance Dashboard owner
- HR/Payroll owner สำหรับนิยามค่าแรงและ forecast
