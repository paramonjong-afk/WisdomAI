create or replace function public.admin_save_attendance(
  target_session_id uuid,
  target_profile_id uuid,
  target_site_id uuid,
  target_clock_in_at timestamptz,
  target_clock_out_at timestamptz,
  adjustment_reason text
) returns public.attendance_sessions
language plpgsql security definer set search_path=public as $$
declare
  actor_role text;
  site_row public.project_sites;
  before_row public.attendance_sessions;
  after_row public.attendance_sessions;
  work_date date;
begin
  select role into actor_role from public.profiles where id=auth.uid();
  if actor_role <> 'admin' then raise exception 'Admin permission required'; end if;
  if nullif(trim(adjustment_reason),'') is null or char_length(trim(adjustment_reason))<3 then
    raise exception 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร';
  end if;
  if target_clock_in_at is null then raise exception 'ต้องระบุเวลาเข้า'; end if;
  if target_clock_out_at is not null and target_clock_out_at<=target_clock_in_at then raise exception 'เวลาออกต้องอยู่หลังเวลาเข้า'; end if;
  if target_clock_out_at is not null and target_clock_out_at-target_clock_in_at>interval '24 hours' then raise exception 'ช่วงเวลาทำงานต้องไม่เกิน 24 ชั่วโมง'; end if;
  if not exists(select 1 from public.profiles where id=target_profile_id) then raise exception 'ไม่พบพนักงาน'; end if;
  select * into site_row from public.project_sites where id=target_site_id and active;
  if site_row.id is null then raise exception 'ไม่พบไซต์งานที่เปิดใช้งาน'; end if;
  work_date:=(target_clock_in_at at time zone 'Asia/Bangkok')::date;
  perform pg_advisory_xact_lock(hashtextextended(target_profile_id::text||work_date::text,0));

  if exists(
    select 1 from public.employee_payrolls payroll join public.pay_periods period on period.id=payroll.pay_period_id
    where payroll.profile_id=target_profile_id and work_date between period.starts_on and period.ends_on
      and (payroll.status in ('closed','pending_payment','paid') or period.status in ('closed','paying','paid'))
  ) then raise exception 'รอบค่าจ้างนี้ปิดหรือจ่ายแล้ว ไม่สามารถเพิ่มหรือแก้เวลาได้'; end if;

  if exists(
    select 1 from public.attendance_sessions existing where existing.profile_id=target_profile_id
      and existing.id is distinct from target_session_id and existing.status not in ('rejected','duplicate')
      and (existing.clock_in_at at time zone 'Asia/Bangkok')::date=work_date
  ) then raise exception 'พนักงานมีรายการลงเวลาในวันนี้แล้ว'; end if;

  if target_session_id is null then
    insert into public.attendance_sessions(
      profile_id,site_id,clock_in_at,clock_out_at,clock_in_latitude,clock_in_longitude,
      clock_out_latitude,clock_out_longitude,clock_in_accuracy_meters,clock_out_accuracy_meters,
      clock_in_distance_meters,clock_out_distance_meters,note,status,review_reason,reviewed_by,reviewed_at
    ) values(
      target_profile_id,target_site_id,target_clock_in_at,target_clock_out_at,site_row.latitude,site_row.longitude,
      case when target_clock_out_at is null then null else site_row.latitude end,
      case when target_clock_out_at is null then null else site_row.longitude end,
      0,case when target_clock_out_at is null then null else 0 end,0,case when target_clock_out_at is null then null else 0 end,
      'เพิ่มเวลาโดย Admin',case when target_clock_out_at is null then 'needs_review' else 'approved' end,
      trim(adjustment_reason),auth.uid(),now()
    ) returning * into after_row;
    insert into public.attendance_audit_logs(session_id,actor_profile_id,action,reason,old_values,new_values)
    values(after_row.id,auth.uid(),case when target_clock_out_at is null then 'admin_create_clock_in' else 'admin_create' end,trim(adjustment_reason),null,to_jsonb(after_row));
  else
    select * into before_row from public.attendance_sessions where id=target_session_id for update;
    if before_row.id is null then raise exception 'ไม่พบรายการลงเวลา'; end if;
    update public.attendance_sessions set profile_id=target_profile_id,site_id=target_site_id,
      clock_in_at=target_clock_in_at,clock_out_at=target_clock_out_at,
      status=case when target_clock_out_at is null then 'needs_review' else 'approved' end,
      review_reason=trim(adjustment_reason),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=target_session_id returning * into after_row;
    insert into public.attendance_audit_logs(session_id,actor_profile_id,action,reason,old_values,new_values)
    values(after_row.id,auth.uid(),case when before_row.clock_out_at is null and target_clock_out_at is not null then 'admin_add_clock_out' else 'admin_update' end,trim(adjustment_reason),to_jsonb(before_row),to_jsonb(after_row));
  end if;
  return after_row;
end;
$$;
