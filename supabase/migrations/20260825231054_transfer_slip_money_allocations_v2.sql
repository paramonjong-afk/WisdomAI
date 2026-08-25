-- Money Lineage v2 keeps the verified transfer fact immutable from its business allocations.
-- Existing lineage rows remain valid and receive their own root id without changing Raw/OCR.

alter table public.transfer_slip_money_lineages
  add column if not exists root_lineage_id uuid references public.transfer_slip_money_lineages(id) on delete restrict,
  add column if not exists parent_lineage_id uuid references public.transfer_slip_money_lineages(id) on delete restrict;

create or replace function public.set_transfer_slip_money_lineage_root()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.root_lineage_id := coalesce(new.root_lineage_id, new.id);
  return new;
end;
$$;

drop trigger if exists set_transfer_slip_money_lineage_root on public.transfer_slip_money_lineages;
create trigger set_transfer_slip_money_lineage_root
before insert on public.transfer_slip_money_lineages
for each row execute function public.set_transfer_slip_money_lineage_root();

update public.transfer_slip_money_lineages
set root_lineage_id = id
where root_lineage_id is null;

alter table public.transfer_slip_money_lineages
  alter column root_lineage_id set not null;

alter table public.transfer_slip_money_lineages
  drop constraint if exists transfer_slip_money_lineages_purpose_type_check;
alter table public.transfer_slip_money_lineages
  add constraint transfer_slip_money_lineages_purpose_type_check check (
    purpose_type in (
      'payroll','advance_transfer','materials','project_expense','general_expense','onward_transfer',
      'vendor_payment','subcontractor','travel','bank_fee','tax','refund_return','inter_account',
      'cash_withdrawal','multi_allocation','unknown'
    )
  );

alter table public.transfer_slip_money_lineages
  drop constraint if exists transfer_slip_money_lineages_next_destination_check;
alter table public.transfer_slip_money_lineages
  add constraint transfer_slip_money_lineages_next_destination_check check (
    next_destination in (
      'accounting','payroll','advance_finance','inventory_project','project','accounting_posting',
      'intake_review','multi_destination'
    )
  );

create index if not exists transfer_slip_money_lineages_root_idx
  on public.transfer_slip_money_lineages(company_id, root_lineage_id, updated_at desc);
create index if not exists transfer_slip_money_lineages_parent_idx
  on public.transfer_slip_money_lineages(parent_lineage_id)
  where parent_lineage_id is not null;

create table if not exists public.transfer_slip_money_allocations (
  id uuid primary key default gen_random_uuid(),
  lineage_id uuid not null references public.transfer_slip_money_lineages(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  allocation_key text not null,
  sequence integer not null check (sequence > 0),
  purpose_type text not null check (
    purpose_type in (
      'payroll','advance_transfer','materials','project_expense','general_expense','onward_transfer',
      'vendor_payment','subcontractor','travel','bank_fee','tax','refund_return','inter_account',
      'cash_withdrawal','unknown'
    )
  ),
  allocation_amount numeric not null check (allocation_amount > 0),
  project_id uuid references public.projects(id) on delete set null,
  site_id uuid references public.project_sites(id) on delete set null,
  payee_name text,
  responsible_name text,
  description text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  status text not null default 'proposed' check (status in ('proposed','review_required','confirmed','routed','reconciled','superseded','cancelled')),
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lineage_id, allocation_key)
);

create index if not exists transfer_slip_money_allocations_queue_idx
  on public.transfer_slip_money_allocations(company_id, purpose_type, status, updated_at desc);
create index if not exists transfer_slip_money_allocations_project_idx
  on public.transfer_slip_money_allocations(project_id, status)
  where project_id is not null;

alter table public.transfer_slip_money_allocations enable row level security;
revoke all on table public.transfer_slip_money_allocations from anon, authenticated;
grant select on table public.transfer_slip_money_allocations to authenticated;

