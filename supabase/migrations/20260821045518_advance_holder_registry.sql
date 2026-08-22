create table public.employee_advance_holders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  holder_profile_id uuid references public.profiles(id) on delete restrict,
  holder_person_id uuid references public.employee_people(id) on delete restrict,
  display_name text not null,
  destination_bank_name text not null,
  destination_account_last4 text not null check(destination_account_last4 ~ '^[0-9]{4}$'),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(num_nonnulls(holder_profile_id, holder_person_id) = 1),
  unique(company_id, destination_bank_name, destination_account_last4)
);
create unique index employee_advance_holders_profile_unique
  on public.employee_advance_holders(company_id, holder_profile_id)
  where holder_profile_id is not null;
create unique index employee_advance_holders_person_unique
  on public.employee_advance_holders(company_id, holder_person_id)
  where holder_person_id is not null;

create table public.employee_advance_holder_aliases (
  id uuid primary key default gen_random_uuid(),
  holder_id uuid not null references public.employee_advance_holders(id) on delete cascade,
  alias_name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(holder_id, alias_name)
);

create table public.employee_advance_holder_audit (
  id uuid primary key default gen_random_uuid(),
  holder_id uuid references public.employee_advance_holders(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  event_key text not null unique,
  action text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

alter table public.employee_advance_holders enable row level security;
alter table public.employee_advance_holder_aliases enable row level security;
alter table public.employee_advance_holder_audit enable row level security;
create policy "Company managers read advance holders" on public.employee_advance_holders
  for select to authenticated using(public.is_company_manager(company_id));
create policy "Company managers read advance holder aliases" on public.employee_advance_holder_aliases
  for select to authenticated using(exists(select 1 from public.employee_advance_holders holder where holder.id=holder_id and public.is_company_manager(holder.company_id)));
create policy "Company managers read advance holder audit" on public.employee_advance_holder_audit
  for select to authenticated using(public.is_company_manager(company_id));
revoke insert, update, delete on public.employee_advance_holders, public.employee_advance_holder_aliases, public.employee_advance_holder_audit from anon, authenticated;

create or replace function public.upsert_employee_advance_holder(
  target_profile_id uuid,
  target_person_id uuid,
  target_bank_name text,
  target_account_last4 text,
  target_is_active boolean,
  target_event_key text
) returns public.employee_advance_holders
language plpgsql security definer set search_path=public as $$
declare
  target_company_id uuid;
  target_name text;
  before_row public.employee_advance_holders;
  result public.employee_advance_holders;
begin
  if num_nonnulls(target_profile_id,target_person_id)<>1
    or length(btrim(coalesce(target_bank_name,'')))<2
    or coalesce(target_account_last4,'') !~ '^[0-9]{4}$'
  then raise exception 'advance_holder_input_invalid'; end if;

  if target_profile_id is not null then
    select employment.company_id, profile.full_name into target_company_id,target_name
    from public.employee_employment_records employment
    join public.profiles profile on profile.id=employment.profile_id
    where employment.profile_id=target_profile_id
      and employment.employment_type='monthly'
      and employment.employment_status in ('active','probation','notice')
    limit 1;
  else
    select person.company_id,person.full_name into target_company_id,target_name
    from public.employee_people person
    where person.id=target_person_id and person.employment_type='monthly' and person.employee_status='active'
    limit 1;
  end if;
  if target_company_id is null or target_name is null or not public.is_company_manager(target_company_id) then
    raise exception 'advance_holder_person_not_active_monthly_or_denied';
  end if;

  select * into before_row from public.employee_advance_holders
  where company_id=target_company_id
    and (holder_profile_id=target_profile_id or holder_person_id=target_person_id)
  for update;

  if before_row.id is null then
    insert into public.employee_advance_holders(company_id,holder_profile_id,holder_person_id,display_name,destination_bank_name,destination_account_last4,is_active,created_by)
    values(target_company_id,target_profile_id,target_person_id,btrim(target_name),btrim(target_bank_name),target_account_last4,target_is_active,auth.uid())
    returning * into result;
  else
    update public.employee_advance_holders set display_name=btrim(target_name),destination_bank_name=btrim(target_bank_name),destination_account_last4=target_account_last4,is_active=target_is_active,updated_at=now()
    where id=before_row.id returning * into result;
  end if;

  insert into public.employee_advance_holder_audit(holder_id,company_id,event_key,action,actor_profile_id,before_data,after_data)
  values(result.id,result.company_id,target_event_key,'upsert_holder',auth.uid(),to_jsonb(before_row),to_jsonb(result)) on conflict(event_key) do nothing;
  return result;
end;
$$;

create or replace function public.add_employee_advance_holder_alias(
  target_holder_id uuid,
  target_alias_name text,
  target_event_key text
) returns public.employee_advance_holder_aliases
language plpgsql security definer set search_path=public as $$
declare holder public.employee_advance_holders; result public.employee_advance_holder_aliases;
begin
  select * into holder from public.employee_advance_holders where id=target_holder_id for update;
  if holder.id is null or not public.is_company_manager(holder.company_id) or length(btrim(coalesce(target_alias_name,'')))<2 then
    raise exception 'advance_holder_alias_invalid_or_denied'; end if;
  insert into public.employee_advance_holder_aliases(holder_id,alias_name,created_by)
  values(holder.id,btrim(target_alias_name),auth.uid()) on conflict(holder_id,alias_name) do update set alias_name=excluded.alias_name returning * into result;
  insert into public.employee_advance_holder_audit(holder_id,company_id,event_key,action,actor_profile_id,after_data)
  values(holder.id,holder.company_id,target_event_key,'add_alias',auth.uid(),to_jsonb(result)) on conflict(event_key) do nothing;
  return result;
end;
$$;

-- Replace the earlier general monthly-name inference. Only an explicit active
-- holder registry match is safe enough to create a draft advance automatically.
create or replace function public.auto_create_safe_employee_advance_from_transfer(target_source_message_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare transaction_row public.financial_transactions; source_item public.document_flow_items;
  holder public.employee_advance_holders; holder_id uuid; holder_count integer:=0; result public.employee_advance_cases;
begin
  select * into transaction_row from public.financial_transactions where source_message_id=target_source_message_id limit 1;
  if transaction_row.id is null or transaction_row.review_status in ('duplicate','dismissed')
    or coalesce(transaction_row.amount_total,0)<=0 or coalesce(transaction_row.payment_party_confidence,0)<0.900
    or nullif(btrim(transaction_row.recipient_name),'') is null
    or not exists(select 1 from public.financial_transaction_account_pairs pair where pair.financial_transaction_id=transaction_row.id and pair.registration_status in ('auto_registered','manual_verified'))
  then return; end if;
  select * into source_item from public.document_flow_items where source_message_id=target_source_message_id for update;
  if source_item.id is null or source_item.company_id<>transaction_row.company_id or source_item.current_flow<>'posting' or source_item.state<>'destination_in_progress' or source_item.current_room<>'destination_accounting_queue' then return; end if;
  select count(*), (array_agg(id))[1] into holder_count,holder_id
  from (
    select distinct candidate.id from public.employee_advance_holders candidate
    left join public.employee_advance_holder_aliases alias on alias.holder_id=candidate.id
    where candidate.company_id=source_item.company_id and candidate.is_active
      and candidate.destination_bank_name=transaction_row.recipient_bank_name
      and candidate.destination_account_last4=transaction_row.recipient_account_last4
      and (lower(regexp_replace(btrim(candidate.display_name),'\\s+','','g'))=lower(regexp_replace(btrim(transaction_row.recipient_name),'\\s+','','g'))
        or lower(regexp_replace(btrim(alias.alias_name),'\\s+','','g'))=lower(regexp_replace(btrim(transaction_row.recipient_name),'\\s+','','g')))
  ) matches;
  if holder_count<>1 then return; end if;
  select * into holder from public.employee_advance_holders where id=holder_id;
  insert into public.employee_advance_cases(company_id,advance_number,financial_transaction_id,source_flow_item_id,holder_profile_id,holder_person_id,amount_received,received_at,bank_reference,project_id,status,purpose_note,created_by)
  values(source_item.company_id,'ADV-'||to_char(now() at time zone 'Asia/Bangkok','YYYYMM')||'-'||upper(left(replace(source_item.id::text,'-',''),6)),transaction_row.id,source_item.id,holder.holder_profile_id,holder.holder_person_id,transaction_row.amount_total,transaction_row.transfer_at,transaction_row.bank_reference,transaction_row.project_id,'draft','ระบบสร้างจากทะเบียนผู้ถือเงินสำรองที่ตรงสลิป',null)
  on conflict(financial_transaction_id) do update set updated_at=public.employee_advance_cases.updated_at returning * into result;
  insert into public.employee_advance_audit(case_id,company_id,event_key,action,after_data,reason)
  values(result.id,result.company_id,'auto-create-advance:'||transaction_row.id::text,'auto_create_from_holder_registry',jsonb_build_object('holder_id',holder.id,'financial_transaction_id',transaction_row.id),'ระบบสร้างเงินสำรองจ่ายฉบับร่างจากทะเบียนผู้ถือเงิน') on conflict(event_key) do nothing;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload)
  values(source_item.id,source_item.company_id,'auto-advance-created:'||transaction_row.id::text,'employee_advance_auto_created',source_item.current_flow,source_item.current_flow,source_item.state,source_item.state,source_item.current_room,source_item.current_room,'ระบบสร้างเงินสำรองจ่ายจากทะเบียนผู้ถือเงินที่ match ตรงกัน',jsonb_build_object('advance_case_id',result.id,'holder_id',holder.id)) on conflict(event_key) do nothing;
end;
$$;

revoke all on function public.upsert_employee_advance_holder(uuid,uuid,text,text,boolean,text), public.add_employee_advance_holder_alias(uuid,text,text), public.auto_create_safe_employee_advance_from_transfer(uuid) from public,anon;
grant execute on function public.upsert_employee_advance_holder(uuid,uuid,text,text,boolean,text), public.add_employee_advance_holder_alias(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
