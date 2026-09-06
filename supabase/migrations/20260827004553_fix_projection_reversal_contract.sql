-- Keep the automatic projection reconciliation compatible with the ledger
-- constraint: adjusts_entry_id belongs only to adjustment/reversal entry types.
-- The replacement relationship remains fully traceable in source_snapshot
-- and employee_money_ledger_audit.

create or replace function public.reconcile_employee_money_projection_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  legacy_row public.employee_money_ledger_entries;
  before_row jsonb;
begin
  if new.allocation_id is null or new.entry_status in ('rejected','reversed') then return new; end if;

  select * into legacy_row from public.employee_money_ledger_entries entry
  where entry.company_id=new.company_id
    and entry.financial_transaction_id=new.financial_transaction_id
    and entry.allocation_id is null
    and entry.employee_profile_id=new.employee_profile_id
    and entry.entry_type=new.entry_type
    and entry.amount=new.amount
    and entry.entry_status not in ('rejected','reversed')
  order by entry.created_at
  limit 1 for update;

  if legacy_row.id is null then return new; end if;
  before_row:=to_jsonb(legacy_row);

  update public.employee_money_ledger_entries
  set entry_status='reversed',
      reviewed_by=coalesce(new.created_by,auth.uid()),
      reviewed_at=now(),
      reason='แทนที่ Transaction projection เดิมด้วย Allocation projection ที่ยืนยันแล้ว',
      source_snapshot=source_snapshot || jsonb_build_object(
        'replaced_by_entry_id',new.id,
        'replaced_by_allocation_id',new.allocation_id,
        'projection_reconciled_at',now()),
      version=version+1,
      updated_at=now()
  where id=legacy_row.id
  returning * into legacy_row;

  insert into public.employee_money_ledger_audit
    (company_id,entry_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values
    (new.company_id,legacy_row.id,
     'employee-money-projection-scope:'||new.id::text,
     'legacy_projection_reversed',coalesce(new.created_by,auth.uid()),
     before_row,to_jsonb(legacy_row),
     'คงประวัติเดิม แต่ไม่นับยอดซ้ำกับ Allocation projection')
  on conflict(company_id,event_key) do nothing;
  return new;
end;
$$;

revoke all on function public.reconcile_employee_money_projection_scope() from public,anon,authenticated;
notify pgrst,'reload schema';
