-- Money lineage is a reviewed business projection. Raw message, image, OCR and
-- financial transaction evidence remain immutable source records.
create table if not exists public.transfer_slip_money_lineages (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.document_flow_items(id) on delete restrict,
  transaction_id uuid not null unique references public.financial_transactions(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  funding_source_type text not null default 'unknown' check (funding_source_type in ('company_account','reserve_fund','employee_advance','personal_reimbursement','unknown')),
  funding_source_reference text,
  fund_holder_name text,
  payer_name text,
  final_beneficiary_name text,
  purpose_type text not null default 'unknown' check (purpose_type in ('payroll','advance_transfer','materials','project_expense','general_expense','onward_transfer','unknown')),
  project_id uuid references public.projects(id) on delete set null,
  site_id uuid references public.project_sites(id) on delete set null,
  responsible_name text,
  starting_amount numeric check (starting_amount is null or starting_amount >= 0),
  paid_amount numeric check (paid_amount is null or paid_amount > 0),
  returned_amount numeric not null default 0 check (returned_amount >= 0),
  remaining_amount numeric check (remaining_amount is null or remaining_amount >= 0),
  hops jsonb not null default '[]'::jsonb check (jsonb_typeof(hops) = 'array'),
  route_status text not null default 'draft' check (route_status in ('draft','needs_information','accounting_review','routed','closed')),
  next_destination text not null default 'accounting' check (next_destination in ('accounting','payroll','advance_finance','inventory_project','project','accounting_posting','intake_review')),
  route_note text,
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starting_amount is null or remaining_amount is null or paid_amount is null or abs(starting_amount - paid_amount - returned_amount - remaining_amount) <= 0.01)
);

create index if not exists transfer_slip_money_lineages_company_route_idx
  on public.transfer_slip_money_lineages(company_id,next_destination,route_status,updated_at desc);
alter table public.transfer_slip_money_lineages enable row level security;
revoke all on table public.transfer_slip_money_lineages from anon, authenticated;
grant select on table public.transfer_slip_money_lineages to authenticated;
drop policy if exists "Managers and destination teams read money lineage" on public.transfer_slip_money_lineages;
create policy "Managers and destination teams read money lineage"
on public.transfer_slip_money_lineages for select to authenticated using (
  company_id = public.current_company_id()
  and (
    public.is_platform_admin()
    or public.is_company_manager(company_id)
    or public.is_document_flow_department_member(company_id,'accounting')
    or (next_destination='payroll' and public.is_document_flow_department_member(company_id,'hr'))
    or (next_destination='inventory_project' and (public.is_document_flow_department_member(company_id,'inventory') or public.is_document_flow_department_member(company_id,'project')))
    or (next_destination='project' and public.is_document_flow_department_member(company_id,'project'))
  )
);

