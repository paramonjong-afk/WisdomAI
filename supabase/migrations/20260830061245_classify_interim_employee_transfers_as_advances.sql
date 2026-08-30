-- Employee transfers made inside an open payroll period are advances, not final wages.
-- Keep source slips immutable, reverse duplicate projections, and append every decision to Audit.
do $$
declare
  duplicate_row record;
  before_row jsonb;
begin
  for duplicate_row in
    select entry.id, entry.company_id,
      case
        when allocation.status = 'superseded' then 'Allocation รุ่นเก่าถูกแทนที่แล้ว จึงไม่นับยอดซ้ำ'
        else 'Transaction projection ถูกแทนที่ด้วย Allocation projection ของสลิปเดียวกัน'
      end as reversal_reason
    from public.employee_money_ledger_entries entry
    left join public.transfer_slip_money_allocations allocation on allocation.id = entry.allocation_id
    where entry.entry_status not in ('rejected', 'reversed')
      and entry.entry_type in ('advance_issued', 'wage_paid')
      and (
        allocation.status = 'superseded'
        or (
          entry.allocation_id is null
          and exists (
            select 1
            from public.employee_money_ledger_entries allocation_entry
            join public.transfer_slip_money_allocations active_allocation
              on active_allocation.id = allocation_entry.allocation_id
            where allocation_entry.company_id = entry.company_id
              and allocation_entry.financial_transaction_id = entry.financial_transaction_id
              and allocation_entry.employee_profile_id = entry.employee_profile_id
              and allocation_entry.amount = entry.amount
              and allocation_entry.entry_status not in ('rejected', 'reversed')
              and active_allocation.status in ('confirmed', 'routed', 'reconciled')
          )
        )
      )
  loop
    select to_jsonb(entry) into before_row
    from public.employee_money_ledger_entries entry
    where entry.id = duplicate_row.id;

    update public.employee_money_ledger_entries
    set entry_status = 'reversed',
        reviewed_at = now(),
        reason = duplicate_row.reversal_reason,
        source_snapshot = source_snapshot || jsonb_build_object(
          'duplicate_projection_reconciled_at', now(),
          'duplicate_projection_policy', 'one_active_ledger_fact_per_transfer_allocation'),
        version = version + 1,
        updated_at = now()
    where id = duplicate_row.id
      and entry_status not in ('rejected', 'reversed');

    insert into public.employee_money_ledger_audit(
      company_id, entry_id, event_key, action, actor_profile_id,
      before_data, after_data, reason
    )
    select duplicate_row.company_id, entry.id,
      'employee-money:duplicate-reconciled:' || entry.id::text,
      'duplicate_projection_reversed', null, before_row, to_jsonb(entry),
      duplicate_row.reversal_reason
    from public.employee_money_ledger_entries entry
    where entry.id = duplicate_row.id
    on conflict(company_id, event_key) do nothing;
  end loop;
end;
$$;

do $$
declare
  wage_row record;
  before_row jsonb;
begin
  for wage_row in
    select entry.id, entry.company_id
    from public.employee_money_ledger_entries entry
    where entry.entry_type = 'wage_paid'
      and entry.entry_status = 'matched_pending_review'
      and entry.evidence_date_status = 'verified'
      and entry.effective_on is not null
      and exists (
        select 1
        from public.pay_periods period
        where period.company_id = entry.company_id
          and entry.effective_on between period.starts_on and period.ends_on
          and period.status not in ('closed', 'paying', 'paid', 'cancelled')
      )
  loop
    select to_jsonb(entry) into before_row
    from public.employee_money_ledger_entries entry
    where entry.id = wage_row.id;

    update public.employee_money_ledger_entries
    set entry_type = 'advance_issued',
        account_scope = 'advance',
        reason = 'รายการโอนระหว่างงวดเปิด จัดเป็นเงินเบิกล่วงหน้ารอหักเมื่อปิดงวด',
        source_snapshot = source_snapshot || jsonb_build_object(
          'classification_policy', 'open_period_transfer_is_advance',
          'reclassified_at', now()),
        version = version + 1,
        updated_at = now()
    where id = wage_row.id
      and entry_type = 'wage_paid'
      and entry_status = 'matched_pending_review';

    insert into public.employee_money_ledger_audit(
      company_id, entry_id, event_key, action, actor_profile_id,
      before_data, after_data, reason
    )
    select wage_row.company_id, entry.id,
      'employee-money:interim-wage-to-advance:' || entry.id::text,
      'interim_transfer_reclassified_as_advance', null, before_row, to_jsonb(entry),
      'เงินที่โอนระหว่างงวดเป็นเงินเบิกล่วงหน้า ค่าแรงสุทธิคำนวณเมื่อปิดงวด'
    from public.employee_money_ledger_entries entry
    where entry.id = wage_row.id
    on conflict(company_id, event_key) do nothing;
  end loop;
