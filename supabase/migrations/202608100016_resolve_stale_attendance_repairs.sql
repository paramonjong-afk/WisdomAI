-- Resolve repair proposals when their attendance source has already been fixed.
alter table public.attendance_repair_proposals
  drop constraint if exists attendance_repair_proposals_status_check;
alter table public.attendance_repair_proposals
  add constraint attendance_repair_proposals_status_check
  check(status in ('pending','applied','rejected','resolved'));

alter table public.attendance_sessions
  add column if not exists validation_overridden_by uuid references public.profiles(id) on delete set null,
  add column if not exists validation_overridden_at timestamptz,
  add column if not exists validation_override_reason text;

create or replace function public.clear_attendance_validation_override()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.clock_in_at is distinct from new.clock_in_at or old.clock_out_at is distinct from new.clock_out_at then
    new.validation_overridden_by:=null;
    new.validation_overridden_at:=null;
    new.validation_override_reason:=null;
  end if;
  return new;
end $$;

drop trigger if exists clear_attendance_validation_override_before_time_change on public.attendance_sessions;
create trigger clear_attendance_validation_override_before_time_change
before update of clock_in_at,clock_out_at on public.attendance_sessions
for each row execute function public.clear_attendance_validation_override();

create or replace function public.guard_attendance_session_duration()
returns trigger language plpgsql security definer set search_path=public as $$
declare rules record; elapsed_minutes integer; crosses_business_date boolean; invalid_reason text;
begin
  if new.status in ('rejected','duplicate') then return new; end if;
  if new.clock_out_at is null then
    new.worked_minutes:=null;new.normal_minutes:=null;new.overtime_minutes:=0;
    if new.status='needs_review' then new.calculation_status:='needs_review'; end if;
    return new;
  end if;
  select coalesce(max_shift_minutes,720) max_shift_minutes,coalesce(allow_overnight_shifts,false) allow_overnight_shifts
    into rules from public.workforce_rule_settings where company_id=new.company_id and singleton=true;
  elapsed_minutes:=floor(extract(epoch from(new.clock_out_at-new.clock_in_at))/60)::integer;
  crosses_business_date:=(new.clock_in_at at time zone 'Asia/Bangkok')::date<>(new.clock_out_at at time zone 'Asia/Bangkok')::date;
  if elapsed_minutes<0 then invalid_reason:='เวลาออกก่อนเวลาเข้า';
  elsif elapsed_minutes>coalesce(rules.max_shift_minutes,720) then invalid_reason:=format('ระยะเวลารวม %s นาที เกินกะสูงสุด %s นาที',elapsed_minutes,coalesce(rules.max_shift_minutes,720));
  elsif crosses_business_date and not coalesce(rules.allow_overnight_shifts,false) then invalid_reason:='เวลาเข้าและเวลาออกข้ามวัน แต่บริษัทไม่ได้เปิดใช้กะข้ามคืน'; end if;
  if invalid_reason is not null and new.validation_overridden_by is null then
    new.status:='needs_review';new.calculation_status:='needs_review';new.worked_minutes:=null;new.normal_minutes:=null;new.overtime_minutes:=0;
    new.review_category:='multiple';new.review_requested_at:=coalesce(new.review_requested_at,now());
    new.review_reason:=concat_ws(' · ',nullif(new.review_reason,''),invalid_reason);
  end if;
  return new;
end $$;