create or replace function public.review_transfer_slip_money_lineage(
  target_item_id uuid,
  target_event_key text,
  target_decision text,
  target_sender_name text default null,
  target_sender_bank_name text default null,
  target_sender_account_last4 text default null,
  target_recipient_name text default null,
  target_recipient_bank_name text default null,
  target_recipient_account_last4 text default null,
  target_amount_total numeric default null,
  target_transfer_at timestamptz default null,
  target_bank_reference text default null,
  target_funding_source_type text default 'unknown',
  target_funding_source_reference text default null,
  target_fund_holder_name text default null,
  target_payer_name text default null,
  target_final_beneficiary_name text default null,
  target_purpose_type text default 'unknown',
  target_project_id uuid default null,
  target_site_id uuid default null,
  target_responsible_name text default null,
  target_starting_amount numeric default null,
  target_paid_amount numeric default null,
  target_returned_amount numeric default 0,
  target_remaining_amount numeric default null,
  target_hops jsonb default '[]'::jsonb,
  target_note text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  item_row public.document_flow_items;
  transaction_row public.financial_transactions;
  before_lineage public.transfer_slip_money_lineages;
  result_lineage public.transfer_slip_money_lineages;
  detail_result jsonb;
  next_destination_value text := 'accounting';
  next_route_status text := 'draft';
  next_departments text[] := '{}';
  hop jsonb;
  advance_case_id uuid;
  calculated_remaining numeric;
  missing_fields text[] := '{}';
begin
  if auth.uid() is null then raise exception 'workflow_authentication_required'; end if;
  if coalesce(btrim(target_event_key),'')='' then raise exception 'workflow_event_key_required'; end if;
  if target_decision not in ('draft','confirm','request_information') then raise exception 'transfer_slip_review_decision_invalid'; end if;
  if exists(select 1 from public.document_flow_events where event_key=target_event_key) then
    return (select payload from public.document_flow_events where event_key=target_event_key limit 1);
  end if;
  if target_funding_source_type not in ('company_account','reserve_fund','employee_advance','personal_reimbursement','unknown') then raise exception 'money_funding_source_invalid'; end if;
  if target_purpose_type not in ('payroll','advance_transfer','materials','project_expense','general_expense','onward_transfer','unknown') then raise exception 'money_purpose_invalid'; end if;
  if jsonb_typeof(coalesce(target_hops,'[]'::jsonb)) <> 'array' then raise exception 'money_lineage_hops_invalid'; end if;
  if target_paid_amount is not null and target_paid_amount<=0 then raise exception 'money_paid_amount_invalid'; end if;
  if coalesce(target_returned_amount,0)<0 or coalesce(target_starting_amount,0)<0 or coalesce(target_remaining_amount,0)<0 then raise exception 'money_balance_invalid'; end if;

  select * into item_row from public.document_flow_items where id=target_item_id for update;
  if item_row.id is null or item_row.document_type<>'transfer_slip' then raise exception 'transfer_slip_item_not_found'; end if;
  if item_row.company_id<>public.current_company_id() and not public.is_platform_admin() then raise exception 'workflow_permission_denied'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(item_row.company_id) then raise exception 'workflow_permission_denied'; end if;
  select * into transaction_row from public.financial_transactions where source_message_id=item_row.source_message_id for update;
  if transaction_row.id is null then raise exception 'transfer_slip_transaction_not_found'; end if;
  if transaction_row.review_status in ('duplicate','dismissed') then raise exception 'transfer_slip_review_locked'; end if;
  if target_project_id is not null and not exists(select 1 from public.projects where id=target_project_id and company_id=item_row.company_id) then raise exception 'money_project_invalid'; end if;
  if target_site_id is not null and not exists(select 1 from public.project_sites where id=target_site_id and company_id=item_row.company_id and (target_project_id is null or project_id=target_project_id)) then raise exception 'money_site_invalid'; end if;

  if target_starting_amount is not null and target_remaining_amount is null and target_paid_amount is not null then
    calculated_remaining := target_starting_amount-target_paid_amount-coalesce(target_returned_amount,0);
  else calculated_remaining := target_remaining_amount; end if;
  if calculated_remaining is not null and calculated_remaining<0 then raise exception 'money_remaining_amount_invalid'; end if;
  if target_starting_amount is not null and calculated_remaining is not null and target_paid_amount is not null and abs(target_starting_amount-target_paid_amount-coalesce(target_returned_amount,0)-calculated_remaining)>0.01 then raise exception 'money_balance_not_reconciled'; end if;

  if target_decision='confirm' then
    if target_funding_source_type='unknown' then missing_fields:=array_append(missing_fields,'funding_source_type'); end if;
    if target_funding_source_type in ('reserve_fund','employee_advance') and nullif(btrim(target_fund_holder_name),'') is null then missing_fields:=array_append(missing_fields,'fund_holder_name'); end if;
    if nullif(btrim(target_payer_name),'') is null then missing_fields:=array_append(missing_fields,'payer_name'); end if;
    if nullif(btrim(target_final_beneficiary_name),'') is null then missing_fields:=array_append(missing_fields,'final_beneficiary_name'); end if;
    if target_purpose_type='unknown' then missing_fields:=array_append(missing_fields,'purpose_type'); end if;
    if target_purpose_type in ('materials','project_expense') and target_project_id is null then missing_fields:=array_append(missing_fields,'project_id'); end if;
    if target_paid_amount is null then missing_fields:=array_append(missing_fields,'paid_amount'); end if;
    if jsonb_array_length(coalesce(target_hops,'[]'::jsonb))=0 then missing_fields:=array_append(missing_fields,'money_hops'); end if;
    if cardinality(missing_fields)>0 then raise exception 'money_lineage_required_fields_missing:%',array_to_string(missing_fields,','); end if;
    if target_amount_total is not null and abs(target_paid_amount-target_amount_total)>0.01 then raise exception 'money_paid_amount_not_equal_transfer'; end if;
    for hop in select value from jsonb_array_elements(target_hops) loop
      if nullif(btrim(hop->>'from_party'),'') is null or nullif(btrim(hop->>'to_party'),'') is null or coalesce((hop->>'amount')::numeric,0)<=0 then raise exception 'money_lineage_hop_incomplete'; end if;
    end loop;
  end if;

  detail_result := public.review_transfer_slip_details(
    target_item_id,target_event_key||':details',target_decision,target_sender_name,target_sender_bank_name,
    target_sender_account_last4,target_recipient_name,target_recipient_bank_name,target_recipient_account_last4,
    target_amount_total,target_transfer_at,target_bank_reference,target_note
  );

  select * into before_lineage from public.transfer_slip_money_lineages where item_id=item_row.id for update;
  next_destination_value := case target_purpose_type
    when 'payroll' then 'payroll'
    when 'advance_transfer' then 'advance_finance'
    when 'onward_transfer' then 'advance_finance'
    when 'materials' then 'inventory_project'
    when 'project_expense' then 'project'
    when 'general_expense' then 'accounting_posting'
    else 'intake_review' end;
  next_route_status := case when target_decision='confirm' then 'routed' when target_decision='request_information' then 'needs_information' else 'draft' end;

  insert into public.transfer_slip_money_lineages(
    item_id,transaction_id,company_id,funding_source_type,funding_source_reference,fund_holder_name,payer_name,
    final_beneficiary_name,purpose_type,project_id,site_id,responsible_name,starting_amount,paid_amount,returned_amount,
    remaining_amount,hops,route_status,next_destination,route_note,created_by,confirmed_by,confirmed_at
  ) values (
    item_row.id,transaction_row.id,item_row.company_id,target_funding_source_type,nullif(btrim(target_funding_source_reference),''),nullif(btrim(target_fund_holder_name),''),nullif(btrim(target_payer_name),''),
    nullif(btrim(target_final_beneficiary_name),''),target_purpose_type,target_project_id,target_site_id,nullif(btrim(target_responsible_name),''),target_starting_amount,target_paid_amount,coalesce(target_returned_amount,0),
    calculated_remaining,coalesce(target_hops,'[]'::jsonb),next_route_status,next_destination_value,nullif(btrim(target_note),''),auth.uid(),case when target_decision='confirm' then auth.uid() end,case when target_decision='confirm' then now() end
  ) on conflict(item_id) do update set
    funding_source_type=excluded.funding_source_type,funding_source_reference=excluded.funding_source_reference,fund_holder_name=excluded.fund_holder_name,
    payer_name=excluded.payer_name,final_beneficiary_name=excluded.final_beneficiary_name,purpose_type=excluded.purpose_type,project_id=excluded.project_id,site_id=excluded.site_id,
    responsible_name=excluded.responsible_name,starting_amount=excluded.starting_amount,paid_amount=excluded.paid_amount,returned_amount=excluded.returned_amount,
    remaining_amount=excluded.remaining_amount,hops=excluded.hops,route_status=excluded.route_status,next_destination=excluded.next_destination,route_note=excluded.route_note,
    confirmed_by=case when target_decision='confirm' then auth.uid() else public.transfer_slip_money_lineages.confirmed_by end,
    confirmed_at=case when target_decision='confirm' then now() else public.transfer_slip_money_lineages.confirmed_at end,
    version=public.transfer_slip_money_lineages.version+1,updated_at=now()
  returning * into result_lineage;

  if target_decision='confirm' then
    update public.financial_transactions set expense_type=case target_purpose_type when 'payroll' then 'labor' when 'advance_transfer' then 'advance' when 'onward_transfer' then 'advance' when 'materials' then 'materials_equipment' else expense_type end,project_id=coalesce(target_project_id,project_id),updated_at=now() where id=transaction_row.id;
    next_departments := case target_purpose_type when 'payroll' then array['hr']::text[] when 'materials' then array['inventory','project']::text[] when 'project_expense' then array['project']::text[] else '{}'::text[] end;
    if cardinality(next_departments)>0 then
      insert into public.document_flow_destination_tasks(item_id,company_id,department,required,status,note)
      select item_row.id,item_row.company_id,department,true,'queued','สร้างจากการยืนยันเส้นทางเงิน: '||target_purpose_type from unnest(next_departments) department
      on conflict(item_id,department) do update set required=true,status=case when public.document_flow_destination_tasks.status in ('returned','cancelled') then 'queued' else public.document_flow_destination_tasks.status end,note=excluded.note,updated_at=now();
    end if;
    if target_purpose_type in ('advance_transfer','onward_transfer') then
      perform public.auto_create_safe_employee_advance_from_transfer(item_row.source_message_id);
      select id into advance_case_id from public.employee_advance_cases where source_flow_item_id=item_row.id limit 1;
      if advance_case_id is null then
        next_route_status := 'accounting_review';
        update public.transfer_slip_money_lineages set route_status=next_route_status,route_note=concat_ws(' · ',nullif(btrim(target_note),''),'รอจับคู่ผู้ถือเงินสำรองในทะเบียน'),updated_at=now() where id=result_lineage.id returning * into result_lineage;
        update public.document_flow_destination_tasks set status='recheck_required',note='รอจับคู่ผู้ถือเงินสำรองก่อนส่งเงินสำรองจ่าย',version=version+1,updated_at=now() where item_id=item_row.id and department='accounting' and status not in ('completed','cancelled');
      else
        update public.document_flow_destination_tasks set status='completed',completed_by=auth.uid(),completed_at=coalesce(completed_at,now()),version=version+1,updated_at=now() where item_id=item_row.id and department='accounting' and status not in ('completed','cancelled');
      end if;
    else
      update public.document_flow_destination_tasks set status='completed',completed_by=auth.uid(),completed_at=coalesce(completed_at,now()),version=version+1,updated_at=now() where item_id=item_row.id and department='accounting' and status not in ('completed','cancelled');
    end if;
    if next_route_status='routed' and cardinality(next_departments)>0 then
      update public.document_flow_items set state='destination_in_progress',current_room='destination_multi_queue',candidate_departments=(select array_agg(distinct value) from unnest(coalesce(candidate_departments,'{}'::text[])||next_departments) value),assignment_status='unassigned',version=version+1,updated_at=now() where id=item_row.id;
    elsif next_route_status='routed' and advance_case_id is not null then
      update public.document_flow_items set state='destination_in_progress',current_room='advance_finance_queue',assignment_status='unassigned',version=version+1,updated_at=now() where id=item_row.id;
    elsif next_route_status='routed' then
      update public.document_flow_items set state='awaiting_approval',current_room='posting_approval_room',assignment_status='completed',version=version+1,updated_at=now() where id=item_row.id;
    end if;
  end if;

  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(item_row.id,item_row.company_id,target_event_key,'transfer_slip_money_lineage_'||target_decision,item_row.current_flow,item_row.current_flow,item_row.state,item_row.state,item_row.current_room,item_row.current_room,target_note,
    jsonb_build_object('decision',target_decision,'lineage_id',result_lineage.id,'before',to_jsonb(before_lineage),'after',to_jsonb(result_lineage),'next_destination',next_destination_value,'next_departments',next_departments,'advance_case_id',advance_case_id,'detail_result',detail_result),auth.uid());
  return jsonb_build_object('item_id',item_row.id,'transaction_id',transaction_row.id,'lineage_id',result_lineage.id,'decision',target_decision,'route_status',next_route_status,'next_destination',next_destination_value,'next_departments',next_departments,'advance_case_id',advance_case_id);
end;
$$;

revoke all on function public.review_transfer_slip_money_lineage(uuid,text,text,text,text,text,text,text,text,numeric,timestamptz,text,text,text,text,text,text,text,uuid,uuid,text,numeric,numeric,numeric,numeric,jsonb,text) from public,anon;
grant execute on function public.review_transfer_slip_money_lineage(uuid,text,text,text,text,text,text,text,text,numeric,timestamptz,text,text,text,text,text,text,text,uuid,uuid,text,numeric,numeric,numeric,numeric,jsonb,text) to authenticated;
notify pgrst,'reload schema';

;


