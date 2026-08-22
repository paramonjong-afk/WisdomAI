-- A central, masked snapshot of the bank-account pair visibly present on a
-- transfer slip. This is evidence registry data, not a posted journal entry.
create table if not exists public.financial_transaction_account_pairs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  financial_transaction_id uuid not null unique references public.financial_transactions(id) on delete cascade,
  sender_name text,
  sender_bank_name text not null,
  sender_account_last4 text not null check(sender_account_last4 ~ '^[0-9]{4}$'),
  recipient_name text,
  recipient_bank_name text not null,
  recipient_account_last4 text not null check(recipient_account_last4 ~ '^[0-9]{4}$'),
  transfer_at timestamptz,
  bank_reference text,
  confidence numeric(4,3) not null check(confidence between 0 and 1),
  registration_status text not null default 'auto_registered'
    check(registration_status in ('auto_registered','manual_verified','needs_review')),
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists financial_transaction_account_pairs_company_status_idx
  on public.financial_transaction_account_pairs(company_id,registration_status,updated_at desc);

create table if not exists public.financial_transaction_account_pair_audit (
  id uuid primary key default gen_random_uuid(),
  account_pair_id uuid references public.financial_transaction_account_pairs(id) on delete set null,
  financial_transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  event_key text not null unique,
  action text not null check(action in ('auto_registered','marked_needs_review')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists financial_transaction_account_pair_audit_transaction_idx
  on public.financial_transaction_account_pair_audit(financial_transaction_id,created_at desc);

alter table public.financial_transaction_account_pairs enable row level security;
alter table public.financial_transaction_account_pair_audit enable row level security;
create policy "Company managers read transfer account pairs"
  on public.financial_transaction_account_pairs for select to authenticated
  using(public.is_company_manager(company_id));
create policy "Company managers read transfer account pair audit"
  on public.financial_transaction_account_pair_audit for select to authenticated
  using(public.is_company_manager(company_id));
revoke insert,update,delete on public.financial_transaction_account_pairs,public.financial_transaction_account_pair_audit from anon,authenticated;

create or replace function public.sync_transfer_slip_account_pair()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  pair_row public.financial_transaction_account_pairs;
  eligible boolean;
  event_suffix text := replace(coalesce(new.updated_at,now())::text,' ','T');
begin
  eligible := new.review_status not in ('duplicate','dismissed')
    and nullif(btrim(new.sender_bank_name),'') is not null
    and new.sender_account_last4 ~ '^[0-9]{4}$'
    and nullif(btrim(new.recipient_bank_name),'') is not null
    and new.recipient_account_last4 ~ '^[0-9]{4}$'
    and coalesce(new.payment_party_confidence,0) >= 0.900;

  if eligible then
    insert into public.financial_transaction_account_pairs(
      company_id,financial_transaction_id,sender_name,sender_bank_name,sender_account_last4,
      recipient_name,recipient_bank_name,recipient_account_last4,transfer_at,bank_reference,
      confidence,registration_status,registered_at,updated_at
    ) values (
      new.company_id,new.id,nullif(btrim(new.sender_name),''),btrim(new.sender_bank_name),new.sender_account_last4,
      nullif(btrim(new.recipient_name),''),btrim(new.recipient_bank_name),new.recipient_account_last4,new.transfer_at,new.bank_reference,
      new.payment_party_confidence,'auto_registered',now(),now()
    ) on conflict(financial_transaction_id) do update set
      sender_name=excluded.sender_name,sender_bank_name=excluded.sender_bank_name,sender_account_last4=excluded.sender_account_last4,
      recipient_name=excluded.recipient_name,recipient_bank_name=excluded.recipient_bank_name,recipient_account_last4=excluded.recipient_account_last4,
      transfer_at=excluded.transfer_at,bank_reference=excluded.bank_reference,confidence=excluded.confidence,
      registration_status=case when public.financial_transaction_account_pairs.registration_status='manual_verified' then 'manual_verified' else 'auto_registered' end,
      updated_at=now()
    returning * into pair_row;
    insert into public.financial_transaction_account_pair_audit(account_pair_id,financial_transaction_id,company_id,event_key,action,payload)
    values(pair_row.id,new.id,new.company_id,'transfer-account-pair:'||new.id::text||':'||event_suffix,'auto_registered',jsonb_build_object('confidence',new.payment_party_confidence,'source','financial_transaction_trigger'))
    on conflict(event_key) do nothing;
  elsif exists(select 1 from public.financial_transaction_account_pairs where financial_transaction_id=new.id) then
    update public.financial_transaction_account_pairs set registration_status='needs_review',updated_at=now()
    where financial_transaction_id=new.id returning * into pair_row;
    insert into public.financial_transaction_account_pair_audit(account_pair_id,financial_transaction_id,company_id,event_key,action,payload)
    values(pair_row.id,new.id,new.company_id,'transfer-account-pair-review:'||new.id::text||':'||event_suffix,'marked_needs_review',jsonb_build_object('confidence',new.payment_party_confidence,'source','financial_transaction_trigger'))
    on conflict(event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_transfer_slip_account_pair_from_financial on public.financial_transactions;
create trigger sync_transfer_slip_account_pair_from_financial
after insert or update of review_status,sender_name,sender_bank_name,sender_account_last4,recipient_name,recipient_bank_name,recipient_account_last4,transfer_at,bank_reference,payment_party_confidence
on public.financial_transactions
for each row execute function public.sync_transfer_slip_account_pair();

-- Register historical eligible slips using the exact same qualification rule.
insert into public.financial_transaction_account_pairs(
  company_id,financial_transaction_id,sender_name,sender_bank_name,sender_account_last4,
  recipient_name,recipient_bank_name,recipient_account_last4,transfer_at,bank_reference,
  confidence,registration_status,registered_at,updated_at
)
select
  transaction.company_id,transaction.id,nullif(btrim(transaction.sender_name),''),btrim(transaction.sender_bank_name),transaction.sender_account_last4,
  nullif(btrim(transaction.recipient_name),''),btrim(transaction.recipient_bank_name),transaction.recipient_account_last4,transaction.transfer_at,transaction.bank_reference,
  transaction.payment_party_confidence,'auto_registered',now(),now()
from public.financial_transactions transaction
where transaction.review_status not in ('duplicate','dismissed')
  and nullif(btrim(transaction.sender_bank_name),'') is not null
  and transaction.sender_account_last4 ~ '^[0-9]{4}$'
  and nullif(btrim(transaction.recipient_bank_name),'') is not null
  and transaction.recipient_account_last4 ~ '^[0-9]{4}$'
  and coalesce(transaction.payment_party_confidence,0) >= 0.900
on conflict(financial_transaction_id) do update set
  sender_name=excluded.sender_name,sender_bank_name=excluded.sender_bank_name,sender_account_last4=excluded.sender_account_last4,
  recipient_name=excluded.recipient_name,recipient_bank_name=excluded.recipient_bank_name,recipient_account_last4=excluded.recipient_account_last4,
  transfer_at=excluded.transfer_at,bank_reference=excluded.bank_reference,confidence=excluded.confidence,
  registration_status=case when public.financial_transaction_account_pairs.registration_status='manual_verified' then 'manual_verified' else 'auto_registered' end,
  updated_at=now();

insert into public.financial_transaction_account_pair_audit(account_pair_id,financial_transaction_id,company_id,event_key,action,payload)
select pair.id,pair.financial_transaction_id,pair.company_id,'transfer-account-pair:'||pair.financial_transaction_id::text||':backfill','auto_registered',jsonb_build_object('confidence',pair.confidence,'source','migration_backfill')
from public.financial_transaction_account_pairs pair
on conflict(event_key) do nothing;

revoke all on function public.sync_transfer_slip_account_pair() from public,anon,authenticated;
notify pgrst,'reload schema';