create or replace function public.confirm_attendance_time_is_correct(target_session_id uuid,confirmation_reason text)
returns public.attendance_sessions language plpgsql security definer set search_path=public as $$
declare session_row public.attendance_sessions; work_date date;
begin
  if length(trim(coalesce(confirmation_reason,'')))<3 then raise exception 'confirmation_reason_required'; end if;
  select * into session_row from public.attendance_sessions
    where id=target_session_id and company_id=public.current_company_id() for update;
  if session_row.id is null or not public.is_company_manager(session_row.company_id) then raise exception 'company_manager_required'; end if;
  if session_row.clock_out_at is null then raise exception 'clock_out_required'; end if;
  work_date:=(session_row.clock_in_at at time zone 'Asia/Bangkok')::date;
  if exists(select 1 from public.employee_payrolls payroll join public.pay_periods period on period.id=payroll.pay_period_id
    where payroll.company_id=session_row.company_id and payroll.profile_id=session_row.profile_id and work_date between period.starts_on and period.ends_on
      and (payroll.status in ('closed','pending_payment','paid') or period.status in ('closed','paying','paid'))) then raise exception 'payroll_period_locked'; end if;
  update public.attendance_sessions set status='approved',calculation_status='pending',review_reason=trim(confirmation_reason),
    reviewed_by=auth.uid(),reviewed_at=now(),validation_overridden_by=auth.uid(),validation_overridden_at=now(),
    validation_override_reason=trim(confirmation_reason),updated_at=now()
    where id=session_row.id returning * into session_row;
  session_row:=public.recalculate_attendance_session(session_row.id);
  update public.attendance_repair_proposals set status='resolved',decided_by=auth.uid(),decided_at=now(),
    decision_reason='confirmed_correct: '||trim(confirmation_reason),updated_at=now()
    where session_id=session_row.id and company_id=session_row.company_id and status='pending';
  insert into public.attendance_audit_logs(company_id,session_id,actor_profile_id,action,reason,old_values,new_values)
    values(session_row.company_id,session_row.id,auth.uid(),'validation_override_confirmed',trim(confirmation_reason),null,to_jsonb(session_row));
  return session_row;
end $$;

create or replace function public.attendance_session_requires_repair(target_session_id uuid)
returns boolean
language sql
security definer
set search_path=public
stable
as $$
  select exists(
    select 1
    from public.attendance_sessions session
    left join public.workforce_rule_settings rules
      on rules.company_id=session.company_id and rules.singleton=true
    where session.id=target_session_id
      and session.company_id=public.current_company_id()
      and session.status not in ('rejected','duplicate')
      and session.validation_overridden_by is null
      and (
        (session.clock_out_at is null and (session.clock_in_at at time zone 'Asia/Bangkok')::date < (current_timestamp at time zone 'Asia/Bangkok')::date)
        or (session.clock_out_at is not null and extract(epoch from(session.clock_out_at-session.clock_in_at))/60>coalesce(rules.max_shift_minutes,720))
        or (session.clock_out_at is not null and not coalesce(rules.allow_overnight_shifts,false)
          and (session.clock_in_at at time zone 'Asia/Bangkok')::date<>(session.clock_out_at at time zone 'Asia/Bangkok')::date)
      )
  );
$$;

create or replace function public.resolve_stale_attendance_repair_proposal()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.attendance_session_requires_repair(new.id) then
    update public.attendance_repair_proposals
    set status='resolved',decided_at=now(),decision_reason='resolved_by_attendance_update',updated_at=now()
    where session_id=new.id and company_id=new.company_id and status='pending';
  end if;
  return new;
end;
$$;

drop trigger if exists resolve_stale_attendance_repair_after_update on public.attendance_sessions;
create trigger resolve_stale_attendance_repair_after_update
after update of clock_in_at,clock_out_at,status on public.attendance_sessions
for each row execute function public.resolve_stale_attendance_repair_proposal();

