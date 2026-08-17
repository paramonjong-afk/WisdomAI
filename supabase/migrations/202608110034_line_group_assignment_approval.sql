-- LINE-GROUP-APPROVAL-001: quarantine unknown LINE groups until a Platform Admin
-- explicitly assigns exactly one active company.

create table if not exists public.line_group_assignment_requests (
  id uuid primary key default gen_random_uuid(),
  line_group_id text not null unique,
  display_name text,
  source_type text not null default 'group' check (source_type in ('group','room')),
  status text not null default 'pending' check (status in ('pending','assigned','cancelled')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_webhook_event_id text,
  notification_status text not null default 'pending' check (notification_status in ('pending','sending','sent','failed')),
  notification_attempts integer not null default 0,
  notified_at timestamptz,
  notification_error text,
  assigned_company_id uuid references public.companies(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.line_group_assignment_options (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.line_group_assignment_requests(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  unique(request_id,company_id)
);

create index if not exists line_group_assignment_requests_pending_idx
  on public.line_group_assignment_requests(status,last_seen_at desc);
create index if not exists line_group_assignment_options_request_idx
  on public.line_group_assignment_options(request_id,expires_at);

alter table public.line_group_assignment_requests enable row level security;
alter table public.line_group_assignment_options enable row level security;

drop policy if exists "Platform Admin reads LINE assignment requests" on public.line_group_assignment_requests;
create policy "Platform Admin reads LINE assignment requests"
  on public.line_group_assignment_requests for select to authenticated
  using (public.is_platform_admin());

drop policy if exists "Platform Admin reads LINE assignment options" on public.line_group_assignment_options;
create policy "Platform Admin reads LINE assignment options"
  on public.line_group_assignment_options for select to authenticated
  using (public.is_platform_admin());

revoke all on public.line_group_assignment_requests from anon,authenticated;
revoke all on public.line_group_assignment_options from anon,authenticated;
grant select on public.line_group_assignment_requests to authenticated;
grant select on public.line_group_assignment_options to authenticated;

create or replace function public.register_unassigned_line_group(
  target_line_group_id text,
  target_display_name text,
  target_source_type text,
  target_webhook_event_id text
)
returns table(request_id uuid, should_notify boolean)
language plpgsql
security definer
set search_path=public
as $$
declare request_row public.line_group_assignment_requests;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  if nullif(trim(target_line_group_id),'') is null then
    raise exception 'line_group_id_required';
  end if;
  if exists(select 1 from public.line_groups where line_group_id=trim(target_line_group_id)) then
    return;
  end if;

  insert into public.line_group_assignment_requests(
    line_group_id,display_name,source_type,last_seen_at,last_webhook_event_id
  ) values(
    trim(target_line_group_id),nullif(trim(target_display_name),''),
    case when target_source_type='room' then 'room' else 'group' end,
    now(),nullif(trim(target_webhook_event_id),'')
  )
  on conflict(line_group_id) do update set
    display_name=coalesce(nullif(trim(excluded.display_name),''),line_group_assignment_requests.display_name),
    last_seen_at=now(),
    last_webhook_event_id=coalesce(excluded.last_webhook_event_id,line_group_assignment_requests.last_webhook_event_id),
    updated_at=now()
  returning * into request_row;

  insert into public.line_group_assignment_options(request_id,company_id)
  select request_row.id,company.id from public.companies company where company.active=true
  on conflict(request_id,company_id) do update set expires_at=now()+interval '7 days';

  request_id:=request_row.id;
  should_notify:=request_row.status='pending' and (
    request_row.notification_status in ('pending','failed')
    or request_row.notified_at is null
    or request_row.notified_at < now()-interval '6 hours'
  );
  return next;
end;
$$;

create or replace function public.approve_line_group_assignment(
  target_option_id uuid,
  actor_profile_id uuid default auth.uid()
)
returns table(result_status text,line_group_id text,company_id uuid,company_name text)
language plpgsql
security definer
set search_path=public
as $$
declare option_row public.line_group_assignment_options;
declare request_row public.line_group_assignment_requests;
declare actor_is_platform_admin boolean;
begin
  select coalesce(profile.platform_role='admin',false) into actor_is_platform_admin
  from public.profiles profile where profile.id=actor_profile_id;
  if not actor_is_platform_admin then raise exception 'platform_admin_required'; end if;
  if auth.role()<>'service_role' and actor_profile_id<>auth.uid() then raise exception 'actor_mismatch'; end if;

  select * into option_row from public.line_group_assignment_options
  where id=target_option_id and expires_at>now() for update;
  if option_row.id is null then raise exception 'assignment_option_not_found_or_expired'; end if;

  select * into request_row from public.line_group_assignment_requests
  where id=option_row.request_id for update;
  if request_row.id is null then raise exception 'assignment_request_not_found'; end if;
  if request_row.status='assigned' then
    return query select 'already_assigned',request_row.line_group_id,request_row.assigned_company_id,company.name
      from public.companies company where company.id=request_row.assigned_company_id;
    return;
  end if;
  if not exists(select 1 from public.companies where id=option_row.company_id and active=true) then
    raise exception 'active_company_not_found';
  end if;

  perform set_config('app.platform_company_bootstrap','on',true);
  insert into public.line_groups(company_id,line_group_id,display_name,active,last_event_at,joined_at)
  values(option_row.company_id,request_row.line_group_id,request_row.display_name,true,request_row.last_seen_at,request_row.first_seen_at)
  on conflict(line_group_id) do update set
    display_name=coalesce(excluded.display_name,line_groups.display_name),
    last_event_at=greatest(line_groups.last_event_at,excluded.last_event_at),
    updated_at=now();

  update public.line_group_assignment_requests set
    status='assigned',assigned_company_id=option_row.company_id,assigned_by=actor_profile_id,
    assigned_at=now(),updated_at=now()
  where id=request_row.id and status='pending';

  insert into public.app_activity_logs(profile_id,company_id,event_type,severity,message,metadata)
  select actor_profile_id,option_row.company_id,'line_group_company_assignment_approved','info',
    'Platform Admin assigned a quarantined LINE Group to a company',
    jsonb_build_object('request_id',request_row.id,'line_group_id',request_row.line_group_id,
      'company_id',option_row.company_id,'approved_at',now());
  perform set_config('app.platform_company_bootstrap','off',true);

  return query select 'assigned',request_row.line_group_id,option_row.company_id,company.name
    from public.companies company where company.id=option_row.company_id;
end;
$$;

alter table public.app_activity_logs drop constraint if exists app_activity_logs_event_type_check;
alter table public.app_activity_logs add constraint app_activity_logs_event_type_check check(event_type in(
  'session_start','session_end','page_view','client_error','request_error','export_data',
  'company_created','company_switched','line_group_company_assigned',
  'line_group_company_assignment_approved'
));

revoke all on function public.register_unassigned_line_group(text,text,text,text) from public,anon,authenticated;
grant execute on function public.register_unassigned_line_group(text,text,text,text) to service_role;
revoke all on function public.approve_line_group_assignment(uuid,uuid) from public,anon;
grant execute on function public.approve_line_group_assignment(uuid,uuid) to authenticated,service_role;