drop policy if exists "Managers and destination teams read money allocations" on public.transfer_slip_money_allocations;
create policy "Managers and destination teams read money allocations"
on public.transfer_slip_money_allocations
for select
to authenticated
using (
  company_id = public.current_company_id()
  and (
    public.is_platform_admin()
    or public.is_company_manager(company_id)
    or public.is_document_flow_department_member(company_id, 'accounting')
    or (purpose_type = 'payroll' and public.is_document_flow_department_member(company_id, 'hr'))
    or (purpose_type = 'materials' and (
      public.is_document_flow_department_member(company_id, 'inventory')
      or public.is_document_flow_department_member(company_id, 'project')
    ))
    or (purpose_type in ('project_expense','subcontractor','travel') and public.is_document_flow_department_member(company_id, 'project'))
  )
);

-- A lineage can now fan out to several destinations.  Read access must therefore
-- follow the active allocations instead of relying only on the single legacy
-- next_destination column.
drop policy if exists "Managers and destination teams read money lineage" on public.transfer_slip_money_lineages;
create policy "Managers and destination teams read money lineage"
on public.transfer_slip_money_lineages
for select
to authenticated
using (
  company_id = public.current_company_id()
  and (
    public.is_platform_admin()
    or public.is_company_manager(company_id)
    or public.is_document_flow_department_member(company_id, 'accounting')
    or exists (
      select 1
      from public.transfer_slip_money_allocations allocation
      where allocation.lineage_id = transfer_slip_money_lineages.id
        and allocation.status not in ('superseded', 'cancelled')
        and (
          (allocation.purpose_type = 'payroll' and public.is_document_flow_department_member(company_id, 'hr'))
          or (allocation.purpose_type = 'materials' and (
            public.is_document_flow_department_member(company_id, 'inventory')
            or public.is_document_flow_department_member(company_id, 'project')
          ))
          or (allocation.purpose_type in ('project_expense', 'subcontractor', 'travel')
            and public.is_document_flow_department_member(company_id, 'project'))
        )
    )
  )
);

