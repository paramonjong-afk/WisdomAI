-- EMP-POLICY-001: employment attendance policy and explainable time reporting.
alter table public.employee_employment_records add column if not exists attendance_policy text not null default 'required' check (attendance_policy in ('required','record_only','exempt'));
alter table public.work_policies
  add column if not exists early_clock_in_policy text not null default 'record_only' check (early_clock_in_policy in ('record_only','round_to_shift','approved_ot','grace')),
  add column if not exists early_clock_in_grace_minutes integer not null default 0 check (early_clock_in_grace_minutes between 0 and 240);
alter table public.attendance_sessions
  add column if not exists early_arrival_minutes integer not null default 0 check (early_arrival_minutes>=0),
  add column if not exists pre_shift_overtime_minutes integer not null default 0 check (pre_shift_overtime_minutes>=0),
  add column if not exists post_shift_overtime_minutes integer not null default 0 check (post_shift_overtime_minutes>=0),
  add column if not exists excluded_minutes integer not null default 0 check (excluded_minutes>=0);

create or replace function public.derive_attendance_explainable_minutes()
returns trigger language plpgsql set search_path=public as $$
declare early_policy text:='record_only'; grace integer:=0; before_shift integer:=0; after_shift integer:=0; approved_before integer:=0; approved_after integer:=0;
begin
  select coalesce(policy.early_clock_in_policy,'record_only'),coalesce(policy.early_clock_in_grace_minutes,0) into early_policy,grace
  from work_policies policy where policy.id=coalesce(
    (select site.work_policy_id from project_sites site where site.id=new.site_id),
    (select employment.work_policy_id from employee_employment_records employment where employment.profile_id=new.profile_id),
    (select fallback.id from work_policies fallback where fallback.active order by fallback.created_at limit 1));
  before_shift:=case when new.scheduled_start_at is not null and new.clock_in_at<new.scheduled_start_at then greatest(0,floor(extract(epoch from(new.scheduled_start_at-new.clock_in_at))/60)::integer) else 0 end;
  after_shift:=case when new.clock_out_at is not null and new.scheduled_end_at is not null and new.clock_out_at>new.scheduled_end_at then greatest(0,floor(extract(epoch from(new.clock_out_at-new.scheduled_end_at))/60)::integer) else 0 end;
  if new.clock_out_at is not null and new.scheduled_start_at is not null and new.scheduled_end_at is not null then
    select coalesce(sum(greatest(0,floor(extract(epoch from(least(new.clock_out_at,a.ends_at,new.scheduled_start_at)-greatest(new.clock_in_at,a.starts_at)))/60)::integer)),0),
      coalesce(sum(greatest(0,floor(extract(epoch from(least(new.clock_out_at,a.ends_at)-greatest(new.clock_in_at,a.starts_at,new.scheduled_end_at)))/60)::integer)),0)
    into approved_before,approved_after from employee_overtime_assignments a
    where a.profile_id=new.profile_id and a.status='approved' and a.starts_at<new.clock_out_at and a.ends_at>new.clock_in_at;
  end if;
  new.early_arrival_minutes:=before_shift;
  new.pre_shift_overtime_minutes:=least(before_shift,approved_before);
  new.post_shift_overtime_minutes:=least(after_shift,approved_after);
  new.excluded_minutes:=case when early_policy='grace' then greatest(0,before_shift-grace-new.pre_shift_overtime_minutes) else greatest(0,before_shift-new.pre_shift_overtime_minutes) end;
  return new;
end $$;
drop trigger if exists derive_attendance_explainable_minutes_trigger on public.attendance_sessions;
create trigger derive_attendance_explainable_minutes_trigger before insert or update of profile_id,site_id,clock_in_at,clock_out_at,scheduled_start_at,scheduled_end_at,overtime_minutes on public.attendance_sessions for each row execute function public.derive_attendance_explainable_minutes();
update public.attendance_sessions set updated_at=updated_at where status not in ('duplicate','rejected');
update public.system_work_items set status='review',progress=90,detail='เพิ่ม attendance policy และเวลาอธิบายนอกกะ; รอ Deploy UI และ Production smoke/UAT',evidence='Migration 202608100018 reuses existing schedule, approved OT, payroll and site-cost allocation.',production_status='migration_ready_for_production',updated_at=now() where work_key='EMP-POLICY-001';
