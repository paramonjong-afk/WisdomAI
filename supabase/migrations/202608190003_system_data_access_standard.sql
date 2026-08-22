-- Platform-wide engineering standard: scalable reads are mandatory for every module.
insert into public.system_work_items(
  work_key,title,category,status,progress,risk,detail,evidence,production_status
) values (
  'SYS-DATA-ACCESS-001',
  'มาตรฐาน Cursor Pagination และ Data Gateway ทุกโมดูล',
  'operations','doing',20,'high',
  'ทุก Module ต้องใช้ server-side cursor pagination, database/Gateway join, server count และ lazy detail; ห้ามดึงทั้งหมดหรือส่ง ID จำนวนมากใน URL',
  'Root cause 19/8/2569: Document Flow ส่ง line_messages id=in.(...) มากกว่า 1,000 ID ทำให้ Supabase/PostgREST 400. เริ่มใช้ document_flow_queue_page เป็น reference implementation.',
  'partially_deployed'
) on conflict(work_key) do update set
  detail=excluded.detail,
  evidence=concat(excluded.evidence, ' Source evidence: Document Flow Center now consumes document_flow_queue_page with a 100-row cursor cap, server counts and lazy timeline loading; migration/RPC rollout and remaining modules are pending.'),
  status='doing',progress=greatest(public.system_work_items.progress,45),risk='high',production_status='source_ready_migration_pending',updated_at=now();
