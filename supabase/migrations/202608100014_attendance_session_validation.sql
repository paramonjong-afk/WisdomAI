-- Prevent incomplete or implausibly long attendance sessions from becoming payable time.
alter table public.workforce_rule_settings
  add column if not exists max_shift_minutes integer not null default 720
    check (max_shift_minutes between 60 and 1440),
  add column if not exists allow_overnight_shifts boolean not null default false;

create or replace function public.guard_attendance_session_duration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rules record;
  elapsed_minutes integer;
  crosses_business_date boolean;
  invalid_reason text;
begin
  if new.status in ('rejected', 'duplicate') then
    return new;
  end if;

  if new.clock_out_at is null then
    -- An open session is never a payable duration. A later monitor or a new
    -- clock-in can move it to review without inventing a clock-out time.
    new.worked_minutes := null;
    new.normal_minutes := null;
    new.overtime_minutes := 0;
    if new.status = 'needs_review' then
      new.calculation_status := 'needs_review';
    end if;
    return new;
  end if;

  select
    coalesce(max_shift_minutes, 720) as max_shift_minutes,
    coalesce(allow_overnight_shifts, false) as allow_overnight_shifts
  into rules
  from public.workforce_rule_settings
  where company_id = new.company_id and singleton = true;

  elapsed_minutes := floor(extract(epoch from (new.clock_out_at - new.clock_in_at)) / 60)::integer;
  crosses_business_date :=
    (new.clock_in_at at time zone 'Asia/Bangkok')::date <>
    (new.clock_out_at at time zone 'Asia/Bangkok')::date;

  if elapsed_minutes < 0 then
    invalid_reason := 'เวลาออกก่อนเวลาเข้า';
  elsif elapsed_minutes > coalesce(rules.max_shift_minutes, 720) then
    invalid_reason := format('ระยะเวลารวม %s นาที เกินกะสูงสุด %s นาที', elapsed_minutes, coalesce(rules.max_shift_minutes, 720));
  elsif crosses_business_date and not coalesce(rules.allow_overnight_shifts, false) then
    invalid_reason := 'เวลาเข้าและเวลาออกข้ามวัน แต่บริษัทไม่ได้เปิดใช้กะข้ามคืน';
  end if;

  if invalid_reason is not null then
    new.status := 'needs_review';
    new.calculation_status := 'needs_review';
    new.worked_minutes := null;
    new.normal_minutes := null;
    new.overtime_minutes := 0;
    new.review_category := 'multiple';
    new.review_requested_at := coalesce(new.review_requested_at, now());
    new.review_reason := concat_ws(' · ', nullif(new.review_reason, ''), invalid_reason);
  end if;

  return new;
end;
$$;

drop trigger if exists guard_attendance_session_duration_trigger on public.attendance_sessions;
create trigger guard_attendance_session_duration_trigger
before insert or update of clock_in_at, clock_out_at, status, worked_minutes, normal_minutes, overtime_minutes
on public.attendance_sessions
for each row execute function public.guard_attendance_session_duration();

revoke all on function public.guard_attendance_session_duration() from public, anon, authenticated;

insert into public.system_work_items(
  work_key, title, category, status, progress, risk, detail, evidence, production_status, updated_at
)
values (
  'ATT-VALIDATE-001',
  'ตรวจเวลาเข้า–ออกค้างและข้ามวัน',
  'operations',
  'review',
  70,
  'high',
  'ตรวจรายการเข้าเดิมก่อนลงเข้าใหม่ แยกรายการค้างข้ามวันไปรอตรวจ และกันระยะเวลาผิดปกติออกจาก Payroll',
  'Source prepared; migration 202608100014 and Edge regression pending approval/deploy.',
  'awaiting_migration_approval',
  now()
)
on conflict (work_key) do update set
  title = excluded.title,
  category = excluded.category,
  status = excluded.status,
  progress = excluded.progress,
  risk = excluded.risk,
  detail = excluded.detail,
  evidence = excluded.evidence,
  production_status = excluded.production_status,
  updated_at = now();

comment on function public.guard_attendance_session_duration() is
  'Tenant-aware guard that prevents open, cross-day, or excessive attendance spans from becoming payable time.';