create or replace function public.scan_attendance_repair_proposals()
returns integer language plpgsql security definer set search_path=public as $$
declare target_company uuid; changed_count integer:=0; resolved_count integer:=0;
begin
  target_company:=public.current_company_id();
  if target_company is null or not public.is_company_manager(target_company) then raise exception 'company_manager_required'; end if;

  update public.attendance_repair_proposals proposal
  set status='resolved',decided_at=now(),decision_reason='resolved_by_rescan',updated_at=now()
  where proposal.company_id=target_company and proposal.status='pending'
    and not public.attendance_session_requires_repair(proposal.session_id);
  get diagnostics resolved_count=row_count;

  with rules as (
    select coalesce(max_shift_minutes,720) max_shift_minutes,coalesce(allow_overnight_shifts,false) allow_overnight_shifts
    from public.workforce_rule_settings where company_id=target_company and singleton=true
  ), candidates as (
    select session.id,session.company_id,session.clock_in_at,session.clock_out_at,
      coalesce(policy.timezone,'Asia/Bangkok') timezone,
      coalesce(policy.work_start_time,time '08:00') work_start_time,
      coalesce(policy.work_end_time,time '17:00') work_end_time,
      coalesce(rules.max_shift_minutes,720) max_shift_minutes,
      case when session.clock_out_at is null then 'missing_clock_out'
        when extract(epoch from(session.clock_out_at-session.clock_in_at))/60>coalesce(rules.max_shift_minutes,720) then 'excessive_duration'
        else 'unexpected_cross_day' end issue_code
    from public.attendance_sessions session
    left join public.employee_employment_records employment on employment.company_id=session.company_id and employment.profile_id=session.profile_id
    left join public.project_sites site on site.company_id=session.company_id and site.id=session.site_id
    left join public.work_policies policy on policy.company_id=session.company_id and policy.id=coalesce(site.work_policy_id,employment.work_policy_id)
    left join rules on true
    where session.company_id=target_company and public.attendance_session_requires_repair(session.id)
  ), proposed as (
    select *,least(clock_in_at+make_interval(mins=>max_shift_minutes),
      case when work_end_time<=work_start_time then (((clock_in_at at time zone timezone)::date+1)+work_end_time) at time zone timezone
        else (((clock_in_at at time zone timezone)::date)+work_end_time) at time zone timezone end) proposed_out
    from candidates
  ), upserted as (
    insert into public.attendance_repair_proposals(company_id,session_id,issue_code,original_clock_out_at,proposed_clock_out_at,explanation)
    select company_id,id,issue_code,clock_out_at,greatest(clock_in_at+interval '1 minute',proposed_out),
      case issue_code when 'missing_clock_out' then 'ไม่มีเวลาออก ระบบเสนอเวลาสิ้นสุดตามตารางงาน'
        when 'excessive_duration' then 'ระยะเวลาสูงกว่ากะสูงสุด ระบบเสนอเวลาสิ้นสุดตามตารางงาน'
        else 'พบการข้ามวันโดยไม่ได้เปิดกะข้ามคืน ระบบเสนอเวลาสิ้นสุดตามตารางงาน' end
    from proposed
    on conflict(session_id) do update set issue_code=excluded.issue_code,original_clock_out_at=excluded.original_clock_out_at,
      proposed_clock_out_at=excluded.proposed_clock_out_at,explanation=excluded.explanation,
      status='pending',decided_by=null,decided_at=null,decision_reason=null,updated_at=now()
    where attendance_repair_proposals.status in ('pending','resolved')
    returning 1
  ) select count(*) into changed_count from upserted;
  return changed_count+resolved_count;
end $$;

revoke all on function public.attendance_session_requires_repair(uuid) from public,anon,authenticated;
revoke all on function public.resolve_stale_attendance_repair_proposal() from public,anon,authenticated;
revoke all on function public.clear_attendance_validation_override() from public,anon,authenticated;
revoke all on function public.confirm_attendance_time_is_correct(uuid,text) from public,anon;
revoke all on function public.scan_attendance_repair_proposals() from public,anon;
grant execute on function public.confirm_attendance_time_is_correct(uuid,text) to authenticated;
grant execute on function public.scan_attendance_repair_proposals() to authenticated;

update public.system_work_items set status='review',progress=95,
  detail='Resolve stale attendance repair proposals after manual edit or rescan; preserve applied/rejected decisions and tenant boundaries.',
  evidence='Fingerprint attendance_repair|stale_pending_after_manual_edit; migration 202608100016 and Reports date/reason display prepared.',
  production_status='awaiting_migration_202608100016_approval',updated_at=now()
where work_key='ATT-REPAIR-001';

update public.system_work_items set error_fingerprint='attendance_repair|stale_pending_after_manual_edit',
  evidence='Grouped incident: stale pending repair remained visible after manual attendance edit; source fix prepared in 202608100016.',updated_at=now()
where work_key='SYS-004';

notify pgrst,'reload schema';
