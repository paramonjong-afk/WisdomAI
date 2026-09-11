-- Durable, idempotent next-step records for actionable work when no worker has
-- an active lease. The monitor may create intents, but never starts or retries
-- business work itself.
create table public.system_work_dispatch_intents (
  id uuid primary key default gen_random_uuid(),
  work_key text not null references public.system_work_items(work_key) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  intent_kind text not null check (intent_kind in ('dispatch', 'approval', 'unblock')),
  status text not null default 'pending' check (status in ('pending', 'superseded', 'completed')),
  owner text not null,
  next_gate text not null,
  next_action text not null,
  sla_due_at timestamptz not null,
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_key, intent_kind)
);

create index system_work_dispatch_intents_pending_sla_idx
  on public.system_work_dispatch_intents (status, sla_due_at)
  where status = 'pending';

alter table public.system_work_dispatch_intents enable row level security;
revoke all on public.system_work_dispatch_intents from anon, authenticated;
grant select on public.system_work_dispatch_intents to authenticated;

create policy "Authorized users read work dispatch intents"
  on public.system_work_dispatch_intents
  for select to authenticated
  using (
    exists (
      select 1
      from public.system_work_items item
      where item.work_key = system_work_dispatch_intents.work_key
    )
  );

create or replace function public.audit_system_work_dispatch_intent_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  intent_company_id uuid;
begin
  select company_id into intent_company_id
  from public.system_work_items
  where work_key = coalesce(new.work_key, old.work_key);

  insert into public.system_work_item_events (
    work_key, company_id, event_type, note, created_at
  ) values (
    coalesce(new.work_key, old.work_key),
    intent_company_id,
    case when tg_op = 'INSERT' then 'dispatch_intent_created' else 'dispatch_intent_updated' end,
    format(
      'intent=%s; status=%s; owner=%s; next_gate=%s; sla_due_at=%s',
      coalesce(new.intent_kind, old.intent_kind),
      coalesce(new.status, old.status),
      coalesce(new.owner, old.owner),
      coalesce(new.next_gate, old.next_gate),
      coalesce(new.sla_due_at, old.sla_due_at)
    ),
    now()
  );
  return coalesce(new, old);
end;
$$;

revoke all on function public.audit_system_work_dispatch_intent_change() from public, anon, authenticated;

create trigger audit_system_work_dispatch_intent_change
after insert or update on public.system_work_dispatch_intents
for each row execute function public.audit_system_work_dispatch_intent_change();
