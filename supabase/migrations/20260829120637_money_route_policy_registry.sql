-- Central, versioned routing policy for transfer-slip account pairs.
-- Source slips and OCR facts remain immutable. "Delete" means deactivate.

create table public.money_route_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sender_master_bank_account_id uuid references public.master_bank_accounts(id) on delete restrict,
  recipient_master_bank_account_id uuid references public.master_bank_accounts(id) on delete restrict,
  sender_bank_name text not null,
  sender_account_last4 text not null check (sender_account_last4 ~ '^[0-9A-Za-z]{2,4}$'),
  recipient_bank_name text not null,
  recipient_account_last4 text not null check (recipient_account_last4 ~ '^[0-9A-Za-z]{2,4}$'),
  route_type text not null check (route_type in (
    'company_to_advance','self_transfer','payroll','vendor_payment',
    'internal_transfer','review_required'
  )),
  decision text not null check (decision in ('auto_route','review','exclude')),
  destination_module text check (destination_module in (
    'advance_finance','payroll','accounting','vendor_payables','review_queue'
  )),
  priority integer not null default 100 check (priority between 1 and 9999),
  status text not null default 'active' check (status in ('active','inactive')),
  reason text not null check (length(btrim(reason)) >= 3),
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((decision = 'auto_route' and destination_module is not null) or decision <> 'auto_route'),
  unique(company_id,sender_bank_name,sender_account_last4,recipient_bank_name,recipient_account_last4)
);

create index money_route_policies_lookup_idx on public.money_route_policies(
  company_id,status,sender_account_last4,recipient_account_last4,priority
);

create table public.money_route_policy_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  policy_id uuid not null references public.money_route_policies(id) on delete restrict,
  event_key text not null unique,
  action text not null check (action in ('created','updated','deactivated','reactivated')),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  reason text not null,
  created_at timestamptz not null default now()
);
create index money_route_policy_audit_policy_idx on public.money_route_policy_audit(policy_id,created_at desc);

alter table public.money_route_policies enable row level security;
alter table public.money_route_policy_audit enable row level security;

revoke all on public.money_route_policies,public.money_route_policy_audit from anon,authenticated;
grant select on public.money_route_policies,public.money_route_policy_audit to authenticated;

create policy "Authorised roles read money route policies" on public.money_route_policies
for select to authenticated using (
  company_id = public.current_company_id() and (
    public.is_platform_admin() or public.is_company_manager(company_id)
    or public.is_document_flow_department_member(company_id,'accounting')
  )
);
create policy "Authorised roles read money route policy audit" on public.money_route_policy_audit
for select to authenticated using (
  company_id = public.current_company_id() and (
    public.is_platform_admin() or public.is_company_manager(company_id)
    or public.is_document_flow_department_member(company_id,'accounting')
  )
);

create or replace function public.save_money_route_policy(
  target_policy_id uuid,
  target_event_key text,
  target_sender_master_bank_account_id uuid,
  target_recipient_master_bank_account_id uuid,
  target_route_type text,
  target_decision text,
  target_destination_module text,
  target_priority integer,
  target_reason text,
  target_expected_version integer default null
) returns public.money_route_policies
language plpgsql security definer set search_path = '' as $$
declare
  actor_company_id uuid := public.current_company_id();
  sender_row public.master_bank_accounts;
  recipient_row public.master_bank_accounts;
  before_row public.money_route_policies;
  result public.money_route_policies;
  audit_action text;
