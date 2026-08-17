-- Two-step attendance submitted from a project LINE group.
create table if not exists public.line_attendance_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  line_group_id text not null references public.line_groups(line_group_id) on delete restrict,
  requester_line_user_id text not null references public.line_senders(line_user_id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  site_id uuid not null references public.project_sites(id) on delete restrict,
  action text not null check(action in ('clock_in','clock_out')),
  requested_at timestamptz not null,
  status text not null default 'awaiting_employee_confirmation' check(status in (
    'awaiting_employee_confirmation','pending_approval','approved','rejected',
    'more_info_requested','cancelled','expired'
  )),
  employee_confirmed_at timestamptz,
  attendance_session_id uuid references public.attendance_sessions(id) on delete set null,
  decision_by uuid references public.profiles(id) on delete set null,
  decision_at timestamptz,
  decision_reason text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists line_attendance_one_active_request
  on public.line_attendance_requests(line_group_id,requester_line_user_id,action)
  where status in ('awaiting_employee_confirmation','pending_approval','more_info_requested');
create index if not exists line_attendance_company_status_idx
  on public.line_attendance_requests(company_id,status,requested_at desc);

create table if not exists public.line_attendance_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid not null references public.line_attendance_requests(id) on delete cascade,
  actor_line_user_id text,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null check(event_type in (
    'requested','employee_confirmed','employee_cancelled','approval_requested',
    'approved','rejected','more_info_requested','expired','duplicate_blocked','failed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists line_attendance_events_request_idx
  on public.line_attendance_events(request_id,created_at);

alter table public.line_attendance_requests enable row level security;
alter table public.line_attendance_events enable row level security;
create policy "Employees and managers read LINE attendance requests"
  on public.line_attendance_requests for select to authenticated
  using(company_id=public.current_company_id() and (profile_id=auth.uid() or public.is_company_manager(company_id)));
create policy "Employees and managers read LINE attendance events"
  on public.line_attendance_events for select to authenticated
  using(company_id=public.current_company_id() and exists(
    select 1 from public.line_attendance_requests r where r.id=request_id
      and (r.profile_id=auth.uid() or public.is_company_manager(r.company_id))
  ));

-- Current operating rule: retain every GPS failure as evidence and require review.
update public.attendance_gps_error_policies
set action='review', updated_at=now()
where error_code in ('permission_denied','position_unavailable','timeout','unsupported',
  'invalid_coordinate','gps_inaccurate','outside_site','no_assigned_site','suspected_spoofing','unknown');

comment on table public.line_attendance_requests is
  'LINE fallback clocking: employee confirmation followed by an authorized group-member decision.';
