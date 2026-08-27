-- Daily employee advance reconciliation.
-- A transfer made while a daily employee was eligible must remain matchable
-- after that employee later leaves, and a matched holding-ledger entry is a
-- valid destination instead of requiring the monthly reserve-holder registry.

create or replace function public.normalize_employee_payment_name(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(
    regexp_replace(
      btrim(coalesce(value, '')),
      '^(นาย|นางสาว|นาง|คุณ|ช่าง|น[.]?ส[.]?|ด[.]ช[.]|ด[.]ญ[.])[[:space:]]*',
      '',
      'i'
    ),
    '[[:space:].\\/_-]+',
    '',
    'g'
  ));
$$;

do $migration$
declare
  function_definition text;
  old_eligibility text := 'and employment.employment_status in (''active'',''probation'',''notice'')';
  new_eligibility text := 'and (employment.employment_status in (''active'',''probation'',''notice'') or (employment.employment_status = ''terminated'' and transaction_row.transfer_at is not null and coalesce(employment.payroll_eligible_until, employment.last_working_on, employment.terminated_on) >= (transaction_row.transfer_at at time zone ''Asia/Bangkok'')::date))';
begin
  select pg_get_functiondef(p.oid) into function_definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'project_employee_money_source';

  if function_definition is null then raise exception 'project_employee_money_source_not_found'; end if;
  if (length(function_definition) - length(replace(function_definition, old_eligibility, ''))) / length(old_eligibility) <> 2 then
    raise exception 'project_employee_money_source_unexpected_eligibility_definition';
  end if;
  function_definition := replace(function_definition, old_eligibility, new_eligibility);
  execute function_definition;

  select pg_get_functiondef(p.oid) into function_definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'review_transfer_slip_money_lineage_v2';

  if function_definition is null or function_definition not like '%target_decision => ''draft''%' then
    raise exception 'review_transfer_slip_money_lineage_v2_unexpected_base_decision';
  end if;
  function_definition := replace(function_definition, 'target_decision => ''draft''', 'target_decision => target_decision');
  execute function_definition;
end;
$migration$;

create or replace function public.reconcile_daily_employee_advance_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_entry public.employee_money_ledger_entries;
  item_row public.document_flow_items;
begin
  if new.route_status <> 'accounting_review' or new.purpose_type <> 'advance_transfer' then return new; end if;

  select entry.* into matched_entry
  from public.employee_money_ledger_entries entry
  join public.transfer_slip_money_allocations allocation on allocation.id = entry.allocation_id
  where allocation.lineage_id = new.id
    and allocation.status <> 'superseded'
    and allocation.purpose_type = 'advance_transfer'
    and entry.entry_type = 'advance_issued'
    and entry.entry_status in ('matched_pending_review','approved')
  order by entry.created_at desc
  limit 1;

  if matched_entry.id is null then return new; end if;
  select * into item_row from public.document_flow_items where id = new.item_id;

  update public.transfer_slip_money_lineages
  set route_status = 'routed',
      next_destination = 'employee_money_review_queue',
      route_note = concat_ws(' · ', nullif(route_note, ''), 'จับคู่พนักงานรายวันแล้ว รอตรวจบัญชีพัก'),
      version = version + 1,
      updated_at = now()
  where id = new.id and route_status = 'accounting_review';

  update public.document_flow_destination_tasks
  set status = 'completed', completed_by = coalesce(matched_entry.created_by, auth.uid()),
      completed_at = coalesce(completed_at, now()), note = 'ส่งเข้าบัญชีพักเงินพนักงานรายวันแล้ว',
      version = version + 1, updated_at = now()
  where item_id = new.item_id and department = 'accounting' and status not in ('completed','cancelled');

  update public.document_flow_items
  set state = 'destination_in_progress', current_room = 'employee_money_review_queue',
      assignment_status = 'unassigned', version = version + 1, updated_at = now()
  where id = new.item_id;

  insert into public.document_flow_events(
    item_id, company_id, event_key, event_type, from_flow, to_flow, from_state, to_state,
    from_room, to_room, note, payload, actor_id
  ) values (
    new.item_id, new.company_id, 'daily-employee-advance-route:' || matched_entry.id::text,
    'daily_employee_advance_routed', item_row.current_flow, item_row.current_flow,
    item_row.state, 'destination_in_progress', item_row.current_room, 'employee_money_review_queue',
    'พนักงานมีสิทธิ์ในวันโอนและจับคู่บัญชีพักได้ จึงไม่ต้องใช้ทะเบียนผู้ถือเงินรายเดือน',
    jsonb_build_object('lineage_id', new.id, 'ledger_entry_id', matched_entry.id,
      'employee_profile_id', matched_entry.employee_profile_id, 'amount', matched_entry.amount),
    coalesce(matched_entry.created_by, auth.uid())
  ) on conflict(event_key) do nothing;

  return new;
end;
$$;

revoke all on function public.reconcile_daily_employee_advance_route() from public, anon, authenticated;
drop trigger if exists reconcile_daily_employee_advance_route_after_review on public.transfer_slip_money_lineages;
create trigger reconcile_daily_employee_advance_route_after_review
after insert or update of route_status on public.transfer_slip_money_lineages
for each row execute function public.reconcile_daily_employee_advance_route();

notify pgrst, 'reload schema';