create or replace function public.review_transfer_slip_money_lineage_v2(
  target_item_id uuid,
  target_event_key text,
  target_decision text,
  target_transfer jsonb default '{}'::jsonb,
  target_lineage jsonb default '{}'::jsonb,
  target_allocations jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row public.document_flow_items;
  lineage_row public.transfer_slip_money_lineages;
  parent_row public.transfer_slip_money_lineages;
  base_result jsonb;
  allocation jsonb;
  allocation_before jsonb := '[]'::jsonb;
  allocation_after jsonb := '[]'::jsonb;
  allocation_count integer := 0;
  advance_count integer := 0;
  allocation_amount numeric;
  allocation_total numeric := 0;
  transfer_amount numeric := nullif(target_transfer->>'amount_total', '')::numeric;
  returned_amount numeric := coalesce(nullif(target_lineage->>'returned_amount', '')::numeric, 0);
  unallocated_amount numeric := nullif(target_lineage->>'remaining_amount', '')::numeric;
  primary_purpose text := 'unknown';
  legacy_purpose text := 'unknown';
  next_departments text[] := '{}';
  next_destinations text[] := '{}';
  next_destination_value text := 'accounting';
  next_route_status text := 'draft';
  advance_case_id uuid;
  parent_id uuid := nullif(target_lineage->>'parent_lineage_id', '')::uuid;
  root_id uuid;
  project_id uuid;
  site_id uuid;
  purpose text;
  allocation_key_value text;
  allocation_sequence integer := 0;
begin
  if auth.uid() is null then raise exception 'workflow_authentication_required'; end if;
  if nullif(btrim(target_event_key), '') is null then raise exception 'workflow_event_key_required'; end if;
  if target_decision not in ('draft','confirm','request_information') then raise exception 'transfer_slip_review_decision_invalid'; end if;
  if jsonb_typeof(coalesce(target_transfer, '{}'::jsonb)) <> 'object' then raise exception 'transfer_fact_invalid'; end if;
  if jsonb_typeof(coalesce(target_lineage, '{}'::jsonb)) <> 'object' then raise exception 'money_lineage_invalid'; end if;
  if jsonb_typeof(coalesce(target_allocations, '[]'::jsonb)) <> 'array' then raise exception 'money_allocations_invalid'; end if;

  if exists(select 1 from public.document_flow_events where event_key = target_event_key) then
    return (select payload from public.document_flow_events where event_key = target_event_key limit 1);
  end if;

  select * into item_row from public.document_flow_items where id = target_item_id for update;
  if item_row.id is null then raise exception 'document_flow_item_not_found'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(item_row.company_id) then raise exception 'workflow_permission_denied'; end if;

  allocation_count := jsonb_array_length(coalesce(target_allocations, '[]'::jsonb));
  if allocation_count > 0 then
    primary_purpose := coalesce(target_allocations->0->>'purpose_type', 'unknown');
  end if;
  legacy_purpose := case
    when primary_purpose in ('payroll','advance_transfer','materials','project_expense','general_expense','onward_transfer') then primary_purpose
    when primary_purpose = 'unknown' then 'unknown'
    else 'general_expense'
  end;

  base_result := public.review_transfer_slip_money_lineage(
    target_item_id => target_item_id,
    target_event_key => target_event_key || ':base',
    target_decision => 'draft',
    target_sender_name => nullif(target_transfer->>'sender_name', ''),
    target_sender_bank_name => nullif(target_transfer->>'sender_bank_name', ''),
    target_sender_account_last4 => nullif(target_transfer->>'sender_account_last4', ''),
    target_recipient_name => nullif(target_transfer->>'recipient_name', ''),
    target_recipient_bank_name => nullif(target_transfer->>'recipient_bank_name', ''),
    target_recipient_account_last4 => nullif(target_transfer->>'recipient_account_last4', ''),
    target_amount_total => transfer_amount,
    target_transfer_at => nullif(target_transfer->>'transfer_at', '')::timestamptz,
    target_bank_reference => nullif(target_transfer->>'bank_reference', ''),
    target_funding_source_type => coalesce(nullif(target_lineage->>'funding_source_type', ''), 'unknown'),
    target_funding_source_reference => nullif(target_lineage->>'funding_source_reference', ''),
    target_fund_holder_name => nullif(target_lineage->>'fund_holder_name', ''),
    target_payer_name => nullif(target_lineage->>'payer_name', ''),
    target_final_beneficiary_name => nullif(target_lineage->>'final_beneficiary_name', ''),
    target_purpose_type => legacy_purpose,
    target_project_id => nullif(target_lineage->>'project_id', '')::uuid,
    target_site_id => nullif(target_lineage->>'site_id', '')::uuid,
    target_responsible_name => nullif(target_lineage->>'responsible_name', ''),
    target_starting_amount => nullif(target_lineage->>'starting_amount', '')::numeric,
    target_paid_amount => nullif(target_lineage->>'paid_amount', '')::numeric,
    target_returned_amount => returned_amount,
    target_remaining_amount => unallocated_amount,
    target_hops => coalesce(target_lineage->'hops', '[]'::jsonb),
    target_note => nullif(target_lineage->>'note', '')
  );

  select * into lineage_row
  from public.transfer_slip_money_lineages
  where id = (base_result->>'lineage_id')::uuid
  for update;
  if lineage_row.id is null then raise exception 'money_lineage_not_created'; end if;

  if parent_id is not null then
    select * into parent_row from public.transfer_slip_money_lineages where id = parent_id;
    if parent_row.id is null or parent_row.company_id <> item_row.company_id then raise exception 'money_parent_lineage_invalid'; end if;
    if parent_row.id = lineage_row.id then raise exception 'money_parent_lineage_cycle'; end if;
    if exists (
      with recursive descendants as (
        select id from public.transfer_slip_money_lineages where parent_lineage_id = lineage_row.id
        union all
        select child.id from public.transfer_slip_money_lineages child join descendants d on child.parent_lineage_id = d.id
      )
      select 1 from descendants where id = parent_row.id
    ) then raise exception 'money_parent_lineage_cycle'; end if;
  end if;

  root_id := lineage_row.id;
  if parent_id is not null then
    root_id := coalesce(parent_row.root_lineage_id, parent_row.id);
  end if;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.sequence), '[]'::jsonb)
  into allocation_before
  from public.transfer_slip_money_allocations a
  where a.lineage_id = lineage_row.id and a.status <> 'superseded';

  update public.transfer_slip_money_allocations
  set status = 'superseded', version = version + 1, updated_at = now()
  where lineage_id = lineage_row.id and status <> 'superseded';

  for allocation in select value from jsonb_array_elements(coalesce(target_allocations, '[]'::jsonb)) loop
    allocation_sequence := allocation_sequence + 1;
    purpose := coalesce(nullif(allocation->>'purpose_type', ''), 'unknown');
    allocation_amount := nullif(allocation->>'amount', '')::numeric;
    project_id := nullif(allocation->>'project_id', '')::uuid;
    site_id := nullif(allocation->>'site_id', '')::uuid;
    allocation_key_value := coalesce(nullif(allocation->>'allocation_key', ''), md5(lineage_row.id::text || ':' || allocation_sequence::text));

    if purpose not in (
      'payroll','advance_transfer','materials','project_expense','general_expense','onward_transfer',
      'vendor_payment','subcontractor','travel','bank_fee','tax','refund_return','inter_account',
      'cash_withdrawal','unknown'
    ) then raise exception 'money_allocation_purpose_invalid:%', purpose; end if;
    if allocation_amount is null or allocation_amount <= 0 then raise exception 'money_allocation_amount_invalid:%', allocation_sequence; end if;
    if target_decision = 'confirm' and purpose = 'unknown' then raise exception 'money_allocation_purpose_required:%', allocation_sequence; end if;
    if target_decision = 'confirm' and purpose in ('materials','project_expense') and project_id is null then raise exception 'money_allocation_project_required:%', allocation_sequence; end if;
    if project_id is not null and not exists(select 1 from public.projects p where p.id = project_id and p.company_id = item_row.company_id) then raise exception 'money_allocation_project_invalid:%', allocation_sequence; end if;
    if site_id is not null and not exists(select 1 from public.project_sites s where s.id = site_id and s.company_id = item_row.company_id and (project_id is null or s.project_id = project_id)) then raise exception 'money_allocation_site_invalid:%', allocation_sequence; end if;

    allocation_total := allocation_total + allocation_amount;
    if purpose in ('advance_transfer','onward_transfer') then advance_count := advance_count + 1; end if;

    insert into public.transfer_slip_money_allocations(
      lineage_id, company_id, allocation_key, sequence, purpose_type, allocation_amount, project_id, site_id,
      payee_name, responsible_name, description, confidence, evidence, status, created_by, confirmed_by, confirmed_at
    ) values (
      lineage_row.id, item_row.company_id, allocation_key_value, allocation_sequence, purpose, allocation_amount, project_id, site_id,
      nullif(allocation->>'payee_name', ''), nullif(allocation->>'responsible_name', ''), nullif(allocation->>'description', ''),
      nullif(allocation->>'confidence', '')::numeric, coalesce(allocation->'evidence', '[]'::jsonb),
      case when target_decision = 'confirm' then 'confirmed' else 'proposed' end,
      auth.uid(), case when target_decision = 'confirm' then auth.uid() end, case when target_decision = 'confirm' then now() end
    )
    on conflict(lineage_id, allocation_key) do update set
      sequence = excluded.sequence,
      purpose_type = excluded.purpose_type,
      allocation_amount = excluded.allocation_amount,
      project_id = excluded.project_id,
      site_id = excluded.site_id,
      payee_name = excluded.payee_name,
      responsible_name = excluded.responsible_name,
      description = excluded.description,
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      status = excluded.status,
      confirmed_by = excluded.confirmed_by,
      confirmed_at = excluded.confirmed_at,
      version = public.transfer_slip_money_allocations.version + 1,
      updated_at = now();

    if purpose = 'payroll' then
      if not ('hr' = any(next_departments)) then next_departments := array_append(next_departments, 'hr'); end if;
      if not ('payroll' = any(next_destinations)) then next_destinations := array_append(next_destinations, 'payroll'); end if;
    elsif purpose = 'materials' then
      if not ('inventory' = any(next_departments)) then next_departments := array_append(next_departments, 'inventory'); end if;
      if not ('project' = any(next_departments)) then next_departments := array_append(next_departments, 'project'); end if;
      if not ('inventory_project' = any(next_destinations)) then next_destinations := array_append(next_destinations, 'inventory_project'); end if;
    elsif purpose in ('project_expense','subcontractor','travel') and project_id is not null then
      if not ('project' = any(next_departments)) then next_departments := array_append(next_departments, 'project'); end if;
      if not ('project' = any(next_destinations)) then next_destinations := array_append(next_destinations, 'project'); end if;
    elsif purpose in ('advance_transfer','onward_transfer') then
      if not ('advance_finance' = any(next_destinations)) then next_destinations := array_append(next_destinations, 'advance_finance'); end if;
    else
      if not ('accounting_posting' = any(next_destinations)) then next_destinations := array_append(next_destinations, 'accounting_posting'); end if;
    end if;
  end loop;

  if advance_count > 0 and allocation_count > 1 then raise exception 'advance_allocation_must_be_exclusive'; end if;
  if target_decision = 'confirm' then
    if allocation_count = 0 then raise exception 'money_allocation_required'; end if;
    if transfer_amount is null or transfer_amount <= 0 then raise exception 'transfer_amount_required'; end if;
    if unallocated_amount is null then raise exception 'money_unallocated_amount_required'; end if;
    if unallocated_amount < 0 or returned_amount < 0 then raise exception 'money_balance_invalid'; end if;
    if abs(transfer_amount - allocation_total - returned_amount - unallocated_amount) > 0.01 then raise exception 'money_allocation_not_reconciled'; end if;
    if unallocated_amount > 0.01 then raise exception 'money_allocation_incomplete:%', unallocated_amount; end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.sequence), '[]'::jsonb)
  into allocation_after
  from public.transfer_slip_money_allocations a
  where a.lineage_id = lineage_row.id and a.status <> 'superseded';

  next_destination_value := case
    when cardinality(next_destinations) = 0 then 'accounting'
    when cardinality(next_destinations) = 1 then next_destinations[1]
    else 'multi_destination'
  end;
  next_route_status := case
    when target_decision = 'confirm' then 'routed'
    when target_decision = 'request_information' then 'needs_information'
    else 'draft'
  end;

  update public.transfer_slip_money_lineages
  set parent_lineage_id = parent_id,
      root_lineage_id = root_id,
      purpose_type = case when allocation_count = 1 then primary_purpose when allocation_count > 1 then 'multi_allocation' else 'unknown' end,
      route_status = next_route_status,
      next_destination = next_destination_value,
      route_note = nullif(target_lineage->>'note', ''),
      version = version + 1,
      updated_at = now()
  where id = lineage_row.id
  returning * into lineage_row;

  if target_decision = 'confirm' then
    if advance_count = 1 then
      perform public.auto_create_safe_employee_advance_from_transfer(item_row.source_message_id);
      select id into advance_case_id from public.employee_advance_cases where source_flow_item_id = item_row.id limit 1;
      if advance_case_id is null then
        next_route_status := 'accounting_review';
        update public.transfer_slip_money_lineages
        set route_status = next_route_status,
            route_note = concat_ws(' · ', nullif(target_lineage->>'note', ''), 'รอจับคู่ผู้ถือเงินสำรองในทะเบียน'),
            updated_at = now()
        where id = lineage_row.id returning * into lineage_row;
        update public.document_flow_destination_tasks
        set status = 'recheck_required', note = 'รอจับคู่ผู้ถือเงินสำรองก่อนส่งเงินสำรองจ่าย', version = version + 1, updated_at = now()
        where item_id = item_row.id and department = 'accounting' and status not in ('completed','cancelled');
      end if;
    end if;

    if next_route_status = 'routed' then
      insert into public.document_flow_destination_tasks(item_id, company_id, department, required, status, note)
      select item_row.id, item_row.company_id, department, true, 'queued', 'สร้างจากการจัดสรรเส้นทางเงิน v2'
      from unnest(next_departments) department
      on conflict(item_id, department) do update set
        required = true,
        status = case when public.document_flow_destination_tasks.status in ('returned','cancelled') then 'queued' else public.document_flow_destination_tasks.status end,
        note = excluded.note,
        updated_at = now();

      update public.document_flow_destination_tasks
      set status = 'completed', completed_by = auth.uid(), completed_at = coalesce(completed_at, now()), version = version + 1, updated_at = now()
      where item_id = item_row.id and department = 'accounting' and status not in ('completed','cancelled');

      if cardinality(next_departments) > 0 then
        update public.document_flow_items
        set state = 'destination_in_progress', current_room = 'destination_multi_queue',
            candidate_departments = (select array_agg(distinct value) from unnest(coalesce(candidate_departments, '{}'::text[]) || next_departments) value),
            assignment_status = 'unassigned', version = version + 1, updated_at = now()
        where id = item_row.id;
      elsif advance_case_id is not null then
        update public.document_flow_items
        set state = 'destination_in_progress', current_room = 'advance_finance_queue', assignment_status = 'unassigned', version = version + 1, updated_at = now()
        where id = item_row.id;
      else
        update public.document_flow_items
        set state = 'awaiting_approval', current_room = 'posting_approval_room', assignment_status = 'completed', version = version + 1, updated_at = now()
        where id = item_row.id;
      end if;
    end if;
  end if;

  insert into public.document_flow_events(
    item_id, company_id, event_key, event_type, from_flow, to_flow, from_state, to_state, from_room, to_room, note, payload, actor_id
  ) values (
    item_row.id, item_row.company_id, target_event_key, 'transfer_slip_money_allocation_' || target_decision,
    item_row.current_flow, item_row.current_flow, item_row.state, item_row.state, item_row.current_room, item_row.current_room,
    nullif(target_lineage->>'note', ''),
    jsonb_build_object(
      'item_id', item_row.id, 'lineage_id', lineage_row.id, 'root_lineage_id', lineage_row.root_lineage_id,
      'parent_lineage_id', lineage_row.parent_lineage_id, 'decision', target_decision,
      'allocation_before', allocation_before, 'allocation_after', allocation_after,
      'transfer_amount', transfer_amount, 'allocation_total', allocation_total, 'returned_amount', returned_amount,
      'unallocated_amount', unallocated_amount, 'route_status', next_route_status,
      'next_destination', next_destination_value, 'next_departments', next_departments, 'advance_case_id', advance_case_id
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'item_id', item_row.id, 'lineage_id', lineage_row.id, 'root_lineage_id', lineage_row.root_lineage_id,
    'parent_lineage_id', lineage_row.parent_lineage_id, 'decision', target_decision,
    'route_status', next_route_status, 'next_destination', next_destination_value,
    'next_departments', next_departments, 'advance_case_id', advance_case_id,
    'allocation_count', allocation_count, 'allocation_total', allocation_total,
    'returned_amount', returned_amount, 'unallocated_amount', unallocated_amount
  );
end;
$$;

revoke all on function public.review_transfer_slip_money_lineage_v2(uuid,text,text,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.review_transfer_slip_money_lineage_v2(uuid,text,text,jsonb,jsonb,jsonb) to authenticated;

notify pgrst, 'reload schema';
