-- Correct the approved workflow terminology: Intake Flow -> Filter Flow -> Posting Flow.

insert into public.system_work_items(
  work_key,company_id,scope,title,category,status,progress,risk,detail,
  production_status,owner,evidence,current_step,attempt_count,created_at,updated_at
)
select
  replace(work_key,'FITTER-','FILTER-'),company_id,scope,
  replace(replace(title,'Fitter Flow','Filter Flow'),'Fitter','Filter'),
  category,status,progress,risk,
  replace(replace(detail,'Fitter Flow','Filter Flow'),'Fitter','Filter'),
  production_status,
  replace(replace(owner,'Fitter Flow','Filter Flow'),'Fitter','Filter'),
  left(coalesce(evidence,'')||E'\nแก้คำเรียกตามผู้ใช้อนุมัติ 16/8/2569: Intake Flow (Flow 1) → Filter Flow (Flow 2) → Posting Flow (Flow 3)',4000),
  current_step,attempt_count,created_at,now()
from public.system_work_items
where work_key like 'FITTER-%'
on conflict(work_key) do update set
  title=excluded.title,
  category=excluded.category,
  status=excluded.status,
  progress=excluded.progress,
  risk=excluded.risk,
  detail=excluded.detail,
  production_status=excluded.production_status,
  owner=excluded.owner,
  evidence=excluded.evidence,
  current_step=excluded.current_step,
  updated_at=now();

delete from public.system_work_items where work_key like 'FITTER-%';

insert into public.system_work_items(
  work_key,scope,title,category,status,progress,risk,detail,production_status,owner,evidence,current_step
) values
('INTAKE-FLOW-001','platform','Intake Flow — Flow ที่ 1: ห้องแรกรับเอกสาร','line','doing',35,'critical',
 'รับภาพ/PDF จาก LINE, Telegram, Web และ API; ตรวจ security/quality/duplicate; ปรับภาพ; รวมชุด; AI คัดแยกเบื้องต้น; ส่ง Auto AI เข้าห้องประเภทเมื่อผ่าน threshold หรือส่งห้องรอคนคัดแยก; แสดงเส้นทางและสถานะปลายทางด้วย Intake ID เดิม\nรายละเอียดงานเชิงเทคนิคอ้างอิง DOC-INGEST-001 ถึง DOC-INGEST-015',
 'partially_deployed','Intake Flow/Platform','ชื่อมาตรฐานได้รับอนุมัติ 16/8/2569','รวม DOC-INGEST backlog เป็น Intake Flow roadmap'),
('POSTING-FLOW-001','platform','Posting Flow — Flow ที่ 3: ห้องอนุมัติและบันทึก','operations','ready',0,'critical',
 'รับเฉพาะเอกสารที่ผ่าน Filter Flow; แสดง journal/tax/matching preview; ผู้มีสิทธิ์อนุมัติจึงสร้าง Accounting/AP/Stock/PO แบบ transaction และ idempotent; ส่งสถานะกลับ Intake/Filter; รองรับ correction/reversal และ audit\nรายละเอียด implementation อ้างอิง FILTER-007 และ FILTER-008',
 'backlog_registered','Posting Flow/Accounting','ชื่อมาตรฐานได้รับอนุมัติ 16/8/2569','จัดทำ Posting approval และ transaction contract')
on conflict(work_key) do update set
  title=excluded.title,
  detail=excluded.detail,
  owner=excluded.owner,
  evidence=excluded.evidence,
  current_step=coalesce(public.system_work_items.current_step,excluded.current_step),
  updated_at=now();
