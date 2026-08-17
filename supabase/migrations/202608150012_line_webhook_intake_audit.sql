-- LINE-GROUP-APPROVAL-001: minimal pre-tenant webhook diagnostics.
-- Never persist raw webhook bodies, signatures, access tokens, or secrets.

create table if not exists public.line_webhook_intake_events (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  webhook_event_id text,
  body_sha256 text not null,
  body_size integer not null default 0 check (body_size >= 0),
  destination_sha256 text,
  signature_valid boolean not null,
  source_type text check (source_type in ('user','group','room')),
  line_group_id text,
  event_type text,
  message_type text,
  is_redelivery boolean not null default false,
  company_id uuid references public.companies(id) on delete set null,
  assignment_request_id uuid references public.line_group_assignment_requests(id) on delete set null,
  intake_status text not null check (intake_status in (
    'signature_rejected','payload_rejected','verified_empty','received',
    'tenant_resolved','quarantined','processed','skipped','failed'
  )),
  diagnostic_code text,
  diagnostic_message text,
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  processed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists line_webhook_intake_recent_idx
  on public.line_webhook_intake_events(last_seen_at desc);
create index if not exists line_webhook_intake_group_idx
  on public.line_webhook_intake_events(line_group_id,last_seen_at desc)
  where line_group_id is not null;
create index if not exists line_webhook_intake_status_idx
  on public.line_webhook_intake_events(intake_status,last_seen_at desc);

alter table public.line_webhook_intake_events enable row level security;
drop policy if exists "Platform Admin reads LINE webhook intake" on public.line_webhook_intake_events;
create policy "Platform Admin reads LINE webhook intake"
  on public.line_webhook_intake_events for select to authenticated
  using (public.is_platform_admin());

revoke all on public.line_webhook_intake_events from public,anon,authenticated;
grant select on public.line_webhook_intake_events to authenticated;

comment on table public.line_webhook_intake_events is
  'Minimal pre-tenant LINE webhook diagnostics. Never stores raw payloads, signatures, tokens, or secrets.';

create or replace function public.upsert_line_webhook_intake(
  target_fingerprint text,target_webhook_event_id text,target_body_sha256 text,
  target_body_size integer,target_destination_sha256 text,target_signature_valid boolean,
  target_source_type text,target_line_group_id text,target_event_type text,
  target_message_type text,target_is_redelivery boolean,target_intake_status text,
  target_diagnostic_code text,target_diagnostic_message text
)
returns uuid language plpgsql security definer set search_path=public
as $$
declare result_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if nullif(target_fingerprint,'') is null or nullif(target_body_sha256,'') is null then
    raise exception 'intake_identity_required';
  end if;

  insert into public.line_webhook_intake_events(
    fingerprint,webhook_event_id,body_sha256,body_size,destination_sha256,
    signature_valid,source_type,line_group_id,event_type,message_type,is_redelivery,
    intake_status,diagnostic_code,diagnostic_message
  ) values(
    left(target_fingerprint,300),nullif(left(target_webhook_event_id,200),''),left(target_body_sha256,64),
    greatest(coalesce(target_body_size,0),0),nullif(left(target_destination_sha256,64),''),target_signature_valid,
    case when target_source_type in ('user','group','room') then target_source_type else null end,
    nullif(left(target_line_group_id,200),''),nullif(left(target_event_type,80),''),
    nullif(left(target_message_type,80),''),coalesce(target_is_redelivery,false),target_intake_status,
    nullif(left(target_diagnostic_code,120),''),nullif(left(target_diagnostic_message,500),'')
  )
  on conflict(fingerprint) do update set
    webhook_event_id=coalesce(excluded.webhook_event_id,line_webhook_intake_events.webhook_event_id),
    body_sha256=excluded.body_sha256,
    body_size=excluded.body_size,
    destination_sha256=coalesce(excluded.destination_sha256,line_webhook_intake_events.destination_sha256),
    signature_valid=excluded.signature_valid,
    source_type=coalesce(excluded.source_type,line_webhook_intake_events.source_type),
    line_group_id=coalesce(excluded.line_group_id,line_webhook_intake_events.line_group_id),
    event_type=coalesce(excluded.event_type,line_webhook_intake_events.event_type),
    message_type=coalesce(excluded.message_type,line_webhook_intake_events.message_type),
    is_redelivery=line_webhook_intake_events.is_redelivery or excluded.is_redelivery,
    intake_status=excluded.intake_status,
    diagnostic_code=excluded.diagnostic_code,
    diagnostic_message=excluded.diagnostic_message,
    occurrence_count=line_webhook_intake_events.occurrence_count+1,
    last_seen_at=now(),updated_at=now()
  returning id into result_id;
  return result_id;
end;
$$;

revoke all on function public.upsert_line_webhook_intake(text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.upsert_line_webhook_intake(text,text,text,integer,text,boolean,text,text,text,text,boolean,text,text,text) to service_role;

update public.system_work_items
set status='doing',progress=99,
    detail='Deploy LINE Webhook Intake Audit and complete live LINE UAT',
    updated_at=now()
where work_key='LINE-GROUP-APPROVAL-001' and status in ('ready','doing','review');
