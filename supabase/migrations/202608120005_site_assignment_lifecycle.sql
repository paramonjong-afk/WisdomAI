-- Auditable site-assignment lifecycle: edit, end, void erroneous entry and move.
alter table public.employee_site_assignments
  add column if not exists status text not null default 'active' check(status in ('active','ended','void')),
  add column if not exists change_reason text,
  add column if not exists ended_by uuid references public.profiles(id) on delete set null,
  add column if not exists ended_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists voided_at timestamptz;

update public.employee_site_assignments
set status=case when active then 'active' else 'ended' end
where status='active' and not active;

create table if not exists public.employee_site_assignment_events(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  assignment_id uuid not null references public.employee_site_assignments(id) on delete restrict,
  event_type text not null check(event_type in ('created','updated','ended','voided','moved')),
  reason text not null,
  before_data jsonb,
  after_data jsonb,
  acted_by uuid not null references public.profiles(id) on delete restrict,
  acted_at timestamptz not null default now()
);
alter table public.employee_site_assignment_events enable row level security;
drop policy if exists employee_site_assignment_events_select on public.employee_site_assignment_events;
create policy employee_site_assignment_events_select on public.employee_site_assignment_events for select to authenticated
using(company_id=public.current_company_id() and public.is_company_manager(company_id));

create or replace function public.manage_employee_site_assignment(
  target_assignment_id uuid,target_action text,target_reason text,
  target_site_id uuid default null,target_starts_on date default null,target_ends_on date default null,
  target_work_policy_id uuid default null,target_is_primary boolean default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare target_company_id uuid:=public.current_company_id(); current_row public.employee_site_assignments%rowtype; before_row jsonb;
begin
  if target_company_id is null or not public.is_company_manager(target_company_id) then raise exception 'manager_permission_required'; end if;
  if length(trim(coalesce(target_reason,'')))<3 then raise exception 'change_reason_required'; end if;
  select * into current_row from public.employee_site_assignments where id=target_assignment_id and company_id=target_company_id for update;
  if not found then raise exception 'assignment_not_found'; end if;
  before_row:=to_jsonb(current_row);
  if target_action='void' then
    if exists(select 1 from public.attendance_sessions where assignment_id=current_row.id) then raise exception 'assignment_has_attendance_use_end_instead'; end if;
    update public.employee_site_assignments set active=false,status='void',is_primary=false,change_reason=trim(target_reason),voided_by=auth.uid(),voided_at=now(),updated_at=now() where id=current_row.id;
  elsif target_action='end' then
    if target_ends_on is null or target_ends_on<current_row.starts_on then raise exception 'invalid_assignment_end_date'; end if;
    update public.employee_site_assignments set ends_on=target_ends_on,active=target_ends_on>=current_date,status='ended',is_primary=false,change_reason=trim(target_reason),ended_by=auth.uid(),ended_at=now(),updated_at=now() where id=current_row.id;
  elsif target_action='update' then
    if current_row.status='void' then raise exception 'void_assignment_is_locked'; end if;
    if target_starts_on is null or (target_ends_on is not null and target_ends_on<target_starts_on) then raise exception 'invalid_assignment_period'; end if;
    if not exists(select 1 from public.project_sites where id=target_site_id and company_id=target_company_id) then raise exception 'site_not_in_company'; end if;
    if target_work_policy_id is not null and not exists(select 1 from public.work_policies where id=target_work_policy_id and company_id=target_company_id) then raise exception 'policy_not_in_company'; end if;
    if exists(select 1 from public.attendance_sessions where assignment_id=current_row.id and clock_in_at::date<target_starts_on) then raise exception 'assignment_start_conflicts_with_attendance'; end if;
    update public.employee_site_assignments set site_id=target_site_id,starts_on=target_starts_on,ends_on=target_ends_on,work_policy_id=target_work_policy_id,is_primary=coalesce(target_is_primary,is_primary),active=true,status='active',change_reason=trim(target_reason),updated_at=now() where id=current_row.id;
  else raise exception 'unsupported_assignment_action'; end if;
  insert into public.employee_site_assignment_events(company_id,assignment_id,event_type,reason,before_data,after_data,acted_by)
  select target_company_id,target_assignment_id,case target_action when 'void' then 'voided' when 'end' then 'ended' else 'updated' end,trim(target_reason),before_row,to_jsonb(a),auth.uid() from public.employee_site_assignments a where a.id=target_assignment_id;
  return target_assignment_id;
end;$$;
revoke all on function public.manage_employee_site_assignment(uuid,text,text,uuid,date,date,uuid,boolean) from public,anon;
grant execute on function public.manage_employee_site_assignment(uuid,text,text,uuid,date,date,uuid,boolean) to authenticated;

insert into public.system_work_items(work_key,title,category,status,progress,risk,detail,production_status,current_step,evidence)
values('WORKFORCE-SITE-LIFECYCLE-001','แก้ไข ย้าย สิ้นสุด และยกเลิกรายการไซต์แบบมี Audit','operations','review',90,'high','Auditable assignment lifecycle; void is blocked after attendance usage and never hard-deletes history.','awaiting_migration_approval','awaiting_migration_approval',jsonb_build_object('migration','202608120005','tenant_isolation',true,'hard_delete',false))
on conflict(work_key) do update set status='review',progress=90,risk='high',detail=excluded.detail,production_status=excluded.production_status,current_step=excluded.current_step,evidence=excluded.evidence,updated_at=now();
