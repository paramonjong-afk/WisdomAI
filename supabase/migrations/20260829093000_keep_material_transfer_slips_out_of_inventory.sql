-- A transfer slip can pay for materials, but it is not proof that goods were
-- received. Route the money to project cost review; inventory remains gated by
-- purchase/receipt documents.
do $$
declare
  function_sql text;
  old_branch text := $branch$
    elsif purpose = 'materials' then
      if not ('inventory' = any(next_departments)) then next_departments := array_append(next_departments, 'inventory'); end if;
      if not ('project' = any(next_departments)) then next_departments := array_append(next_departments, 'project'); end if;
      if not ('inventory_project' = any(next_destinations)) then next_destinations := array_append(next_destinations, 'inventory_project'); end if;
$branch$;
  new_branch text := $branch$
    elsif purpose = 'materials' then
      if not ('project' = any(next_departments)) then next_departments := array_append(next_departments, 'project'); end if;
      if not ('project' = any(next_destinations)) then next_destinations := array_append(next_destinations, 'project'); end if;
$branch$;
begin
  select pg_get_functiondef(p.oid)
  into function_sql
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'review_transfer_slip_money_lineage_v2'
    and pg_get_function_identity_arguments(p.oid) = 'target_item_id uuid, target_event_key text, target_decision text, target_transfer jsonb, target_lineage jsonb, target_allocations jsonb';

  if function_sql is null then
    raise exception 'review_transfer_slip_money_lineage_v2_not_found';
  end if;
  if position(old_branch in function_sql) = 0 then
    raise exception 'material_inventory_route_branch_not_found';
  end if;

  execute replace(function_sql, old_branch, new_branch);
end;
$$;

-- Repair only the tasks created by the money-allocation router. This does not
-- change source slips, OCR, amounts, or any inventory receipt/movement.
with affected as (
  select distinct l.id as lineage_id, l.item_id, l.company_id
  from public.transfer_slip_money_lineages l
  join public.transfer_slip_money_allocations a on a.lineage_id = l.id
  where l.next_destination = 'inventory_project'
    and l.route_status = 'routed'
    and a.purpose_type = 'materials'
    and a.status in ('confirmed', 'routed', 'reconciled')
    and not exists (
      select 1 from public.transfer_slip_money_allocations other
      where other.lineage_id = l.id
        and other.status in ('confirmed', 'routed', 'reconciled')
        and other.purpose_type <> 'materials'
    )
), repaired_lineage as (
  update public.transfer_slip_money_lineages l
  set next_destination = 'project',
      route_note = concat_ws(' · ', nullif(l.route_note, ''), 'แก้เส้นทาง: สลิปค่าวัสดุเป็นหลักฐานการเงิน ไม่ใช่ใบรับเข้า Stock'),
      version = l.version + 1,
      updated_at = now()
  from affected a
  where l.id = a.lineage_id
  returning l.item_id, l.company_id, l.id
), cancelled_inventory as (
  update public.document_flow_destination_tasks t
  set status = 'cancelled',
      note = concat_ws(' · ', nullif(t.note, ''), 'ยกเลิกเส้นทางอัตโนมัติ: สลิปเงินโอนไม่ใช่เอกสารรับสินค้า'),
      version = t.version + 1,
      updated_at = now()
  from repaired_lineage r
  where t.item_id = r.item_id
    and t.department = 'inventory'
    and t.note = 'สร้างจากการจัดสรรเส้นทางเงิน v2'
    and t.status not in ('completed', 'cancelled')
  returning t.item_id
), project_tasks as (
  insert into public.document_flow_destination_tasks(item_id, company_id, department, required, status, note)
  select item_id, company_id, 'project', true, 'queued', 'ตรวจต้นทุนโครงการจากสลิปค่าวัสดุ; ไม่รับเข้า Stock'
  from repaired_lineage
  on conflict(item_id, department) do update set
    required = true,
    status = case when public.document_flow_destination_tasks.status in ('returned', 'cancelled') then 'queued' else public.document_flow_destination_tasks.status end,
    note = excluded.note,
    updated_at = now()
  returning item_id
)
insert into public.document_flow_events(
  item_id, company_id, event_key, event_type, from_flow, to_flow,
  from_state, to_state, from_room, to_room, note, payload, actor_id
)
select i.id, i.company_id,
       'repair-material-transfer-route:' || r.id::text,
       'transfer_slip_material_route_corrected',
       i.current_flow, i.current_flow, i.state, i.state, i.current_room, i.current_room,
       'แก้เส้นทางค่าวัสดุจาก Inventory เป็น Project Cost โดยคงสลิปและข้อมูลเดิม',
       jsonb_build_object('lineage_id', r.id, 'before_destination', 'inventory_project', 'after_destination', 'project', 'inventory_mutated', false),
       null
from repaired_lineage r
join public.document_flow_items i on i.id = r.item_id
on conflict(event_key) do nothing;

revoke all on function public.review_transfer_slip_money_lineage_v2(uuid,text,text,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.review_transfer_slip_money_lineage_v2(uuid,text,text,jsonb,jsonb,jsonb) to authenticated;

notify pgrst, 'reload schema';
