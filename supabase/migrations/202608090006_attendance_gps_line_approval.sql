-- Accept GPS exceptions as reviewable attendance evidence and secure review actions.
alter table public.attendance_sessions
  add column if not exists review_category text,
  add column if not exists review_requested_at timestamptz,
  add column if not exists review_channel text;

alter table public.attendance_sessions drop constraint if exists attendance_review_category_check;
alter table public.attendance_sessions add constraint attendance_review_category_check
  check (review_category is null or review_category in
    ('gps_outside','gps_inaccurate','gps_unavailable','shared_device','missing_clock_out','manual_correction','multiple'));

create index if not exists attendance_pending_gps_review_idx
  on public.attendance_sessions(company_id,status,review_requested_at desc)
  where status='needs_review';

alter table public.line_groups
  add column if not exists attendance_notifications_enabled boolean not null default true,
  add column if not exists attendance_approvals_enabled boolean not null default true,
  add column if not exists linked_by uuid references public.profiles(id) on delete set null,
  add column if not exists verified_at timestamptz;

create table if not exists public.attendance_approval_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  source text not null default 'web' check(source in ('web','line_group','admin')),
  line_group_id text,
  line_user_id text,
  action text not null check(action in ('approve','reject','request_more','correct')),
  reason text,
  old_status text not null,
  new_status text not null,
  created_at timestamptz not null default now()
);
alter table public.attendance_approval_events enable row level security;
create policy "Company managers read attendance approval events"
  on public.attendance_approval_events for select to authenticated
  using(company_id=public.current_company_id() and public.is_company_manager(company_id));

create or replace function public.review_gps_attendance(
  target_session_id uuid,
  review_action text,
  review_note text default null,
  review_source text default 'web',
  source_line_group_id text default null,
  source_line_user_id text default null
) returns public.attendance_sessions
language plpgsql security definer set search_path=public
as $$
declare before_row public.attendance_sessions; after_row public.attendance_sessions;
begin
  select * into before_row from public.attendance_sessions where id=target_session_id for update;
  if before_row.id is null then raise exception 'ไม่พบรายการลงเวลา'; end if;
  if before_row.company_id<>public.current_company_id() then raise exception 'ไม่มีสิทธิ์ข้ามบริษัท'; end if;
  if not public.is_company_manager(before_row.company_id) then raise exception 'ไม่มีสิทธิ์ตรวจรายการลงเวลา'; end if;
  if before_row.status<>'needs_review' then raise exception 'รายการนี้ไม่ได้อยู่ระหว่างรอตรวจ'; end if;
  if review_action not in ('approve','reject','request_more') then raise exception 'คำสั่งตรวจไม่ถูกต้อง'; end if;
  if review_action in ('reject','request_more') and nullif(trim(review_note),'') is null then
    raise exception 'กรุณาระบุเหตุผล';
  end if;

  update public.attendance_sessions set
    status=case review_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'needs_review' end,
    review_reason=case when review_action='approve' then coalesce(nullif(trim(review_note),''),review_reason) else trim(review_note) end,
    reviewed_by=case when review_action='request_more' then null else auth.uid() end,
    reviewed_at=case when review_action='request_more' then null else now() end,
    updated_at=now()
  where id=target_session_id returning * into after_row;

  insert into public.attendance_approval_events(
    company_id,session_id,actor_profile_id,source,line_group_id,line_user_id,action,reason,old_status,new_status
  ) values(
    before_row.company_id,before_row.id,auth.uid(),
    case when review_source in ('web','line_group','admin') then review_source else 'web' end,
    source_line_group_id,source_line_user_id,review_action,nullif(trim(review_note),''),before_row.status,after_row.status
  );
  insert into public.attendance_audit_logs(session_id,actor_profile_id,action,reason,old_values,new_values)
  values(before_row.id,auth.uid(),'gps_'||review_action,nullif(trim(review_note),''),to_jsonb(before_row),to_jsonb(after_row));
  return after_row;
end $$;

revoke all on function public.review_gps_attendance(uuid,text,text,text,text,text) from public;
grant execute on function public.review_gps_attendance(uuid,text,text,text,text,text) to authenticated;

comment on function public.review_gps_attendance is
  'Reviews GPS exceptions after validating the active company and manager membership; records immutable audit evidence.';

create table if not exists public.project_status_history(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(project_id) on delete cascade,
  status_kind text not null check(status_kind in ('primary','sales','delivery')),
  old_status text,
  new_status text not null,
  reason text,
  changed_by uuid not null references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now()
);
alter table public.project_status_history enable row level security;
create policy "Company members read project status history" on public.project_status_history
  for select to authenticated using(company_id=public.current_company_id());

create or replace function public.change_project_primary_status(target_project_id uuid,target_status text,change_reason text default null)
returns public.projects language plpgsql security definer set search_path=public as $$
declare before_row public.projects; after_row public.projects;
begin
  select * into before_row from public.projects where project_id=target_project_id for update;
  if before_row.project_id is null then raise exception 'ไม่พบโครงการ'; end if;
  if before_row.company_id<>public.current_company_id() or not public.is_company_manager(before_row.company_id) then raise exception 'ไม่มีสิทธิ์แก้สถานะโครงการ'; end if;
  if target_status not in ('active','paused','completed','archived') then raise exception 'สถานะไม่ถูกต้อง'; end if;
  if target_status in ('paused','completed','archived') and nullif(trim(change_reason),'') is null then raise exception 'กรุณาระบุเหตุผล'; end if;
  update public.projects set status=target_status,updated_at=now() where project_id=target_project_id returning * into after_row;
  insert into public.project_status_history(company_id,project_id,status_kind,old_status,new_status,reason,changed_by)
  values(before_row.company_id,before_row.project_id,'primary',before_row.status,target_status,nullif(trim(change_reason),''),auth.uid());
  return after_row;
end $$;
revoke all on function public.change_project_primary_status(uuid,text,text) from public;
grant execute on function public.change_project_primary_status(uuid,text,text) to authenticated;
