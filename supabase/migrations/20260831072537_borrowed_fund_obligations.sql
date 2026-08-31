alter table public.transfer_slip_money_lineages
  drop constraint if exists transfer_slip_money_lineages_funding_source_type_check;
alter table public.transfer_slip_money_lineages
  add constraint transfer_slip_money_lineages_funding_source_type_check
  check (funding_source_type in ('company_account','reserve_fund','employee_advance','personal_reimbursement','borrowed_funds','unknown'));

create table if not exists public.borrowed_fund_obligations (
  id uuid primary key default gen_random_uuid(),
  lineage_id uuid not null unique references public.transfer_slip_money_lineages(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  item_id uuid not null references public.document_flow_items(id) on delete restrict,
  transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  lender_name text not null check (btrim(lender_name) <> ''),
  borrower_holder_name text not null check (btrim(borrower_holder_name) <> ''),
  principal_amount numeric(14,2) not null check (principal_amount > 0),
  repaid_amount numeric(14,2) not null default 0 check (repaid_amount >= 0 and repaid_amount <= principal_amount),
  due_date date not null,
  terms text,
  status text not null default 'outstanding' check (status in ('outstanding','partially_repaid','repaid','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists borrowed_fund_obligations_company_status_due_idx
  on public.borrowed_fund_obligations(company_id,status,due_date);
alter table public.borrowed_fund_obligations enable row level security;
revoke all on table public.borrowed_fund_obligations from public, anon;
grant select on table public.borrowed_fund_obligations to authenticated;
drop policy if exists "Company finance reads borrowed funds" on public.borrowed_fund_obligations;
create policy "Company finance reads borrowed funds"
  on public.borrowed_fund_obligations for select to authenticated
  using (
    public.is_platform_admin()
    or public.is_company_manager(company_id)
    or exists (
      select 1 from public.company_members member
      where member.company_id=borrowed_fund_obligations.company_id
        and member.profile_id=auth.uid() and member.active
        and member.company_role='accounting_hr'
        and (member.ends_on is null or member.ends_on>=current_date)
    )
  );

create or replace function public.record_borrowed_fund_obligation_v1(
  target_lineage_id uuid,
  target_event_key text,
  target_lender_name text,
  target_borrower_holder_name text,
  target_principal_amount numeric,
  target_due_date date,
  target_terms text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  lineage_row public.transfer_slip_money_lineages;
  obligation_row public.borrowed_fund_obligations;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'workflow_authentication_required'; end if;
  if nullif(btrim(target_event_key),'') is null then raise exception 'workflow_event_key_required'; end if;
  if exists(select 1 from public.document_flow_events where event_key=target_event_key) then
    return (select payload from public.document_flow_events where event_key=target_event_key limit 1);
  end if;
  select * into lineage_row from public.transfer_slip_money_lineages where id=target_lineage_id for update;
  if lineage_row.id is null then raise exception 'borrowed_fund_lineage_not_found'; end if;
  if lineage_row.funding_source_type <> 'borrowed_funds' then raise exception 'borrowed_fund_source_required'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(lineage_row.company_id) then raise exception 'workflow_permission_denied'; end if;
  if nullif(btrim(target_lender_name),'') is null then raise exception 'borrowed_fund_lender_required'; end if;
  if nullif(btrim(target_borrower_holder_name),'') is null then raise exception 'borrowed_fund_holder_required'; end if;
  if coalesce(target_principal_amount,0)<=0 then raise exception 'borrowed_fund_principal_invalid'; end if;
  if target_due_date is null then raise exception 'borrowed_fund_due_date_required'; end if;

  insert into public.borrowed_fund_obligations(
    lineage_id,company_id,item_id,transaction_id,lender_name,borrower_holder_name,
    principal_amount,due_date,terms,created_by,updated_by
  ) values (
    lineage_row.id,lineage_row.company_id,lineage_row.item_id,lineage_row.transaction_id,btrim(target_lender_name),btrim(target_borrower_holder_name),
    target_principal_amount,target_due_date,nullif(btrim(target_terms),''),auth.uid(),auth.uid()
  ) on conflict(lineage_id) do update set
    lender_name=excluded.lender_name,borrower_holder_name=excluded.borrower_holder_name,
    principal_amount=excluded.principal_amount,due_date=excluded.due_date,terms=excluded.terms,
    updated_by=auth.uid(),updated_at=now()
  returning * into obligation_row;

  update public.transfer_slip_money_lineages
  set funding_source_reference=obligation_row.id::text,updated_at=now()
  where id=lineage_row.id;

  result:=jsonb_build_object('obligation_id',obligation_row.id,'lineage_id',lineage_row.id,'status',obligation_row.status,'outstanding_amount',obligation_row.principal_amount-obligation_row.repaid_amount);
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  select item.id,item.company_id,target_event_key,'borrowed_fund_obligation_recorded',item.current_flow,item.current_flow,item.state,item.state,item.current_room,item.current_room,
    'บันทึกเงินยืมเป็นภาระหนี้ ไม่ใช่รายได้หรือค่าใช้จ่าย',result,auth.uid()
  from public.document_flow_items item where item.id=lineage_row.item_id;
  return result;
end;
$$;

revoke all on function public.record_borrowed_fund_obligation_v1(uuid,text,text,text,numeric,date,text) from public,anon;
grant execute on function public.record_borrowed_fund_obligation_v1(uuid,text,text,text,numeric,date,text) to authenticated;

do $$
declare function_sql text;
begin
  select pg_get_functiondef(p.oid) into function_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='review_transfer_slip_money_lineage';
  if function_sql is null then raise exception 'review_transfer_slip_money_lineage_not_found'; end if;
  if position('''borrowed_funds''' in function_sql)=0 then
    function_sql:=replace(function_sql,'''personal_reimbursement'',''unknown''','''personal_reimbursement'',''borrowed_funds'',''unknown''');
    if position('''borrowed_funds''' in function_sql)=0 then raise exception 'review_transfer_slip_money_lineage_source_guard_not_found'; end if;
    execute function_sql;
  end if;
end $$;

do $$
declare function_sql text;
begin
  select pg_get_functiondef(p.oid) into function_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='resolve_transfer_slip_starting_fund_parties_v1';
  if function_sql is null then raise exception 'starting_fund_party_resolver_not_found'; end if;
  if position('''borrowed_funds''' in function_sql)=0 then
    function_sql:=replace(function_sql,'''company_account'',''personal_reimbursement''','''company_account'',''personal_reimbursement'',''borrowed_funds''');
    if position('''borrowed_funds''' in function_sql)=0 then raise exception 'starting_fund_party_resolver_source_guard_not_found'; end if;
    execute function_sql;
  end if;
end $$;

notify pgrst,'reload schema';
