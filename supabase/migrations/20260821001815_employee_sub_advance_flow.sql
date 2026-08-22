-- A holder may issue part of a company advance to a technician.  The child is
-- a real advance case, not an expense, so it must settle before its parent can
-- close.
alter table public.employee_advance_cases
  add column if not exists parent_case_id uuid references public.employee_advance_cases(id) on delete restrict,
  add column if not exists parent_settlement_item_id uuid references public.employee_advance_settlement_items(id) on delete restrict;

-- Root cases remain uniquely tied to their funding slip.  A sub-advance has no
-- second slip or Intake item: it inherits that trace through parent_case_id.
alter table public.employee_advance_cases
  alter column financial_transaction_id drop not null,
  alter column source_flow_item_id drop not null;
alter table public.employee_advance_cases
  drop constraint if exists employee_advance_case_source_or_parent_check;
alter table public.employee_advance_cases
  add constraint employee_advance_case_source_or_parent_check
  check (
    parent_case_id is not null
    or (financial_transaction_id is not null and source_flow_item_id is not null)
  );
create index if not exists employee_advance_cases_parent_idx on public.employee_advance_cases(parent_case_id,status,updated_at desc);

alter table public.employee_advance_settlement_items
  drop constraint if exists employee_advance_settlement_items_expense_type_check;
alter table public.employee_advance_settlement_items
  add constraint employee_advance_settlement_items_expense_type_check
  check(expense_type in ('daily_wage','materials','travel','other','cash_return','payroll_offset','employee_advance'));

create or replace function public.create_employee_sub_advance(
  target_parent_case_id uuid,target_event_key text,target_holder_profile_id uuid,target_holder_person_id uuid,target_amount numeric,target_description text,target_project_id uuid default null,target_work_package_id uuid default null
) returns public.employee_advance_cases
language plpgsql security definer set search_path=public as $$
declare parent_row public.employee_advance_cases; line_row public.employee_advance_settlement_items; result public.employee_advance_cases;
begin
  select * into parent_row from public.employee_advance_cases where id=target_parent_case_id for update;
  if parent_row.id is null or not public.is_company_manager(parent_row.company_id) then raise exception 'advance_case_not_found_or_denied'; end if;
  if parent_row.status in ('closed','cancelled') or target_amount<=0 or length(btrim(coalesce(target_description,'')))<3 then raise exception 'sub_advance_invalid'; end if;
  if num_nonnulls(target_holder_profile_id,target_holder_person_id)<>1 then raise exception 'sub_advance_holder_required'; end if;
  insert into public.employee_advance_settlement_items(case_id,line_no,expense_type,amount,expense_date,payee_name,project_id,work_package_id,description,approval_status,created_by)
  values(parent_row.id,(select coalesce(max(line_no),0)+1 from public.employee_advance_settlement_items where case_id=parent_row.id),'employee_advance',target_amount,current_date,null,target_project_id,target_work_package_id,btrim(target_description),'approved',auth.uid()) returning * into line_row;
  insert into public.employee_advance_cases(company_id,advance_number,financial_transaction_id,source_flow_item_id,holder_profile_id,holder_person_id,amount_received,received_at,bank_reference,project_id,work_package_id,status,purpose_note,parent_case_id,parent_settlement_item_id,created_by)
  values(parent_row.company_id,parent_row.advance_number||'-SUB'||line_row.line_no,null,null,target_holder_profile_id,target_holder_person_id,target_amount,now(),parent_row.bank_reference,target_project_id,target_work_package_id,'draft','เงินเบิกล่วงหน้าจาก '||parent_row.advance_number,parent_row.id,line_row.id,auth.uid()) returning * into result;
  insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,after_data,reason) values(result.id,result.company_id,target_event_key,'create_sub_advance',auth.uid(),jsonb_build_object('parent_case_id',parent_row.id,'parent_settlement_item_id',line_row.id,'amount',target_amount),'สร้างเงินเบิกล่วงหน้าช่าง') on conflict(event_key) do nothing;
  return result;
end;
$$;

-- A parent cannot close if a child advance remains open.  Replace the transition
-- function with the same rules plus this hierarchy guard.
create or replace function public.transition_employee_advance_case(target_case_id uuid,target_event_key text,target_action text,target_expected_version integer,target_reason text default null)
returns public.employee_advance_cases language plpgsql security definer set search_path=public as $$
declare before_row public.employee_advance_cases; result public.employee_advance_cases; approved_total numeric:=0; pending_count integer:=0;
begin
 select * into before_row from public.employee_advance_cases where id=target_case_id for update;
 if before_row.id is null or not public.is_company_manager(before_row.company_id) then raise exception 'advance_case_not_found_or_denied'; end if;
 if before_row.version<>target_expected_version then raise exception 'advance_version_conflict'; end if;
 if target_action='submit' then update public.employee_advance_settlement_items set approval_status='submitted',updated_at=now() where case_id=before_row.id and approval_status='draft'; update public.employee_advance_cases set status='submitted',version=version+1,updated_at=now() where id=before_row.id returning * into result;
 elsif target_action='approve' then update public.employee_advance_settlement_items set approval_status='approved',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where case_id=before_row.id and approval_status='submitted'; update public.employee_advance_cases set status='approved',version=version+1,updated_at=now() where id=before_row.id returning * into result;
 elsif target_action='close' then
   if exists(select 1 from public.employee_advance_cases child where child.parent_case_id=before_row.id and child.status<>'closed') then raise exception 'advance_cannot_close_child_advance_open'; end if;
   select coalesce(sum(amount) filter(where approval_status='approved'),0),count(*) filter(where approval_status in ('draft','submitted','returned')) into approved_total,pending_count from public.employee_advance_settlement_items where case_id=before_row.id;
   if pending_count>0 or round(before_row.amount_received-approved_total,2)<>0 then raise exception 'advance_cannot_close_outstanding_or_pending'; end if;
   update public.employee_advance_cases set status='closed',version=version+1,updated_at=now() where id=before_row.id returning * into result;
 else raise exception 'advance_transition_invalid'; end if;
 insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,before_data,after_data,reason) values(before_row.id,before_row.company_id,target_event_key,target_action,auth.uid(),to_jsonb(before_row),to_jsonb(result),nullif(btrim(target_reason),'')) on conflict(event_key) do nothing;
 return result;
end;
$$;
revoke all on function public.create_employee_sub_advance(uuid,text,uuid,uuid,numeric,text,uuid,uuid) from public,anon;
grant execute on function public.create_employee_sub_advance(uuid,text,uuid,uuid,numeric,text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
