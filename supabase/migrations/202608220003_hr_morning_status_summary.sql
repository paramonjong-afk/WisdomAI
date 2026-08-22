-- HR Morning Status Summary: daily 07:30 (Asia/Bangkok) operational brief.
-- Generates one idempotent message per company in the existing HR Web Chat room.

create or replace function public.publish_hr_morning_status_summary(
  target_company_id uuid,
  target_summary_date date default ((now() at time zone 'Asia/Bangkok')::date - 1)
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid := md5(target_company_id::text || ':' || target_summary_date::text || ':hr-morning-status')::uuid;
  missing_clock_out integer;
  pending_corrections integer;
  pending_leaves integer;
  pending_overtime integer;
  pending_documents integer;
  open_system_work integer;
  not_ready_employees integer;
  lines jsonb;
begin
  if target_company_id is null then return; end if;
  if not exists (
    select 1 from public.chat_room_integrations i
    where i.company_id = target_company_id and i.integration_key = 'attendance' and i.enabled = true
  ) then return; end if;

  select count(*) into missing_clock_out
  from public.attendance_sessions s
  where s.company_id = target_company_id
    and (s.clock_in_at at time zone 'Asia/Bangkok')::date = target_summary_date
    and s.clock_in_at is not null and s.clock_out_at is null
    and s.status not in ('rejected','duplicate');

  select count(*) into pending_corrections
  from public.attendance_correction_requests r
  where r.status = 'pending'
    and exists (select 1 from public.company_members m where m.company_id = target_company_id and m.profile_id = r.profile_id and m.active = true);

  select count(*) into pending_leaves
  from public.employee_leave_requests r
  where r.status in ('pending','needs_evidence','late_notice')
    and exists (select 1 from public.company_members m where m.company_id = target_company_id and m.profile_id = r.profile_id and m.active = true);

  select count(*) into pending_overtime
  from public.employee_overtime_assignments r
  where r.status = 'pending_approval'
    and exists (select 1 from public.company_members m where m.company_id = target_company_id and m.profile_id = r.profile_id and m.active = true);

  select count(*) into pending_documents
  from public.employee_document_requests r
  where r.status in ('pending','needs_information','failed')
    and exists (select 1 from public.company_members m where m.company_id = target_company_id and m.profile_id = r.profile_id and m.active = true);

  select count(*) into open_system_work
  from public.system_work_items w
  where w.company_id = target_company_id and w.status in ('doing','review','blocked');

  select count(*) into not_ready_employees
  from public.employee_employment_records e
  where e.company_id = target_company_id and e.employment_status in ('probation','active','notice')
    and (e.attendance_policy <> 'exempt' and e.work_policy_id is null or e.employment_type = 'monthly' and coalesce(e.monthly_salary,0) <= 0 or e.employment_type <> 'monthly' and coalesce(e.daily_rate,0) <= 0);

  lines := jsonb_build_array(
    'วันที่ตรวจ: ' || to_char(target_summary_date, 'DD/MM/YYYY'),
    'ลงเวลาเมื่อวานไม่ครบ/ไม่มีเวลาออก: ' || missing_clock_out || ' รายการ',
    'รออนุมัติแก้เวลา: ' || pending_corrections || ' รายการ',
    'รออนุมัติการลา: ' || pending_leaves || ' รายการ',
    'รออนุมัติ OT: ' || pending_overtime || ' รายการ',
    'เอกสาร HR รอตรวจ/ข้อมูลไม่ครบ: ' || pending_documents || ' รายการ',
    'งานระบบที่ยังเปิด: ' || open_system_work || ' รายการ',
    'พนักงานที่ข้อมูลยังไม่พร้อม: ' || not_ready_employees || ' คน',
    case when missing_clock_out + pending_corrections + pending_leaves + pending_overtime + pending_documents + open_system_work + not_ready_employees = 0
      then 'ความพร้อมวันนี้: พร้อมทำงาน ไม่มีรายการค้างที่ตรวจพบ'
      else 'ความพร้อมวันนี้: ต้องตรวจรายการค้างตามจำนวนด้านบนก่อนปิดงวด/อนุมัติค่าแรง' end
  );

  perform public.deliver_hr_work_chat_event(
    target_company_id, 'hr_morning_status', target_id, 'hr_morning_status_summary', 'morning_summary',
    'สรุปสถานะงาน HR ประจำวัน 07:30', lines,
    jsonb_build_object('summary_date', target_summary_date, 'missing_clock_out', missing_clock_out,
      'pending_corrections', pending_corrections, 'pending_leaves', pending_leaves,
      'pending_overtime', pending_overtime, 'pending_documents', pending_documents,
      'open_system_work', open_system_work, 'not_ready_employees', not_ready_employees)
  );
end;
$$;

revoke all on function public.publish_hr_morning_status_summary(uuid,date) from public, anon, authenticated;
grant execute on function public.publish_hr_morning_status_summary(uuid,date) to service_role;

create extension if not exists pg_cron;
do $$
begin
  if exists(select 1 from cron.job where jobname='wisdomai-hr-morning-status-summary') then
    perform cron.unschedule('wisdomai-hr-morning-status-summary');
  end if;
  -- 00:30 UTC = 07:30 Asia/Bangkok.
  perform cron.schedule('wisdomai-hr-morning-status-summary','30 0 * * *',
    $job$select public.publish_hr_morning_status_summary(c.company_id)
      from public.chat_room_integrations c
      where c.integration_key = 'attendance' and c.enabled = true
      group by c.company_id$job$);
end $$;

comment on function public.publish_hr_morning_status_summary(uuid,date) is
  'Idempotent daily 07:30 HR operational summary for the existing HR Web Chat room.';