begin
  if auth.uid() is null or actor_company_id is null or not (
    public.is_platform_admin() or public.is_company_manager(actor_company_id)
  ) then raise exception 'money_route_policy_forbidden'; end if;
  if nullif(btrim(target_event_key),'') is null then raise exception 'money_route_policy_event_key_required'; end if;
  if length(btrim(coalesce(target_reason,''))) < 3 then raise exception 'money_route_policy_reason_required'; end if;
  if target_route_type not in ('company_to_advance','self_transfer','payroll','vendor_payment','internal_transfer','review_required')
     or target_decision not in ('auto_route','review','exclude')
     or target_priority not between 1 and 9999 then raise exception 'money_route_policy_invalid'; end if;
  if target_decision = 'auto_route' and target_destination_module not in ('advance_finance','payroll','accounting','vendor_payables','review_queue') then
    raise exception 'money_route_policy_destination_required';
  end if;
  select * into sender_row from public.master_bank_accounts where id=target_sender_master_bank_account_id and company_id=actor_company_id and verification_status='verified';
  select * into recipient_row from public.master_bank_accounts where id=target_recipient_master_bank_account_id and company_id=actor_company_id and verification_status='verified';
  if sender_row.id is null or recipient_row.id is null then raise exception 'money_route_policy_verified_accounts_required'; end if;

  if exists(select 1 from public.money_route_policy_audit where event_key=target_event_key) then
    select policy.* into result from public.money_route_policies policy join public.money_route_policy_audit audit on audit.policy_id=policy.id where audit.event_key=target_event_key;
    return result;
  end if;

  if target_policy_id is null then
    insert into public.money_route_policies(
      company_id,sender_master_bank_account_id,recipient_master_bank_account_id,
      sender_bank_name,sender_account_last4,recipient_bank_name,recipient_account_last4,
      route_type,decision,destination_module,priority,status,reason,created_by,updated_by
    ) values (
      actor_company_id,sender_row.id,recipient_row.id,
      coalesce(nullif(btrim(sender_row.bank_name),''),'ไม่ระบุธนาคาร'),sender_row.account_last4,
      coalesce(nullif(btrim(recipient_row.bank_name),''),'ไม่ระบุธนาคาร'),recipient_row.account_last4,
      target_route_type,target_decision,case when target_decision='auto_route' then target_destination_module else null end,
      target_priority,'active',btrim(target_reason),auth.uid(),auth.uid()
    ) returning * into result;
    audit_action := 'created';
  else
    select * into before_row from public.money_route_policies where id=target_policy_id and company_id=actor_company_id for update;
    if before_row.id is null then raise exception 'money_route_policy_not_found'; end if;
    if target_expected_version is null or before_row.version<>target_expected_version then raise exception 'money_route_policy_version_conflict'; end if;
    update public.money_route_policies set
      sender_master_bank_account_id=sender_row.id,recipient_master_bank_account_id=recipient_row.id,
      sender_bank_name=coalesce(nullif(btrim(sender_row.bank_name),''),'ไม่ระบุธนาคาร'),sender_account_last4=sender_row.account_last4,
      recipient_bank_name=coalesce(nullif(btrim(recipient_row.bank_name),''),'ไม่ระบุธนาคาร'),recipient_account_last4=recipient_row.account_last4,
      route_type=target_route_type,decision=target_decision,
      destination_module=case when target_decision='auto_route' then target_destination_module else null end,
      priority=target_priority,reason=btrim(target_reason),version=version+1,updated_by=auth.uid(),updated_at=now()
    where id=before_row.id returning * into result;
    audit_action := 'updated';
  end if;
  insert into public.money_route_policy_audit(company_id,policy_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(actor_company_id,result.id,target_event_key,audit_action,auth.uid(),case when before_row.id is null then null else to_jsonb(before_row) end,to_jsonb(result),btrim(target_reason));
  return result;
end;
$$;

create or replace function public.set_money_route_policy_status(
  target_policy_id uuid,target_event_key text,target_status text,target_expected_version integer,target_reason text
) returns public.money_route_policies
language plpgsql security definer set search_path = '' as $$
declare actor_company_id uuid:=public.current_company_id(); before_row public.money_route_policies; result public.money_route_policies;
begin
  if auth.uid() is null or actor_company_id is null or not (public.is_platform_admin() or public.is_company_manager(actor_company_id)) then raise exception 'money_route_policy_forbidden'; end if;
  if target_status not in ('active','inactive') or length(btrim(coalesce(target_reason,'')))<3 then raise exception 'money_route_policy_status_invalid'; end if;
  select * into before_row from public.money_route_policies where id=target_policy_id and company_id=actor_company_id for update;
  if before_row.id is null then raise exception 'money_route_policy_not_found'; end if;
  if before_row.version<>target_expected_version then raise exception 'money_route_policy_version_conflict'; end if;
  if exists(select 1 from public.money_route_policy_audit where event_key=target_event_key) then return before_row; end if;
  update public.money_route_policies set status=target_status,reason=btrim(target_reason),version=version+1,updated_by=auth.uid(),updated_at=now() where id=before_row.id returning * into result;
  insert into public.money_route_policy_audit(company_id,policy_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(actor_company_id,result.id,target_event_key,case when target_status='active' then 'reactivated' else 'deactivated' end,auth.uid(),to_jsonb(before_row),to_jsonb(result),btrim(target_reason));
  return result;
end;
$$;

revoke all on function public.save_money_route_policy(uuid,text,uuid,uuid,text,text,text,integer,text,integer), public.set_money_route_policy_status(uuid,text,text,integer,text) from public,anon;
grant execute on function public.save_money_route_policy(uuid,text,uuid,uuid,text,text,text,integer,text,integer), public.set_money_route_policy_status(uuid,text,text,integer,text) to authenticated;

-- Automatic advance creation now requires an explicit, active account-pair policy.
-- Names can still help a reviewer, but can no longer authorize money movement.
create or replace function public.auto_create_safe_employee_advance_from_transfer(target_source_message_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare transaction_row public.financial_transactions; source_item public.document_flow_items; holder public.employee_advance_holders; holder_id uuid; holder_count integer:=0; result public.employee_advance_cases; policy_row public.money_route_policies;
begin
  select * into transaction_row from public.financial_transactions where source_message_id=target_source_message_id limit 1;
  if transaction_row.id is null or transaction_row.review_status in ('duplicate','dismissed') or coalesce(transaction_row.amount_total,0)<=0 or coalesce(transaction_row.payment_party_confidence,0)<0.900 then return; end if;
  select * into policy_row from public.money_route_policies policy
  where policy.company_id=transaction_row.company_id and policy.status='active'
    and lower(btrim(policy.sender_bank_name))=lower(btrim(transaction_row.sender_bank_name))
    and policy.sender_account_last4=transaction_row.sender_account_last4
    and lower(btrim(policy.recipient_bank_name))=lower(btrim(transaction_row.recipient_bank_name))
    and policy.recipient_account_last4=transaction_row.recipient_account_last4
  order by policy.priority asc,policy.updated_at desc limit 1;
  if policy_row.id is null or policy_row.decision<>'auto_route' or policy_row.route_type<>'company_to_advance' or policy_row.destination_module<>'advance_finance' then return; end if;
  select * into source_item from public.document_flow_items where source_message_id=target_source_message_id for update;
  if source_item.id is null or source_item.company_id<>transaction_row.company_id or source_item.current_flow<>'posting' or source_item.state<>'destination_in_progress' or source_item.current_room<>'destination_accounting_queue' then return; end if;
  select count(*),(array_agg(id))[1] into holder_count,holder_id from (
    select distinct candidate.id from public.employee_advance_holders candidate left join public.employee_advance_holder_aliases alias on alias.holder_id=candidate.id
    where candidate.company_id=source_item.company_id and candidate.is_active and (public.normalize_advance_holder_name(candidate.display_name)=public.normalize_advance_holder_name(transaction_row.recipient_name) or public.normalize_advance_holder_name(alias.alias_name)=public.normalize_advance_holder_name(transaction_row.recipient_name))
  ) matches;
  if holder_count<>1 then return; end if;
  select * into holder from public.employee_advance_holders where id=holder_id;
  insert into public.employee_advance_cases(company_id,advance_number,financial_transaction_id,source_flow_item_id,holder_profile_id,holder_person_id,amount_received,received_at,bank_reference,project_id,status,purpose_note,created_by)
  values(source_item.company_id,'ADV-'||to_char(now() at time zone 'Asia/Bangkok','YYYYMM')||'-'||upper(left(replace(source_item.id::text,'-',''),6)),transaction_row.id,source_item.id,holder.holder_profile_id,holder.holder_person_id,transaction_row.amount_total,transaction_row.transfer_at,transaction_row.bank_reference,transaction_row.project_id,'draft','ระบบสร้างจากกฎคู่บัญชีที่ Admin ยืนยัน',null)
  on conflict(financial_transaction_id) do update set updated_at=public.employee_advance_cases.updated_at returning * into result;
  insert into public.employee_advance_audit(case_id,company_id,event_key,action,after_data,reason)
  values(result.id,result.company_id,'auto-create-advance:'||transaction_row.id::text,'auto_create_from_money_route_policy',jsonb_build_object('policy_id',policy_row.id,'policy_version',policy_row.version,'financial_transaction_id',transaction_row.id),'สร้างร่างจากคู่บัญชีและทิศทางเงินที่ Admin ยืนยัน') on conflict(event_key) do nothing;
end;
$$;

revoke all on function public.auto_create_safe_employee_advance_from_transfer(uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
