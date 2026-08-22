-- Central master-data candidates, verified bank-account facts and retention.
-- Existing employee, vendor, project and work-package tables remain the source
-- of truth. This migration adds a reviewed learning layer; it does not copy or
-- delete their records.

create or replace function public.normalize_master_data_name(value text)
returns text language sql immutable set search_path=public as $$
  select lower(regexp_replace(trim(coalesce(value,'')), '[[:space:]]+', '', 'g'))
$$;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legal_name text not null,
  tax_id text,
  contact_name text,
  phone text,
  email text,
  address text,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legal_name)
);

create table if not exists public.master_data_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  entity_type text not null check (entity_type in ('employee','vendor','customer','project','work_package','bank_account')),
  display_name text not null,
  normalized_name text not null,
  candidate_data jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected','archived')),
  source_table text,
  source_id uuid,
  duplicate_of uuid references public.master_data_candidates(id) on delete set null,
  review_reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  archive_after timestamptz not null default now() + interval '90 days',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, entity_type, source_table, source_id)
);
create index if not exists master_data_candidates_inbox_idx on public.master_data_candidates(company_id,status,created_at desc);
create index if not exists master_data_candidates_retention_idx on public.master_data_candidates(status,archive_after) where status='pending_review';

create table if not exists public.master_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  owner_type text not null check (owner_type in ('employee','vendor','customer','other')),
  owner_name text not null,
  normalized_owner_name text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  employee_person_id uuid references public.employee_people(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  bank_name text,
  account_last4 text not null check (account_last4 ~ '^[0-9A-Za-z]{2,4}$'),
  account_fingerprint text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','verified','inactive','archived')),
  evidence_source_table text,
  evidence_source_id uuid,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(profile_id,employee_person_id,vendor_id,customer_id) <= 1)
);
create unique index if not exists master_bank_accounts_fingerprint_unique on public.master_bank_accounts(company_id, account_fingerprint) where account_fingerprint is not null and verification_status <> 'archived';
create index if not exists master_bank_accounts_owner_idx on public.master_bank_accounts(company_id,normalized_owner_name,verification_status);

create table if not exists public.master_data_audit (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid references public.master_data_candidates(id) on delete set null,
  bank_account_id uuid references public.master_bank_accounts(id) on delete set null,
  event_key text not null unique,
  action text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists master_data_audit_company_idx on public.master_data_audit(company_id,created_at desc);

alter table public.customers enable row level security;
alter table public.master_data_candidates enable row level security;
alter table public.master_bank_accounts enable row level security;
alter table public.master_data_audit enable row level security;

create policy "Company managers manage customers" on public.customers for all to authenticated
using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));
create policy "Company managers manage master candidates" on public.master_data_candidates for all to authenticated
using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));
create policy "Company managers manage verified account facts" on public.master_bank_accounts for all to authenticated
using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));
create policy "Company managers read master-data audit" on public.master_data_audit for select to authenticated
using (public.is_company_manager(company_id));

create or replace function public.capture_master_bank_candidate()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if nullif(btrim(new.recipient_name),'') is not null and nullif(btrim(new.recipient_account_last4),'') is not null then
    insert into public.master_data_candidates(company_id,entity_type,display_name,normalized_name,candidate_data,confidence,source_table,source_id)
    values (
      new.company_id,'bank_account',btrim(new.recipient_name),public.normalize_master_data_name(new.recipient_name),
      jsonb_build_object('bank_name',new.recipient_bank_name,'account_last4',new.recipient_account_last4,'bank_reference',new.bank_reference,'transfer_at',new.transfer_at),
      new.payment_party_confidence,'financial_transactions',new.id
    ) on conflict(company_id,entity_type,source_table,source_id) do update
      set display_name=excluded.display_name,normalized_name=excluded.normalized_name,candidate_data=excluded.candidate_data,confidence=excluded.confidence,updated_at=now()
      where public.master_data_candidates.status='pending_review';
  end if;
  return new;
end;
$$;
drop trigger if exists capture_master_bank_candidate_on_transaction on public.financial_transactions;
create trigger capture_master_bank_candidate_on_transaction after insert or update of recipient_name,recipient_bank_name,recipient_account_last4,payment_party_confidence on public.financial_transactions
for each row execute function public.capture_master_bank_candidate();

