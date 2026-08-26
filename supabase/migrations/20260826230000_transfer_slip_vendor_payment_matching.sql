-- Vendor matching for payments made from a personal/employee account.
-- The payer is evidence about who initiated the transfer; the vendor is the
-- business beneficiary from the receipt/invoice/project context.  They are
-- deliberately stored as separate facts and never inferred from a name alone.

create table if not exists public.transfer_slip_vendor_matches (
  id uuid primary key default gen_random_uuid(),
  lineage_id uuid not null references public.transfer_slip_money_lineages(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  allocation_key text not null,
  vendor_id uuid references public.vendors(id) on delete set null,
  vendor_name text,
  vendor_tax_id text,
  vendor_bank_name text,
  vendor_account_last4 text,
  payer_name text,
  match_status text not null default 'needs_review' check (match_status in ('matched','candidate','ambiguous','needs_review','not_applicable')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reason text not null,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  source_item_id uuid not null references public.document_flow_items(id) on delete restrict,
  source_message_id uuid references public.line_messages(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lineage_id, allocation_key)
);

create index if not exists transfer_slip_vendor_matches_queue_idx
  on public.transfer_slip_vendor_matches(company_id, match_status, updated_at desc);
create index if not exists transfer_slip_vendor_matches_vendor_idx
  on public.transfer_slip_vendor_matches(company_id, vendor_id, vendor_bank_name, vendor_account_last4)
  where vendor_id is not null;

create table if not exists public.vendor_bank_account_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  alias_name text,
  bank_name text not null,
  account_last4 text not null check (account_last4 ~ '^[0-9]{4}$'),
  source_match_id uuid not null references public.transfer_slip_vendor_matches(id) on delete restrict,
  status text not null default 'confirmed' check (status in ('pending','confirmed','rejected','archived')),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, vendor_id, bank_name, account_last4)
);

alter table public.transfer_slip_vendor_matches enable row level security;
alter table public.vendor_bank_account_aliases enable row level security;
revoke all on table public.transfer_slip_vendor_matches from anon, authenticated;
revoke all on table public.vendor_bank_account_aliases from anon, authenticated;
grant select on table public.transfer_slip_vendor_matches to authenticated;
grant select on table public.vendor_bank_account_aliases to authenticated;

drop policy if exists "Managers and accounting read vendor matches" on public.transfer_slip_vendor_matches;
create policy "Managers and accounting read vendor matches"
on public.transfer_slip_vendor_matches for select to authenticated
using (
  company_id = public.current_company_id()
  and (public.is_platform_admin() or public.is_company_manager(company_id)
    or public.is_document_flow_department_member(company_id, 'accounting'))
);

drop policy if exists "Managers and accounting read vendor aliases" on public.vendor_bank_account_aliases;
create policy "Managers and accounting read vendor aliases"
on public.vendor_bank_account_aliases for select to authenticated
using (
  company_id = public.current_company_id()
  and (public.is_platform_admin() or public.is_company_manager(company_id)
    or public.is_document_flow_department_member(company_id, 'accounting'))
);

