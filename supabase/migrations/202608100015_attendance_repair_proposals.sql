-- Reviewable repair proposals for legacy incomplete or implausible attendance sessions.
create table if not exists public.attendance_repair_proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  issue_code text not null check(issue_code in ('missing_clock_out','excessive_duration','unexpected_cross_day')),
  original_clock_out_at timestamptz,
  proposed_clock_out_at timestamptz not null,
  explanation text not null,
  status text not null default 'pending' check(status in ('pending','applied','rejected')),
  detected_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_reason text,
  updated_at timestamptz not null default now(),
  unique(session_id)
);

create index if not exists attendance_repair_company_status_idx
  on public.attendance_repair_proposals(company_id,status,detected_at desc);

alter table public.attendance_repair_proposals enable row level security;
drop policy if exists "Managers review attendance repairs" on public.attendance_repair_proposals;
create policy "Managers review attendance repairs" on public.attendance_repair_proposals
for select to authenticated using(public.is_company_manager(company_id));

create or replace function public.scan_attendance_repair_proposals()
returns integer language plpgsql security definer set search_path=public as $$
declare target_company uuid; inserted_count integer:=0;
begin
  target_company:=public.current_company_id();
  if target_company is null or not public.is_company_manager(target_company) then raise exception 'company_manager_required'; end if;

  with rules as (
    select coalesce(max_shift_minutes,720) max_shift_minutes,coalesce(allow_overnight_shifts,false) allow_overnight_shifts
    from public.workforce_rule_settings where company_id=target_company and singleton=true
  ), candidates as (
    select session.id,session.company_id,session.clock_in_at,session.clock_out_at,
      coalesce(policy.timezone,'Asia/Bangkok') timezone,
      coalesce(policy.work_start_time,time '08:00') work_start_time,
      coalesce(policy.work_end_time,time '17:00') work_end_time,
      coalesce(rules.max_shift_minutes,720) max_shift_minutes,
      coalesce(rules.allow_overnight_shifts,false) allow_overnight_shifts,
      case
        when session.clock_out_at is null then 'missing_clock_out'
        when extract(epoch from(session.clock_out_at-session.clock_in_at))/60>coalesce(rules.max_shift_minutes,720) then 'excessive_duration'
        else 'unexpected_cross_day'
      end issue_code
    from public.attendance_sessions session
    left join public.employee_employment_records employment on employment.company_id=session.company_id and employment.profile_id=session.profile_id
    left join public.project_sites site on site.company_id=session.company_id and site.id=session.site_id
    left join public.work_policies policy on policy.company_id=session.company_id and policy.id=coalesce(site.work_policy_id,employment.work_policy_id)
    left join rules on true
    where session.company_id=target_company and session.status not in ('rejected','duplicate') and (
      (session.clock_out_at is null and (session.clock_in_at at time zone 'Asia/Bangkok')::date < (current_timestamp at time zone 'Asia/Bangkok')::date)
      or (session.clock_out_at is not null and extract(epoch from(session.clock_out_at-session.clock_in_at))/60>coalesce(rules.max_shift_minutes,720))
      or (session.clock_out_at is not null and not coalesce(rules.allow_overnight_shifts,false)
        and (session.clock_in_at at time zone 'Asia/Bangkok')::date<>(session.clock_out_at at time zone 'Asia/Bangkok')::date)
    )
  ), proposed as (
    select *,
      least(
        clock_in_at+make_interval(mins=>max_shift_minutes),
        case when work_end_time<=work_start_time
          then (((clock_in_at at time zone timezone)::date+1)+work_end_time) at time zone timezone
          else (((clock_in_at at time zone timezone)::date)+work_end_time) at time zone timezone
        end
      ) proposed_out
    from candidates
  ), upserted as (
    insert into public.attendance_repair_proposals(company_id,session_id,issue_code,original_clock_out_at,proposed_clock_out_at,explanation)
    select company_id,id,issue_code,clock_out_at,greatest(clock_in_at+interval '1 minute',proposed_out),
      case issue_code when 'missing_clock_out' then 'ไม่มีเวลาออก ระบบเสนอเวลาสิ้นสุดตามตารางงาน'
        when 'excessive_duration' then 'ระยะเวลาสูงกว่ากะสูงสุด ระบบเสนอเวลาสิ้นสุดตามตารางงาน'
        else 'พบการข้ามวันโดยไม่ได้เปิดกะข้ามคืน ระบบเสนอเวลาสิ้นสุดตามตารางงาน' end
    from proposed
    on conflict(session_id) do update set issue_code=excluded.issue_code,original_clock_out_at=excluded.original_clock_out_at,
      proposed_clock_out_at=excluded.proposed_clock_out_at,explanation=excluded.explanation,updated_at=now()
    where attendance_repair_proposals.status='pending'
    returning 1
  ) select count(*) into inserted_count from upserted;
  return inserted_count;
