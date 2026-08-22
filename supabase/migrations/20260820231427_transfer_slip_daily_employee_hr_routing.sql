-- A transfer slip paid to a known daily employee must remain in Accounting and
-- also be visible to HR.  The match is deliberately exact (after whitespace
-- normalization) against the active, tenant-scoped employee registry: no fuzzy
-- name inference is allowed to create an HR task.

create or replace function public.auto_route_transfer_slip_daily_employee_to_hr(
  target_source_message_id uuid,
  target_actor_id uuid default null
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  before_row public.document_flow_items;
  transaction_row public.financial_transactions;
  matched_employee_id uuid;
  matched_employee_source text;
  created_task_id uuid;
  result_row public.document_flow_items;
begin
  select * into before_row
  from public.document_flow_items
  where source_message_id = target_source_message_id
  for update;

  if before_row.id is null
    or before_row.current_flow <> 'posting'
    or before_row.state <> 'destination_in_progress'
    or before_row.document_type <> 'transfer_slip'
  then
    return;
  end if;

  select * into transaction_row
  from public.financial_transactions
  where source_message_id = target_source_message_id
  limit 1;

  if transaction_row.source_message_id is null
    or nullif(btrim(transaction_row.recipient_name), '') is null
  then
    return;
  end if;

  select employee_id, employee_source
  into matched_employee_id, matched_employee_source
  from (
    select employment.profile_id as employee_id, 'employment_record'::text as employee_source
    from public.employee_employment_records employment
    join public.profiles profile on profile.id = employment.profile_id
    where employment.company_id = before_row.company_id
      and employment.employment_type = 'daily'
      and employment.employment_status in ('active', 'probation', 'notice')
      and nullif(btrim(profile.full_name), '') is not null
      and lower(regexp_replace(btrim(profile.full_name), '\s+', '', 'g'))
        = lower(regexp_replace(btrim(transaction_row.recipient_name), '\s+', '', 'g'))
    union all
    select person.id as employee_id, 'employee_person'::text as employee_source
    from public.employee_people person
    where person.company_id = before_row.company_id
      and person.employment_type = 'daily'
      and person.employee_status = 'active'
      and nullif(btrim(person.full_name), '') is not null
      and lower(regexp_replace(btrim(person.full_name), '\s+', '', 'g'))
        = lower(regexp_replace(btrim(transaction_row.recipient_name), '\s+', '', 'g'))
    limit 1
  ) matched_employee;

  if matched_employee_id is null then
    return;
  end if;

  insert into public.document_flow_destination_tasks(
    item_id, company_id, department, required, status, note
  ) values (
    before_row.id, before_row.company_id, 'hr', true, 'queued',
    'ระบบพบชื่อผู้รับสลิปตรงกับพนักงานรายวัน จึงส่งให้ HR ตรวจสอบ'
  ) on conflict (item_id, department) do nothing
  returning id into created_task_id;

  update public.document_flow_items
  set candidate_departments = (
        select array_agg(department order by department)
        from (
          select distinct department
          from unnest(coalesce(before_row.candidate_departments, array[coalesce(before_row.target_department, 'accounting')]) || array['hr']::text[]) department
        ) candidates
      ),
      classification_note = coalesce(before_row.classification_note, 'ระบบส่งสลิปโอนเงินเข้าห้องบัญชีอัตโนมัติ')
        || ' · พบผู้รับเป็นพนักงานรายวัน ส่ง HR ตรวจสอบ',
      version = before_row.version + 1,
      updated_at = now()
  where id = before_row.id
    and not ('hr' = any(coalesce(before_row.candidate_departments, array[]::text[])))
  returning * into result_row;

  if created_task_id is not null then
    insert into public.document_flow_events(
      item_id, company_id, event_key, event_type,
      from_flow, to_flow, from_state, to_state, from_room, to_room,
      note, payload, actor_id
    ) values (
      before_row.id, before_row.company_id,
      'transfer-slip-daily-employee-hr-route:' || before_row.id::text,
      'transfer_slip_daily_employee_hr_routed',
      before_row.current_flow, before_row.current_flow,
      before_row.state, before_row.state,
      before_row.current_room, before_row.current_room,
      'ตรวจพบผู้รับสลิปเป็นพนักงานรายวัน จึงสร้างคิว HR เพิ่มจากคิวบัญชี',
      jsonb_build_object(
        'department', 'hr',
        'matched_side', 'recipient',
        'matched_employee_id', matched_employee_id,
        'employee_source', matched_employee_source,
        'source_message_id', target_source_message_id
      ),
      target_actor_id
    ) on conflict (event_key) do nothing;
  end if;
end;
$$;

create or replace function public.auto_route_transfer_slip_daily_employee_to_hr_from_transaction_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.auto_route_transfer_slip_daily_employee_to_hr(new.source_message_id, null);
  return new;
end;
$$;

create or replace function public.auto_route_transfer_slip_daily_employee_to_hr_from_flow_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.auto_route_transfer_slip_daily_employee_to_hr(new.source_message_id, null);
  return new;
end;
$$;

drop trigger if exists auto_route_transfer_slip_daily_employee_to_hr_from_transaction on public.financial_transactions;
create trigger auto_route_transfer_slip_daily_employee_to_hr_from_transaction
after insert or update of source_message_id, recipient_name, review_status
on public.financial_transactions
for each row execute function public.auto_route_transfer_slip_daily_employee_to_hr_from_transaction_trigger();

drop trigger if exists auto_route_transfer_slip_daily_employee_to_hr_from_flow on public.document_flow_items;
create trigger auto_route_transfer_slip_daily_employee_to_hr_from_flow
after insert or update of source_message_id, current_flow, state, document_type, candidate_departments
on public.document_flow_items
for each row execute function public.auto_route_transfer_slip_daily_employee_to_hr_from_flow_trigger();

-- Backfill only through the same central routing function so historical and new
-- transfer slips have identical task/audit semantics.
do $$
declare
  source_id uuid;
begin
  for source_id in
    select source_message_id
    from public.financial_transactions
    where source_message_id is not null
  loop
    perform public.auto_route_transfer_slip_daily_employee_to_hr(source_id, null);
  end loop;
end;
$$;

revoke all on function public.auto_route_transfer_slip_daily_employee_to_hr(uuid, uuid),
  public.auto_route_transfer_slip_daily_employee_to_hr_from_transaction_trigger(),
  public.auto_route_transfer_slip_daily_employee_to_hr_from_flow_trigger()
from public, anon, authenticated;

notify pgrst, 'reload schema';