create or replace function public.save_transfer_slip_vendor_match_v1(
  target_lineage_id uuid,
  target_allocation_key text,
  target_event_key text,
  target_vendor_id uuid default null,
  target_vendor_name text default null,
  target_vendor_tax_id text default null,
  target_vendor_bank_name text default null,
  target_vendor_account_last4 text default null,
  target_payer_name text default null,
  target_match_status text default 'needs_review',
  target_confidence numeric default null,
  target_reason text default '',
  target_evidence jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lineage_row public.transfer_slip_money_lineages;
  item_row public.document_flow_items;
  existing_row public.transfer_slip_vendor_matches;
  result_row public.transfer_slip_vendor_matches;
  before_payload jsonb;
begin
  if auth.uid() is null then raise exception 'workflow_authentication_required'; end if;
  if nullif(btrim(target_event_key), '') is null then raise exception 'workflow_event_key_required'; end if;
  if nullif(btrim(target_allocation_key), '') is null then raise exception 'vendor_allocation_key_required'; end if;
  if target_match_status not in ('matched','candidate','ambiguous','needs_review','not_applicable') then raise exception 'vendor_match_status_invalid'; end if;
  if nullif(btrim(target_reason), '') is null or length(btrim(target_reason)) < 3 then raise exception 'vendor_match_reason_required'; end if;
  if jsonb_typeof(coalesce(target_evidence, '[]'::jsonb)) <> 'array' then raise exception 'vendor_match_evidence_invalid'; end if;
  if target_match_status = 'matched' and target_vendor_id is null then raise exception 'vendor_match_vendor_required'; end if;
  if target_vendor_id is not null and not exists (select 1 from public.vendors where id = target_vendor_id) then raise exception 'vendor_not_found'; end if;

  if exists (select 1 from public.document_flow_events where event_key = target_event_key) then
    return (select payload from public.document_flow_events where event_key = target_event_key limit 1);
  end if;

  select * into lineage_row from public.transfer_slip_money_lineages where id = target_lineage_id for update;
  if lineage_row.id is null then raise exception 'money_lineage_not_found'; end if;
  select * into item_row from public.document_flow_items where id = lineage_row.item_id for update;
  if item_row.id is null then raise exception 'document_flow_item_not_found'; end if;
  if item_row.company_id <> public.current_company_id() and not public.is_platform_admin() then raise exception 'workflow_permission_denied'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(item_row.company_id) then raise exception 'workflow_permission_denied'; end if;
  if not exists (
    select 1 from public.transfer_slip_money_allocations allocation
    where allocation.lineage_id = target_lineage_id
      and allocation.allocation_key = target_allocation_key
      and allocation.status not in ('superseded','cancelled')
  ) then raise exception 'money_allocation_not_found'; end if;

  select * into existing_row from public.transfer_slip_vendor_matches
  where lineage_id = target_lineage_id and allocation_key = target_allocation_key for update;
  before_payload := case when existing_row.id is null then '{}'::jsonb else to_jsonb(existing_row) end;

  insert into public.transfer_slip_vendor_matches(
    lineage_id, company_id, allocation_key, vendor_id, vendor_name, vendor_tax_id,
    vendor_bank_name, vendor_account_last4, payer_name, match_status, confidence,
    reason, evidence, source_item_id, source_message_id, reviewed_by, reviewed_at, version
  ) values (
    target_lineage_id, item_row.company_id, target_allocation_key, target_vendor_id,
    nullif(btrim(target_vendor_name), ''), nullif(btrim(target_vendor_tax_id), ''),
    nullif(btrim(target_vendor_bank_name), ''), nullif(regexp_replace(coalesce(target_vendor_account_last4, ''), '\D', '', 'g'), ''),
    nullif(btrim(target_payer_name), ''), target_match_status, target_confidence, btrim(target_reason),
    coalesce(target_evidence, '[]'::jsonb), item_row.id, item_row.source_message_id, auth.uid(), now(),
    coalesce(existing_row.version + 1, 1)
  ) on conflict (lineage_id, allocation_key) do update set
    vendor_id = excluded.vendor_id, vendor_name = excluded.vendor_name, vendor_tax_id = excluded.vendor_tax_id,
    vendor_bank_name = excluded.vendor_bank_name, vendor_account_last4 = excluded.vendor_account_last4,
    payer_name = excluded.payer_name, match_status = excluded.match_status, confidence = excluded.confidence,
    reason = excluded.reason, evidence = excluded.evidence, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, version = public.transfer_slip_vendor_matches.version + 1, updated_at = now()
  returning * into result_row;

  if result_row.match_status = 'matched' and result_row.vendor_id is not null
    and result_row.vendor_bank_name is not null and result_row.vendor_account_last4 is not null
    and result_row.vendor_account_last4 ~ '^[0-9]{4}$' then
    insert into public.vendor_bank_account_aliases(
      company_id, vendor_id, alias_name, bank_name, account_last4, source_match_id,
      status, evidence, verified_by, verified_at
    ) values (
      result_row.company_id, result_row.vendor_id, result_row.vendor_name, result_row.vendor_bank_name,
      result_row.vendor_account_last4, result_row.id, 'confirmed', result_row.evidence, auth.uid(), now()
    ) on conflict (company_id, vendor_id, bank_name, account_last4) do update set
      alias_name = excluded.alias_name, source_match_id = excluded.source_match_id,
      status = 'confirmed', evidence = excluded.evidence, verified_by = excluded.verified_by,
      verified_at = excluded.verified_at, updated_at = now();
  end if;

  insert into public.document_flow_events(
    item_id, company_id, event_key, event_type, from_flow, to_flow, from_state, to_state,
    from_room, to_room, note, payload, actor_id
  ) values (
    item_row.id, item_row.company_id, target_event_key, 'transfer_slip_vendor_match_review',
    item_row.current_flow, item_row.current_flow, item_row.state, item_row.state,
    item_row.current_room, item_row.current_room, btrim(target_reason),
    jsonb_build_object('lineage_id', target_lineage_id, 'allocation_key', target_allocation_key,
      'before', before_payload, 'after', to_jsonb(result_row), 'payer_name', result_row.payer_name,
      'vendor_id', result_row.vendor_id, 'match_status', result_row.match_status), auth.uid()
  );

  return jsonb_build_object('match_id', result_row.id, 'lineage_id', result_row.lineage_id,
    'allocation_key', result_row.allocation_key, 'match_status', result_row.match_status,
    'vendor_id', result_row.vendor_id, 'version', result_row.version);
end;
$$;

revoke all on function public.save_transfer_slip_vendor_match_v1(uuid,text,text,uuid,text,text,text,text,text,text,numeric,text,jsonb) from public, anon;
grant execute on function public.save_transfer_slip_vendor_match_v1(uuid,text,text,uuid,text,text,text,text,text,text,numeric,text,jsonb) to authenticated;

-- The final confirmation is blocked unless the vendor allocation has a
-- matched evidence row. A personal payer can therefore never silently become
-- the vendor merely because the recipient name looks similar.
create or replace function public.enforce_transfer_slip_vendor_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.purpose_type = 'vendor_payment' and new.status in ('confirmed','routed','reconciled')
    and not exists (
      select 1 from public.transfer_slip_vendor_matches match
      where match.lineage_id = new.lineage_id
        and match.allocation_key = new.allocation_key
        and match.match_status = 'matched'
        and match.vendor_id is not null
    ) then
    raise exception 'vendor_payment_match_required:%', new.allocation_key;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_transfer_slip_vendor_match on public.transfer_slip_money_allocations;
create trigger enforce_transfer_slip_vendor_match
before insert or update on public.transfer_slip_money_allocations
for each row execute function public.enforce_transfer_slip_vendor_match();

notify pgrst, 'reload schema';