end;
$$;

create or replace function public.auto_assign_employee_money_pay_period(
  target_entry_id uuid,
  target_event_key text
) returns public.employee_money_pay_period_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_row public.employee_money_ledger_entries;
  period_row public.pay_periods;
  period_count integer;
  result public.employee_money_pay_period_assignments;
begin
  if nullif(btrim(target_event_key), '') is null then
    raise exception 'employee_money_pay_period_event_key_required';
  end if;

  select * into entry_row
  from public.employee_money_ledger_entries
  where id = target_entry_id
  for update;

  if entry_row.id is null
    or entry_row.entry_type not in ('advance_issued', 'wage_paid', 'adjustment_debit', 'adjustment_credit', 'reversal')
    or entry_row.entry_status in ('rejected', 'reversed')
    or entry_row.effective_on is null
    or entry_row.evidence_date_status <> 'verified' then
    return null;
  end if;

  select count(*) into period_count
  from public.pay_periods period
  where period.company_id = entry_row.company_id
    and entry_row.effective_on between period.starts_on and period.ends_on
    and period.status not in ('closed', 'paying', 'paid', 'cancelled');

  if period_count <> 1 then return null; end if;
  select * into period_row
  from public.pay_periods period
  where period.company_id = entry_row.company_id
    and entry_row.effective_on between period.starts_on and period.ends_on
    and period.status not in ('closed', 'paying', 'paid', 'cancelled');

  select * into result
  from public.employee_money_pay_period_assignments assignment
  where assignment.ledger_entry_id = entry_row.id;
  if result.id is not null then return result; end if;

  insert into public.employee_money_pay_period_assignments(
    company_id, ledger_entry_id, pay_period_id, assignment_method, reason, assigned_by
  ) values (
    entry_row.company_id, entry_row.id, period_row.id, 'transfer_date_auto',
    'ผูกรอบอัตโนมัติจากวันที่โอนที่ยืนยันแล้วและพบรอบที่ตรงเพียงรอบเดียว', null
  ) returning * into result;

  insert into public.employee_money_ledger_audit(
    company_id, entry_id, event_key, action, actor_profile_id, after_data, reason
  ) values (
    entry_row.company_id, entry_row.id, target_event_key, 'pay_period_auto_assigned', null,
    jsonb_build_object('assignment_id', result.id, 'pay_period_id', result.pay_period_id,
      'assignment_method', result.assignment_method, 'effective_on', entry_row.effective_on),
    result.reason
  ) on conflict(company_id, event_key) do nothing;

  return result;
end;
$$;

revoke all on function public.auto_assign_employee_money_pay_period(uuid, text)
  from public, anon, authenticated;

create or replace function public.assign_employee_money_pay_period(
  target_entry_id uuid,
  target_pay_period_id uuid,
  target_event_key text,
  target_reason text
) returns public.employee_money_pay_period_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_row public.employee_money_ledger_entries;
  period_row public.pay_periods;
  before_row public.employee_money_pay_period_assignments;
  result public.employee_money_pay_period_assignments;
begin
  if nullif(btrim(target_event_key), '') is null or length(btrim(coalesce(target_reason, ''))) < 3 then
    raise exception 'employee_money_pay_period_input_invalid';
  end if;

  select * into entry_row from public.employee_money_ledger_entries where id = target_entry_id for update;
  if entry_row.id is null
    or entry_row.entry_type not in ('advance_issued', 'wage_paid', 'adjustment_debit', 'adjustment_credit', 'reversal')
    or not public.is_company_manager(entry_row.company_id) then
    raise exception 'employee_money_entry_not_found_or_denied';
  end if;
  if entry_row.entry_status in ('rejected', 'reversed') then raise exception 'employee_money_entry_inactive'; end if;

  select * into period_row from public.pay_periods
  where id = target_pay_period_id and company_id = entry_row.company_id;
  if period_row.id is null then raise exception 'employee_money_pay_period_not_found'; end if;
  if period_row.status in ('closed', 'paying', 'paid', 'cancelled') then
    raise exception 'payroll_period_locked_use_adjustment';
  end if;

  select * into before_row from public.employee_money_pay_period_assignments
  where ledger_entry_id = entry_row.id for update;
  if before_row.pay_period_id = period_row.id then return before_row; end if;

  insert into public.employee_money_pay_period_assignments(
    company_id, ledger_entry_id, pay_period_id, assignment_method, reason, assigned_by
  ) values (
    entry_row.company_id, entry_row.id, period_row.id, 'admin_selected', btrim(target_reason), auth.uid()
  )
  on conflict(ledger_entry_id) do update set
    pay_period_id = excluded.pay_period_id,
    assignment_method = excluded.assignment_method,
    reason = excluded.reason,
    assigned_by = excluded.assigned_by,
    assigned_at = now(),
    version = public.employee_money_pay_period_assignments.version + 1,
    updated_at = now()
  returning * into result;

  insert into public.employee_money_ledger_audit(
    company_id, entry_id, event_key, action, actor_profile_id, before_data, after_data, reason
  ) values (
    entry_row.company_id, entry_row.id, target_event_key,
    case when before_row.id is null then 'pay_period_admin_assigned' else 'pay_period_admin_reassigned' end,
    auth.uid(), case when before_row.id is null then null else to_jsonb(before_row) end,
    to_jsonb(result), btrim(target_reason)
  );
  return result;
