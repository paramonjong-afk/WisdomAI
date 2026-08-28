-- PromptPay is a payment alias, not a bank account. Keep the original slip
-- evidence immutable and attach reviewed aliases to canonical parties.

create table if not exists public.master_payment_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  owner_type text not null check (owner_type in ('employee','vendor','customer','company','other')),
  owner_name text not null,
  normalized_owner_name text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  employee_person_id uuid references public.employee_people(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  alias_type text not null check (alias_type in ('mobile','national_id','tax_id','ewallet_id','unknown_masked')),
  masked_value text not null,
  alias_fingerprint text,
  linked_bank_account_id uuid references public.master_bank_accounts(id) on delete set null,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','verified','conflict','inactive','archived')),
  evidence_source_table text,
  evidence_source_id uuid,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(profile_id,employee_person_id,vendor_id,customer_id) <= 1)
);

create unique index if not exists master_payment_aliases_fingerprint_unique
  on public.master_payment_aliases(company_id,alias_type,alias_fingerprint)
  where alias_fingerprint is not null and verification_status not in ('archived','inactive');
create unique index if not exists master_payment_aliases_masked_owner_unique
  on public.master_payment_aliases(company_id,alias_type,masked_value,normalized_owner_name)
  where alias_fingerprint is null and verification_status not in ('archived','inactive');
create index if not exists master_payment_aliases_owner_idx
  on public.master_payment_aliases(company_id,owner_type,normalized_owner_name,verification_status);

create table if not exists public.financial_transaction_party_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  financial_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  party_role text not null check (party_role in ('sender','recipient')),
  payment_method text not null check (payment_method in ('bank_account','promptpay','unknown')),
  evidence_name text,
  evidence_bank_name text,
  evidence_account_last4 text,
  canonical_party_type text check (canonical_party_type is null or canonical_party_type in ('employee','vendor','customer','company','other')),
  canonical_party_id uuid,
  canonical_party_name text,
  payment_alias_id uuid references public.master_payment_aliases(id) on delete set null,
  bank_account_id uuid references public.master_bank_accounts(id) on delete set null,
  match_status text not null check (match_status in ('evidence_only','matched','needs_review','conflict')),
  match_reason text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  event_key text not null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,financial_transaction_id,party_role),
  unique(company_id,event_key)
);
create index if not exists financial_transaction_party_links_alias_idx
  on public.financial_transaction_party_links(company_id,payment_alias_id,updated_at desc)
  where payment_alias_id is not null;
create index if not exists financial_transaction_party_links_canonical_idx
  on public.financial_transaction_party_links(company_id,canonical_party_type,canonical_party_id,updated_at desc)
  where canonical_party_id is not null;

create table if not exists public.payment_alias_audit (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_alias_id uuid references public.master_payment_aliases(id) on delete set null,
  party_link_id uuid references public.financial_transaction_party_links(id) on delete set null,
  financial_transaction_id uuid references public.financial_transactions(id) on delete set null,
  event_key text not null,
  action text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now(),
  unique(company_id,event_key)
);

alter table public.master_payment_aliases enable row level security;
alter table public.financial_transaction_party_links enable row level security;
alter table public.payment_alias_audit enable row level security;
revoke all on public.master_payment_aliases,public.financial_transaction_party_links,public.payment_alias_audit from public,anon,authenticated;
grant select on public.master_payment_aliases,public.financial_transaction_party_links,public.payment_alias_audit to authenticated;

create policy "Authorised teams read payment aliases" on public.master_payment_aliases for select to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
  or public.is_document_flow_department_member(company_id,'accounting')
  or public.is_document_flow_department_member(company_id,'hr')
);
create policy "Authorised teams read transaction party links" on public.financial_transaction_party_links for select to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
  or public.is_document_flow_department_member(company_id,'accounting')
  or public.is_document_flow_department_member(company_id,'hr')
);
create policy "Authorised teams read payment alias audit" on public.payment_alias_audit for select to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
  or public.is_document_flow_department_member(company_id,'accounting')
  or public.is_document_flow_department_member(company_id,'hr')
);

create or replace function public.normalize_payment_alias(target_value text)
returns text language sql immutable set search_path='' as $$
  select upper(regexp_replace(coalesce(target_value,''),'[^0-9A-Za-z]','','g'))
$$;

create or replace function public.mask_payment_alias(target_value text)
returns text language sql immutable set search_path='' as $$
  select case
    when length(public.normalize_payment_alias(target_value)) <= 4 then '•••• ' || public.normalize_payment_alias(target_value)
    else '•••• ' || right(public.normalize_payment_alias(target_value),4)
  end
$$;