insert into public.master_data_candidates(company_id,entity_type,display_name,normalized_name,candidate_data,confidence,source_table,source_id)
select transaction.company_id,'bank_account',btrim(transaction.recipient_name),public.normalize_master_data_name(transaction.recipient_name),
  jsonb_build_object('bank_name',transaction.recipient_bank_name,'account_last4',transaction.recipient_account_last4,'bank_reference',transaction.bank_reference,'transfer_at',transaction.transfer_at),
  transaction.payment_party_confidence,'financial_transactions',transaction.id
from public.financial_transactions transaction
where nullif(btrim(transaction.recipient_name),'') is not null and nullif(btrim(transaction.recipient_account_last4),'') is not null
on conflict(company_id,entity_type,source_table,source_id) do nothing;

create or replace function public.review_master_data_candidate(
  target_candidate_id uuid,target_event_key text,target_action text,target_reason text default null
) returns public.master_data_candidates
language plpgsql security definer set search_path=public as $$
declare source_row public.master_data_candidates; result public.master_data_candidates; bank_row public.master_bank_accounts;
begin
  select * into source_row from public.master_data_candidates where id=target_candidate_id for update;
  if source_row.id is null or not public.is_company_manager(source_row.company_id) then raise exception 'master_candidate_not_found_or_denied'; end if;
  if target_action not in ('approve','reject','archive','restore') then raise exception 'master_candidate_action_invalid'; end if;
  if target_action='approve' and source_row.status<>'pending_review' then raise exception 'master_candidate_not_pending'; end if;
  if target_action='approve' and source_row.entity_type='bank_account' then
    insert into public.master_bank_accounts(company_id,owner_type,owner_name,normalized_owner_name,bank_name,account_last4,verification_status,evidence_source_table,evidence_source_id,verified_by,verified_at,created_by)
    values(source_row.company_id,'other',source_row.display_name,source_row.normalized_name,source_row.candidate_data->>'bank_name',source_row.candidate_data->>'account_last4','verified',source_row.source_table,source_row.source_id,auth.uid(),now(),auth.uid())
    on conflict do nothing returning * into bank_row;
  end if;
  update public.master_data_candidates set
    status=case target_action when 'approve' then 'approved' when 'reject' then 'rejected' when 'archive' then 'archived' when 'restore' then 'pending_review' end,
    review_reason=nullif(btrim(target_reason),''),reviewed_by=auth.uid(),reviewed_at=now(),archived_at=case when target_action='archive' then now() else null end,updated_at=now()
  where id=source_row.id returning * into result;
  insert into public.master_data_audit(company_id,candidate_id,bank_account_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(result.company_id,result.id,bank_row.id,target_event_key,'candidate_'||target_action,auth.uid(),to_jsonb(source_row),to_jsonb(result),nullif(btrim(target_reason),''));
  return result;
end;
$$;

create or replace function public.archive_expired_master_data_candidates(target_event_key text)
returns integer language plpgsql security definer set search_path=public as $$
declare changed_count integer:=0; company_row record;
begin
  for company_row in select distinct company_id from public.master_data_candidates where status='pending_review' and archive_after <= now() loop
    if public.is_company_manager(company_row.company_id) then
      with changed as (
        update public.master_data_candidates set status='archived',archived_at=now(),updated_at=now()
        where company_id=company_row.company_id and status='pending_review' and archive_after <= now() returning id
      ) select count(*) into changed_count from changed;
      insert into public.master_data_audit(company_id,event_key,action,actor_profile_id,after_data,reason)
      values(company_row.company_id,target_event_key||':'||company_row.company_id::text,'retention_archive',auth.uid(),jsonb_build_object('count',changed_count),'archive candidates older than retention period') on conflict(event_key) do nothing;
    end if;
  end loop;
  return changed_count;
end;
$$;

revoke all on function public.review_master_data_candidate(uuid,text,text,text),public.archive_expired_master_data_candidates(text) from public,anon;
grant execute on function public.review_master_data_candidate(uuid,text,text,text),public.archive_expired_master_data_candidates(text) to authenticated;
notify pgrst,'reload schema';