end;
$$;

revoke all on function public.assign_employee_money_pay_period(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.assign_employee_money_pay_period(uuid, uuid, text, text)
  to authenticated;

drop trigger if exists auto_assign_employee_money_pay_period_after_write
  on public.employee_money_ledger_entries;
create trigger auto_assign_employee_money_pay_period_after_write
after insert or update of effective_on, evidence_date_status, entry_status, entry_type, account_scope
on public.employee_money_ledger_entries
for each row execute function public.auto_assign_employee_money_pay_period_trigger();

select public.auto_assign_employee_money_pay_period(
  entry.id,
  'employee-money:pay-period:advance-backfill:' || entry.id::text
)
from public.employee_money_ledger_entries entry
where entry.entry_type in ('advance_issued', 'wage_paid', 'adjustment_debit', 'adjustment_credit', 'reversal')
  and entry.entry_status not in ('rejected', 'reversed')
  and entry.effective_on is not null
  and entry.evidence_date_status = 'verified';

create or replace view public.employee_money_period_summary_v1
with (security_invoker = true)
as
select
  entry.company_id,
  entry.employee_profile_id,
  profile.full_name as employee_name,
  assignment.pay_period_id,
  period.name as pay_period_name,
  period.starts_on as pay_period_starts_on,
  period.ends_on as pay_period_ends_on,
  period.status as pay_period_status,
  count(*) filter (where entry.entry_type = 'advance_issued') as advance_entry_count,
  count(*) filter (where entry.entry_status = 'matched_pending_review') as pending_review_count,
  coalesce(sum(entry.amount) filter (
    where entry.entry_type = 'advance_issued'
      and entry.entry_status = 'matched_pending_review'
  ), 0)::numeric(14,2) as pending_advance_amount,
  coalesce(sum(entry.amount) filter (
    where entry.entry_type = 'advance_issued'
      and entry.entry_status = 'approved'
  ), 0)::numeric(14,2) as approved_advance_amount,
  coalesce(sum(case
    when entry.entry_status = 'approved' and entry.account_scope = 'advance'
      and entry.entry_type = 'adjustment_debit' then entry.amount
    when entry.entry_status = 'approved' and entry.account_scope = 'advance'
      and entry.entry_type in ('adjustment_credit', 'reversal') then -entry.amount
    else 0 end), 0)::numeric(14,2) as approved_adjustment_net,
  coalesce(sum(entry.amount) filter (
    where entry.entry_status = 'matched_pending_review'
      and entry.account_scope = 'advance'
      and entry.entry_type in ('adjustment_debit', 'adjustment_credit', 'reversal')
  ), 0)::numeric(14,2) as pending_adjustment_amount,
  (
    coalesce(sum(entry.amount) filter (where entry.entry_type = 'advance_issued'), 0)
    + coalesce(sum(case
      when entry.entry_status = 'approved' and entry.account_scope = 'advance'
        and entry.entry_type = 'adjustment_debit' then entry.amount
      when entry.entry_status = 'approved' and entry.account_scope = 'advance'
        and entry.entry_type in ('adjustment_credit', 'reversal') then -entry.amount
      else 0 end), 0)
  )::numeric(14,2) as advance_to_deduct,
  max(entry.updated_at) as updated_at
from public.employee_money_ledger_entries entry
join public.employee_money_pay_period_assignments assignment
  on assignment.ledger_entry_id = entry.id
join public.pay_periods period on period.id = assignment.pay_period_id
join public.profiles profile on profile.id = entry.employee_profile_id
where entry.entry_status not in ('rejected', 'reversed')
  and (
    entry.entry_type = 'advance_issued'
    or (entry.account_scope = 'advance' and entry.entry_type in ('adjustment_debit', 'adjustment_credit', 'reversal'))
  )
group by entry.company_id, entry.employee_profile_id, profile.full_name,
  assignment.pay_period_id, period.name, period.starts_on, period.ends_on, period.status;

revoke all on public.employee_money_period_summary_v1 from public, anon;
grant select on public.employee_money_period_summary_v1 to authenticated;

comment on view public.employee_money_period_summary_v1 is
  'Canonical employee advances grouped by employee and pay period. Raw transfer evidence is never rewritten; approved adjustments are applied separately.';

notify pgrst, 'reload schema';
