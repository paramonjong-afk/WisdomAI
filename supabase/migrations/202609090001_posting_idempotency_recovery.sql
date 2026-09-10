-- POSTING-007: durable command ledger for posting gateways.
-- This migration does not post accounting, AP, Stock or PO records. It only
-- reserves an idempotent command and records recovery/audit evidence.

create table if not exists public.posting_operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  intake_id uuid,
  document_id uuid references public.accounting_documents(id) on delete set null,
  posting_type text not null check (posting_type in ('accounting','ap','stock','purchase_order')),
  idempotency_key text not null,
  status text not null default 'reserved' check (status in ('reserved','processing','posted','failed','retry_wait','dead_letter','compensating','compensated')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  last_error text,
  next_retry_at timestamptz,
  heartbeat_at timestamptz,
  gateway_reference text,
  compensation_payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, idempotency_key)
);

create table if not exists public.posting_operation_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.posting_operations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  event_key text not null unique,
  event_type text not null check (event_type in ('reserved','started','heartbeat','posted','failed','retry_scheduled','dead_lettered','compensation_started','compensated')),
  from_status text,
  to_status text not null,
  error_code text,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists posting_operations_queue_idx
  on public.posting_operations(company_id,status,next_retry_at,updated_at);
create index if not exists posting_operation_events_operation_idx
  on public.posting_operation_events(operation_id,created_at desc);

alter table public.posting_operations enable row level security;
alter table public.posting_operation_events enable row level security;

drop policy if exists "Managers read posting operations" on public.posting_operations;
create policy "Managers read posting operations" on public.posting_operations
for select to authenticated using (
  public.is_platform_admin()
  or (company_id=public.current_company_id() and public.is_company_manager(company_id))
);
drop policy if exists "Managers read posting operation events" on public.posting_operation_events;
create policy "Managers read posting operation events" on public.posting_operation_events
for select to authenticated using (
  public.is_platform_admin()
  or (company_id=public.current_company_id() and public.is_company_manager(company_id))
);

create or replace function public.reserve_posting_operation(
  target_company_id uuid,
  target_idempotency_key text,
  target_posting_type text,
  target_intake_id uuid default null,
  target_document_id uuid default null
) returns public.posting_operations
language plpgsql security definer set search_path=public as $$
declare result_row public.posting_operations;
begin
  if target_company_id is null or nullif(trim(target_idempotency_key),'') is null then raise exception 'posting_idempotency_key_required'; end if;
  if target_posting_type not in ('accounting','ap','stock','purchase_order') then raise exception 'posting_type_invalid'; end if;
  insert into public.posting_operations(company_id,intake_id,document_id,posting_type,idempotency_key,created_by)
  values(target_company_id,target_intake_id,target_document_id,target_posting_type,trim(target_idempotency_key),auth.uid())
  on conflict(company_id,idempotency_key) do update set updated_at=now()
  returning * into result_row;
  return result_row;
end;
$$;

revoke all on function public.reserve_posting_operation(uuid,text,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.reserve_posting_operation(uuid,text,text,uuid,uuid) to service_role;

grant select on public.posting_operations, public.posting_operation_events to service_role;