create or replace function public.review_transfer_slip_payment_parties_v1(
  target_item_id uuid,
  target_event_key text,
  target_parties jsonb,
  target_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  item_row public.document_flow_items;
  transaction_row public.financial_transactions;
  party jsonb;
  role_value text;
  method_value text;
  alias_type_value text;
  alias_input text;
  alias_normalized text;
  alias_masked text;
  alias_fingerprint_value text;
  evidence_name_value text;
  canonical_name_value text;
  normalized_name_value text;
  candidate_count integer;
  owner_type_value text := 'other';
  owner_id_value uuid;
  profile_id_value uuid;
  employee_person_id_value uuid;
  vendor_id_value uuid;
  customer_id_value uuid;
  alias_row public.master_payment_aliases;
  previous_alias public.master_payment_aliases;
  link_row public.financial_transaction_party_links;
  previous_link public.financial_transaction_party_links;
  bank_row public.master_bank_accounts;
  match_status_value text;
  match_reason_value text;
  results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'workflow_authentication_required'; end if;
  if nullif(btrim(target_event_key),'') is null then raise exception 'workflow_event_key_required'; end if;
  if jsonb_typeof(coalesce(target_parties,'[]'::jsonb)) <> 'array' then raise exception 'payment_parties_invalid'; end if;

  select * into item_row from public.document_flow_items where id=target_item_id for update;
  if item_row.id is null then raise exception 'document_flow_item_not_found'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(item_row.company_id)
    and not public.is_document_flow_department_member(item_row.company_id,'accounting')
  then raise exception 'workflow_permission_denied'; end if;
  select * into transaction_row from public.financial_transactions
  where source_message_id=item_row.source_message_id and review_status not in ('duplicate','dismissed')
  order by created_at desc limit 1;
  if transaction_row.id is null then raise exception 'financial_transaction_not_found'; end if;

  for party in select value from jsonb_array_elements(coalesce(target_parties,'[]'::jsonb)) loop
    role_value := coalesce(party->>'party_role','');
    method_value := coalesce(party->>'payment_method','unknown');
    alias_type_value := coalesce(party->>'alias_type','unknown_masked');
    alias_input := coalesce(party->>'alias_value','');
    if role_value not in ('sender','recipient') then raise exception 'payment_party_role_invalid'; end if;
    if method_value not in ('bank_account','promptpay','unknown') then raise exception 'payment_method_invalid'; end if;
    if alias_type_value not in ('mobile','national_id','tax_id','ewallet_id','unknown_masked') then raise exception 'payment_alias_type_invalid'; end if;

    evidence_name_value := case when role_value='sender' then transaction_row.sender_name else transaction_row.recipient_name end;
    canonical_name_value := coalesce(nullif(btrim(party->>'canonical_name'),''),evidence_name_value);
    normalized_name_value := public.normalize_master_data_name(canonical_name_value);
    owner_type_value := 'other'; owner_id_value := null; profile_id_value := null; employee_person_id_value := null;
    vendor_id_value := null; customer_id_value := null; candidate_count := 0;

    select count(*),(array_agg(candidate.party_id order by candidate.priority,candidate.party_id))[1],
      (array_agg(candidate.owner_type order by candidate.priority,candidate.party_id))[1]
    into candidate_count,owner_id_value,owner_type_value
    from (
      select profile.id party_id,'employee'::text owner_type,1 priority
      from public.profiles profile
      join public.employee_employment_records employment on employment.profile_id=profile.id
      where employment.company_id=item_row.company_id and employment.employment_status in ('active','probation','notice')
        and public.normalize_master_data_name(profile.full_name)=normalized_name_value
      union
      select vendor.id,'vendor',2 from public.vendors vendor
      where vendor.company_id=item_row.company_id and public.normalize_master_data_name(vendor.name)=normalized_name_value
      union
      select customer.id,'customer',3 from public.customers customer
      where customer.company_id=item_row.company_id and customer.status='active'
        and public.normalize_master_data_name(customer.legal_name)=normalized_name_value
      union
      select company.id,'company',4 from public.companies company
      where company.id=item_row.company_id and public.normalize_master_data_name(company.name)=normalized_name_value
    ) candidate;
    if candidate_count=1 then
      if owner_type_value='employee' then
        profile_id_value:=owner_id_value;
        select person.id into employee_person_id_value from public.employee_people person
        where person.company_id=item_row.company_id and person.profile_id=profile_id_value order by person.updated_at desc limit 1;
      elsif owner_type_value='vendor' then vendor_id_value:=owner_id_value;
      elsif owner_type_value='customer' then customer_id_value:=owner_id_value;
      end if;
    else
      owner_id_value:=null; owner_type_value:='other';
    end if;

    alias_row:=null; previous_alias:=null; bank_row:=null;
    if method_value='promptpay' then
      alias_normalized:=public.normalize_payment_alias(alias_input);
      if length(alias_normalized)<4 then raise exception 'payment_alias_value_required:%',role_value; end if;
      alias_masked:=public.mask_payment_alias(alias_input);
      alias_fingerprint_value:=case
        when alias_input ~ '[*xX•]' then null
        when (alias_type_value='mobile' and length(alias_normalized)=10)
          or (alias_type_value in ('national_id','tax_id') and length(alias_normalized)=13)
          or (alias_type_value='ewallet_id' and length(alias_normalized)>=6)
        then encode(extensions.digest(item_row.company_id::text||':'||alias_type_value||':'||alias_normalized,'sha256'),'hex')
        else null end;

      if alias_fingerprint_value is not null then
        select * into previous_alias from public.master_payment_aliases alias
        where alias.company_id=item_row.company_id and alias.alias_type=alias_type_value
          and alias.alias_fingerprint=alias_fingerprint_value and alias.verification_status not in ('archived','inactive') for update;
      else
        select * into previous_alias from public.master_payment_aliases alias
        where alias.company_id=item_row.company_id and alias.alias_type=alias_type_value and alias.masked_value=alias_masked
          and alias.normalized_owner_name=normalized_name_value and alias.verification_status not in ('archived','inactive') for update;
      end if;

      if previous_alias.id is not null and previous_alias.normalized_owner_name<>normalized_name_value then
        match_status_value:='conflict'; match_reason_value:='PromptPay เดิมผูกกับเจ้าของ Canonical คนอื่น'; alias_row:=previous_alias;
      else
        match_status_value:=case when candidate_count=1 and alias_fingerprint_value is not null then 'matched' else 'needs_review' end;
        match_reason_value:=case when candidate_count>1 then 'ชื่อ Canonical ตรงมากกว่าหนึ่งทะเบียน'
          when candidate_count=0 then 'ยังไม่พบเจ้าของในทะเบียนกลาง'
          when alias_fingerprint_value is null then 'มีเพียงเลขปกปิด จึงยังยืนยัน Alias ถาวรไม่ได้'
          else 'Admin ยืนยัน PromptPay และพบเจ้าของ Canonical ตรงหนึ่งรายการ' end;
        if previous_alias.id is null then
          insert into public.master_payment_aliases(company_id,owner_type,owner_name,normalized_owner_name,profile_id,employee_person_id,vendor_id,customer_id,
            alias_type,masked_value,alias_fingerprint,verification_status,evidence_source_table,evidence_source_id,verified_by,verified_at,created_by)
          values(item_row.company_id,owner_type_value,coalesce(canonical_name_value,'ไม่ระบุ'),normalized_name_value,profile_id_value,employee_person_id_value,vendor_id_value,customer_id_value,
            alias_type_value,alias_masked,alias_fingerprint_value,case when match_status_value='matched' then 'verified' else 'unverified' end,
            'financial_transactions',transaction_row.id,case when match_status_value='matched' then auth.uid() end,case when match_status_value='matched' then now() end,auth.uid())
          returning * into alias_row;
        else
          alias_row:=previous_alias;
        end if;
      end if;
    else
      select * into bank_row from public.master_bank_accounts account
      where account.company_id=item_row.company_id and account.normalized_owner_name=normalized_name_value
        and account.account_last4=case when role_value='sender' then transaction_row.sender_account_last4 else transaction_row.recipient_account_last4 end
        and account.verification_status not in ('archived','inactive') order by account.verified_at desc nulls last limit 1;
      match_status_value:=case when bank_row.id is not null then 'matched' else 'needs_review' end;
      match_reason_value:=case when bank_row.id is not null then 'เชื่อมบัญชีธนาคาร Canonical แล้ว' else 'ยังไม่พบบัญชีธนาคาร Canonical ที่ตรงกัน' end;
    end if;

    select * into previous_link from public.financial_transaction_party_links link
    where link.company_id=item_row.company_id and link.financial_transaction_id=transaction_row.id and link.party_role=role_value for update;
    insert into public.financial_transaction_party_links(company_id,financial_transaction_id,party_role,payment_method,evidence_name,evidence_bank_name,evidence_account_last4,
      canonical_party_type,canonical_party_id,canonical_party_name,payment_alias_id,bank_account_id,match_status,match_reason,source_snapshot,event_key,reviewed_by,reviewed_at)
    values(item_row.company_id,transaction_row.id,role_value,method_value,evidence_name_value,
      case when role_value='sender' then transaction_row.sender_bank_name else transaction_row.recipient_bank_name end,
      case when role_value='sender' then transaction_row.sender_account_last4 else transaction_row.recipient_account_last4 end,
      case when candidate_count=1 then owner_type_value end,case when candidate_count=1 then owner_id_value end,canonical_name_value,alias_row.id,bank_row.id,
      match_status_value,match_reason_value,jsonb_build_object('source','financial_transactions','transaction_id',transaction_row.id,'document_item_id',item_row.id),
      target_event_key||':'||role_value,auth.uid(),now())
    on conflict(company_id,financial_transaction_id,party_role) do update set payment_method=excluded.payment_method,
      evidence_name=excluded.evidence_name,evidence_bank_name=excluded.evidence_bank_name,evidence_account_last4=excluded.evidence_account_last4,
      canonical_party_type=excluded.canonical_party_type,canonical_party_id=excluded.canonical_party_id,canonical_party_name=excluded.canonical_party_name,
      payment_alias_id=excluded.payment_alias_id,bank_account_id=excluded.bank_account_id,match_status=excluded.match_status,
      match_reason=excluded.match_reason,source_snapshot=excluded.source_snapshot,version=public.financial_transaction_party_links.version+1,
      event_key=excluded.event_key,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    returning * into link_row;

    insert into public.payment_alias_audit(company_id,payment_alias_id,party_link_id,financial_transaction_id,event_key,action,actor_profile_id,before_data,after_data,reason)
    values(item_row.company_id,alias_row.id,link_row.id,transaction_row.id,target_event_key||':'||role_value,
      'transfer_party_reviewed',auth.uid(),to_jsonb(previous_link),to_jsonb(link_row),coalesce(nullif(btrim(target_reason),''),match_reason_value))
    on conflict(company_id,event_key) do nothing;
    results:=results||jsonb_build_array(jsonb_build_object('party_role',role_value,'payment_method',method_value,'match_status',match_status_value,
      'match_reason',match_reason_value,'canonical_party_type',link_row.canonical_party_type,'canonical_party_id',link_row.canonical_party_id,
      'canonical_party_name',link_row.canonical_party_name,'payment_alias_id',link_row.payment_alias_id,'bank_account_id',link_row.bank_account_id,
      'masked_alias',alias_row.masked_value));
  end loop;

  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(item_row.id,item_row.company_id,target_event_key,'transfer_slip_payment_parties_reviewed',item_row.current_flow,item_row.current_flow,
    item_row.state,item_row.state,item_row.current_room,item_row.current_room,'บันทึกช่องทางรับจ่ายแยกสองฝั่ง โดยไม่แก้หลักฐาน OCR เดิม',
    jsonb_build_object('transaction_id',transaction_row.id,'parties',results),auth.uid()) on conflict(event_key) do nothing;
  return jsonb_build_object('transaction_id',transaction_row.id,'parties',results);
end;
$$;

revoke all on function public.review_transfer_slip_payment_parties_v1(uuid,text,jsonb,text) from public,anon;
grant execute on function public.review_transfer_slip_payment_parties_v1(uuid,text,jsonb,text) to authenticated;

-- Existing explicit PromptPay rows become evidence-only. They are not treated
-- as verified aliases because old slips expose only masked account fragments.
insert into public.master_payment_aliases(company_id,owner_type,owner_name,normalized_owner_name,alias_type,masked_value,
  verification_status,evidence_source_table,evidence_source_id)
select transaction.company_id,'other',coalesce(nullif(btrim(transaction.sender_name),''),'ไม่ระบุ'),
  public.normalize_master_data_name(transaction.sender_name),'unknown_masked',public.mask_payment_alias(transaction.sender_account_last4),
  'unverified','financial_transactions',transaction.id
from public.financial_transactions transaction
where concat_ws(' ',transaction.sender_bank_name) ~* '(prompt[[:space:]_-]*pay|พร้อม[[:space:]]*เพย์)'
  and nullif(transaction.sender_account_last4,'') is not null
on conflict do nothing;

insert into public.master_payment_aliases(company_id,owner_type,owner_name,normalized_owner_name,alias_type,masked_value,
  verification_status,evidence_source_table,evidence_source_id)
select transaction.company_id,'other',coalesce(nullif(btrim(transaction.recipient_name),''),'ไม่ระบุ'),
  public.normalize_master_data_name(transaction.recipient_name),'unknown_masked',public.mask_payment_alias(transaction.recipient_account_last4),
  'unverified','financial_transactions',transaction.id
from public.financial_transactions transaction
where concat_ws(' ',transaction.recipient_bank_name) ~* '(prompt[[:space:]_-]*pay|พร้อม[[:space:]]*เพย์)'
  and nullif(transaction.recipient_account_last4,'') is not null
on conflict do nothing;

notify pgrst,'reload schema';