end $$;

create or replace function public.decide_attendance_repair_proposal(target_proposal_id uuid,decision text,decision_note text)
returns public.attendance_repair_proposals language plpgsql security definer set search_path=public as $$
declare proposal public.attendance_repair_proposals; before_row public.attendance_sessions; after_row public.attendance_sessions; work_date date;
begin
  if decision not in ('apply','reject') then raise exception 'invalid_decision'; end if;
  if length(trim(coalesce(decision_note,'')))<3 then raise exception 'decision_reason_required'; end if;
  select * into proposal from public.attendance_repair_proposals where id=target_proposal_id and company_id=public.current_company_id() for update;
  if proposal.id is null or not public.is_company_manager(proposal.company_id) then raise exception 'company_manager_required'; end if;
  if proposal.status<>'pending' then raise exception 'proposal_already_decided'; end if;
  select * into before_row from public.attendance_sessions where id=proposal.session_id and company_id=proposal.company_id for update;
  if before_row.id is null then raise exception 'attendance_session_not_found'; end if;
  work_date:=(before_row.clock_in_at at time zone 'Asia/Bangkok')::date;
  if exists(select 1 from public.employee_payrolls payroll join public.pay_periods period on period.id=payroll.pay_period_id
    where payroll.company_id=proposal.company_id and payroll.profile_id=before_row.profile_id and work_date between period.starts_on and period.ends_on
      and (payroll.status in ('closed','pending_payment','paid') or period.status in ('closed','paying','paid'))) then
    raise exception 'payroll_period_locked';
  end if;
  if decision='apply' then
    update public.attendance_sessions set clock_out_at=proposal.proposed_clock_out_at,status='approved',review_reason=trim(decision_note),
      reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=before_row.id returning * into after_row;
    after_row:=public.recalculate_attendance_session(before_row.id);
    insert into public.attendance_audit_logs(company_id,session_id,actor_profile_id,action,reason,old_values,new_values)
      values(proposal.company_id,before_row.id,auth.uid(),'repair_applied',trim(decision_note),to_jsonb(before_row),to_jsonb(after_row));
  else
    insert into public.attendance_audit_logs(company_id,session_id,actor_profile_id,action,reason,old_values,new_values)
      values(proposal.company_id,before_row.id,auth.uid(),'repair_rejected',trim(decision_note),to_jsonb(before_row),to_jsonb(before_row));
  end if;
  update public.attendance_repair_proposals set status=case when decision='apply' then 'applied' else 'rejected' end,
    decided_by=auth.uid(),decided_at=now(),decision_reason=trim(decision_note),updated_at=now()
    where id=proposal.id returning * into proposal;
  return proposal;
end $$;

revoke all on function public.scan_attendance_repair_proposals() from public,anon;
revoke all on function public.decide_attendance_repair_proposal(uuid,text,text) from public,anon;
grant execute on function public.scan_attendance_repair_proposals() to authenticated;
grant execute on function public.decide_attendance_repair_proposal(uuid,text,text) to authenticated;

update public.system_work_items set status='done',progress=100,
  evidence='Migration 202608100014 and attendance-clock/line-webhook deployed; UAT deferred by user.',production_status='deployed_uat_deferred_by_user',updated_at=now()
where work_key='ATT-VALIDATE-001';

insert into public.system_work_items(work_key,title,category,status,progress,risk,detail,evidence,production_status,updated_at)
values('ATT-REPAIR-001','เสนอซ่อมข้อมูลลงเวลาเดิมที่ผิดปกติ','operations','review',70,'high',
  'สแกนรายการขาดเวลาออก/เกินกะ/ข้ามวัน สร้างข้อเสนอโดยไม่แก้ต้นฉบับจนผู้จัดการอนุมัติ พร้อม Payroll lock และ Audit',
  'Migration 202608100015 and frontend prepared; awaiting production approval.','awaiting_migration_approval',now())
on conflict(work_key) do update set status=excluded.status,progress=excluded.progress,detail=excluded.detail,evidence=excluded.evidence,
  production_status=excluded.production_status,updated_at=now();
