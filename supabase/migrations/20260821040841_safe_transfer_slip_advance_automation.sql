-- Create an accountable parent advance only when the transfer evidence is
-- complete and unambiguous. Daily employees deliberately remain in HR /
-- Accounting review because a technician sub-advance must have a parent case.

create or replace function public.auto_create_safe_employee_advance_from_transfer(
  target_source_message_id uuid
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  transaction_row public.financial_transactions;
  source_item public.document_flow_items;
  holder_profile uuid;
  holder_person uuid;
  match_count integer := 0;
  result public.employee_advance_cases;
begin
  select * into transaction_row
  from public.financial_transactions
  where source_message_id = target_source_message_id
  limit 1;

  if transaction_row.id is null
    or transaction_row.review_status in ('duplicate', 'dismissed')
    or coalesce(transaction_row.amount_total, 0) <= 0
    or coalesce(transaction_row.payment_party_confidence, 0) < 0.900
    or nullif(btrim(transaction_row.recipient_name), '') is null
    or not exists (
      select 1 from public.financial_transaction_account_pairs pair
      where pair.financial_transaction_id = transaction_row.id
        and pair.registration_status in ('auto_registered', 'manual_verified')
    )
  then
    return;
  end if;

  select * into source_item
  from public.document_flow_items
  where source_message_id = target_source_message_id
  for update;

  -- Preserve the existing central route. A draft advance is created only after
  -- the slip has passed Intake/Filter and reached Accounting's destination queue.
  if source_item.id is null
    or source_item.company_id <> transaction_row.company_id
    or source_item.current_flow <> 'posting'
    or source_item.state <> 'destination_in_progress'
    or source_item.current_room <> 'destination_accounting_queue'
  then
    return;
  end if;

  select count(*), (array_agg(profile_id))[1], (array_agg(person_id))[1]
  into match_count, holder_profile, holder_person
  from (
    select employment.profile_id as profile_id, null::uuid as person_id
    from public.employee_employment_records employment
    join public.profiles profile on profile.id = employment.profile_id
    where employment.company_id = source_item.company_id
      and employment.employment_type = 'monthly'
      and employment.employment_status in ('active', 'probation', 'notice')
      and lower(regexp_replace(btrim(profile.full_name), '\\s+', '', 'g'))
        = lower(regexp_replace(btrim(transaction_row.recipient_name), '\\s+', '', 'g'))
    union all
    select null::uuid as profile_id, person.id as person_id
    from public.employee_people person
    where person.company_id = source_item.company_id
      and person.employment_type = 'monthly'
      and person.employee_status = 'active'
      and lower(regexp_replace(btrim(person.full_name), '\\s+', '', 'g'))
        = lower(regexp_replace(btrim(transaction_row.recipient_name), '\\s+', '', 'g'))
  ) candidates;

  -- Names can collide. Only a single tenant-scoped monthly employee is safe.
  if match_count <> 1 then
    return;
  end if;

  insert into public.employee_advance_cases(
    company_id, advance_number, financial_transaction_id, source_flow_item_id,
    holder_profile_id, holder_person_id, amount_received, received_at,
    bank_reference, project_id, status, purpose_note, created_by
  ) values (
    source_item.company_id,
    'ADV-' || to_char(now() at time zone 'Asia/Bangkok', 'YYYYMM') || '-'
      || upper(left(replace(source_item.id::text, '-', ''), 6)),
    transaction_row.id, source_item.id, holder_profile, holder_person,
    transaction_row.amount_total, transaction_row.transfer_at,
    transaction_row.bank_reference, transaction_row.project_id, 'draft',
    'ระบบสร้างจากสลิปที่จับคู่พนักงานรายเดือนและคู่บัญชีได้ครบ', null
  ) on conflict (financial_transaction_id) do update
    set updated_at = public.employee_advance_cases.updated_at
  returning * into result;

  insert into public.employee_advance_audit(
    case_id, company_id, event_key, action, actor_profile_id, after_data, reason
  ) values (
    result.id, result.company_id,
    'auto-create-advance:' || transaction_row.id::text,
    'auto_create_from_verified_transfer', null,
    jsonb_build_object(
      'financial_transaction_id', transaction_row.id,
      'source_flow_item_id', source_item.id,
      'payment_party_confidence', transaction_row.payment_party_confidence,
      'recipient_name', transaction_row.recipient_name
    ),
    'ระบบสร้างเงินสำรองจ่ายฉบับร่างจากสลิปที่ตรวจสอบได้ครบ'
  ) on conflict (event_key) do nothing;

  insert into public.document_flow_events(
    item_id, company_id, event_key, event_type,
    from_flow, to_flow, from_state, to_state, from_room, to_room,
    note, payload, actor_id
  ) values (
    source_item.id, source_item.company_id,
    'auto-advance-created:' || transaction_row.id::text,
    'employee_advance_auto_created',
    source_item.current_flow, source_item.current_flow,
    source_item.state, source_item.state,
    source_item.current_room, source_item.current_room,
    'ระบบสร้างเงินสำรองจ่ายฉบับร่างจากสลิปที่จับคู่พนักงานรายเดือนแบบ exact',
    jsonb_build_object('advance_case_id', result.id, 'advance_number', result.advance_number),
    null
  ) on conflict (event_key) do nothing;
end;
$$;

create or replace function public.auto_create_safe_employee_advance_from_transaction_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.auto_create_safe_employee_advance_from_transfer(new.source_message_id);
  return new;
end;
$$;

create or replace function public.auto_create_safe_employee_advance_from_flow_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.auto_create_safe_employee_advance_from_transfer(new.source_message_id);
  return new;
end;
$$;

drop trigger if exists auto_create_safe_employee_advance_from_transaction on public.financial_transactions;
create trigger auto_create_safe_employee_advance_from_transaction
after insert or update of source_message_id, review_status, amount_total, recipient_name, payment_party_confidence
on public.financial_transactions
for each row execute function public.auto_create_safe_employee_advance_from_transaction_trigger();

drop trigger if exists auto_create_safe_employee_advance_from_flow on public.document_flow_items;
create trigger auto_create_safe_employee_advance_from_flow
after insert or update of source_message_id, current_flow, state, current_room
on public.document_flow_items
for each row execute function public.auto_create_safe_employee_advance_from_flow_trigger();

do $$
declare source_id uuid;
begin
  for source_id in
    select source_message_id
    from public.financial_transactions
    where source_message_id is not null
  loop
    perform public.auto_create_safe_employee_advance_from_transfer(source_id);
  end loop;
end;
$$;

revoke all on function public.auto_create_safe_employee_advance_from_transfer(uuid),
  public.auto_create_safe_employee_advance_from_transaction_trigger(),
  public.auto_create_safe_employee_advance_from_flow_trigger()
from public, anon, authenticated;

notify pgrst, 'reload schema';
