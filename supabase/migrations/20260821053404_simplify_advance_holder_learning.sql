-- Holder registration deliberately stores identity only. Bank/account facts
-- remain evidence on each slip and are never a form prerequisite.
alter table public.employee_advance_holders
  alter column destination_bank_name drop not null,
  alter column destination_account_last4 drop not null;

create or replace function public.upsert_employee_advance_holder_simple(
  target_profile_id uuid,
  target_person_id uuid,
  target_is_active boolean,
  target_event_key text
) returns public.employee_advance_holders
language plpgsql security definer set search_path=public as $$
declare target_company_id uuid; target_name text; before_row public.employee_advance_holders; result public.employee_advance_holders;
begin
  if num_nonnulls(target_profile_id,target_person_id)<>1 then raise exception 'advance_holder_selection_required'; end if;
  if target_profile_id is not null then
    select employment.company_id,profile.full_name into target_company_id,target_name
    from public.employee_employment_records employment join public.profiles profile on profile.id=employment.profile_id
    where employment.profile_id=target_profile_id and employment.employment_type='monthly' and employment.employment_status in ('active','probation','notice') limit 1;
  else
    select company_id,full_name into target_company_id,target_name from public.employee_people
    where id=target_person_id and employment_type='monthly' and employee_status='active' limit 1;
  end if;
  if target_company_id is null or nullif(btrim(target_name),'') is null or not public.is_company_manager(target_company_id) then raise exception 'advance_holder_person_not_active_monthly_or_denied'; end if;
  select * into before_row from public.employee_advance_holders where company_id=target_company_id and (holder_profile_id=target_profile_id or holder_person_id=target_person_id) for update;
  if before_row.id is null then
    insert into public.employee_advance_holders(company_id,holder_profile_id,holder_person_id,display_name,destination_bank_name,destination_account_last4,is_active,created_by)
    values(target_company_id,target_profile_id,target_person_id,btrim(target_name),null,null,target_is_active,auth.uid()) returning * into result;
  else
    update public.employee_advance_holders set display_name=btrim(target_name),is_active=target_is_active,updated_at=now() where id=before_row.id returning * into result;
  end if;
  insert into public.employee_advance_holder_aliases(holder_id,alias_name,created_by)
  values(result.id,result.display_name,auth.uid()) on conflict(holder_id,alias_name) do nothing;
  insert into public.employee_advance_holder_audit(holder_id,company_id,event_key,action,actor_profile_id,before_data,after_data)
  values(result.id,result.company_id,target_event_key,'upsert_holder_name_only',auth.uid(),to_jsonb(before_row),to_jsonb(result)) on conflict(event_key) do nothing;
  return result;
end;
$$;

-- Use only a known name/alias. The first English/variant name is learned from
-- a manager confirmation, never inferred automatically.
create or replace function public.auto_create_safe_employee_advance_from_transfer(target_source_message_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare transaction_row public.financial_transactions; source_item public.document_flow_items; holder public.employee_advance_holders; holder_id uuid; holder_count integer:=0; result public.employee_advance_cases;
begin
  select * into transaction_row from public.financial_transactions where source_message_id=target_source_message_id limit 1;
  if transaction_row.id is null or transaction_row.review_status in ('duplicate','dismissed') or coalesce(transaction_row.amount_total,0)<=0 or coalesce(transaction_row.payment_party_confidence,0)<0.900 or nullif(btrim(transaction_row.recipient_name),'') is null or not exists(select 1 from public.financial_transaction_account_pairs pair where pair.financial_transaction_id=transaction_row.id and pair.registration_status in ('auto_registered','manual_verified')) then return; end if;
  select * into source_item from public.document_flow_items where source_message_id=target_source_message_id for update;
  if source_item.id is null or source_item.company_id<>transaction_row.company_id or source_item.current_flow<>'posting' or source_item.state<>'destination_in_progress' or source_item.current_room<>'destination_accounting_queue' then return; end if;
  select count(*),(array_agg(id))[1] into holder_count,holder_id from (
    select distinct candidate.id from public.employee_advance_holders candidate left join public.employee_advance_holder_aliases alias on alias.holder_id=candidate.id
    where candidate.company_id=source_item.company_id and candidate.is_active and (
      lower(regexp_replace(btrim(candidate.display_name),'\\s+','','g'))=lower(regexp_replace(btrim(transaction_row.recipient_name),'\\s+','','g'))
      or lower(regexp_replace(btrim(alias.alias_name),'\\s+','','g'))=lower(regexp_replace(btrim(transaction_row.recipient_name),'\\s+','','g'))
    )
  ) matches;
  if holder_count<>1 then return; end if;
  select * into holder from public.employee_advance_holders where id=holder_id;
  insert into public.employee_advance_cases(company_id,advance_number,financial_transaction_id,source_flow_item_id,holder_profile_id,holder_person_id,amount_received,received_at,bank_reference,project_id,status,purpose_note,created_by)
  values(source_item.company_id,'ADV-'||to_char(now() at time zone 'Asia/Bangkok','YYYYMM')||'-'||upper(left(replace(source_item.id::text,'-',''),6)),transaction_row.id,source_item.id,holder.holder_profile_id,holder.holder_person_id,transaction_row.amount_total,transaction_row.transfer_at,transaction_row.bank_reference,transaction_row.project_id,'draft','ระบบสร้างจากทะเบียนผู้ถือเงินและชื่อที่เรียนรู้จากสลิป',null)
  on conflict(financial_transaction_id) do update set updated_at=public.employee_advance_cases.updated_at returning * into result;
  insert into public.employee_advance_audit(case_id,company_id,event_key,action,after_data,reason)
  values(result.id,result.company_id,'auto-create-advance:'||transaction_row.id::text,'auto_create_from_holder_registry',jsonb_build_object('holder_id',holder.id,'financial_transaction_id',transaction_row.id),'ระบบสร้างเงินสำรองจ่ายฉบับร่างจากทะเบียนผู้ถือเงิน') on conflict(event_key) do nothing;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload)
  values(source_item.id,source_item.company_id,'auto-advance-created:'||transaction_row.id::text,'employee_advance_auto_created',source_item.current_flow,source_item.current_flow,source_item.state,source_item.state,source_item.current_room,source_item.current_room,'ระบบสร้างเงินสำรองจ่ายจากทะเบียนผู้ถือเงินที่ match ตรงกัน',jsonb_build_object('advance_case_id',result.id,'holder_id',holder.id)) on conflict(event_key) do nothing;
end;
$$;

-- Confirmation of a suggested holder both creates the draft case and teaches
-- the observed recipient name as an alias for later automatic matching.
create or replace function public.create_employee_advance_from_transaction_with_holder(
  target_transaction_id uuid,target_event_key text,target_holder_profile_id uuid,target_holder_person_id uuid,target_purpose_note text default null
) returns public.employee_advance_cases
language plpgsql security definer set search_path=public as $$
declare transaction_row public.financial_transactions; source_item public.document_flow_items; holder_name text; holder_row public.employee_advance_holders; result public.employee_advance_cases;
begin
  if num_nonnulls(target_holder_profile_id,target_holder_person_id)<>1 then raise exception 'advance_holder_selection_required'; end if;
  select * into transaction_row from public.financial_transactions where id=target_transaction_id for update;
  if transaction_row.id is null or coalesce(transaction_row.amount_total,0)<=0 then raise exception 'advance_source_transaction_not_found_or_amount_missing'; end if;
  select * into source_item from public.document_flow_items where source_message_id=transaction_row.source_message_id for update;
  if source_item.id is null or source_item.company_id<>transaction_row.company_id or not public.is_company_manager(source_item.company_id) then raise exception 'advance_permission_or_source_flow_denied'; end if;
  if transaction_row.review_status in ('duplicate','dismissed') then raise exception 'advance_source_transaction_not_usable'; end if;
  select * into holder_row from public.upsert_employee_advance_holder_simple(target_holder_profile_id,target_holder_person_id,true,'holder-learn:'||target_transaction_id::text);
  holder_name:=holder_row.display_name;
  if nullif(btrim(transaction_row.recipient_name),'') is not null then
    insert into public.employee_advance_holder_aliases(holder_id,alias_name,created_by) values(holder_row.id,btrim(transaction_row.recipient_name),auth.uid()) on conflict(holder_id,alias_name) do nothing;
  end if;
  insert into public.employee_advance_cases(company_id,advance_number,financial_transaction_id,source_flow_item_id,holder_profile_id,holder_person_id,amount_received,received_at,bank_reference,project_id,purpose_note,created_by)
  values(source_item.company_id,'ADV-'||to_char(now() at time zone 'Asia/Bangkok','YYYYMM')||'-'||upper(left(replace(source_item.id::text,'-',''),6)),transaction_row.id,source_item.id,target_holder_profile_id,target_holder_person_id,transaction_row.amount_total,transaction_row.transfer_at,transaction_row.bank_reference,transaction_row.project_id,coalesce(nullif(btrim(target_purpose_note),''),'Admin ยืนยันผู้ถือเงินและเรียนรู้ชื่อจากสลิป: '||coalesce(transaction_row.recipient_name,'-')||' → '||holder_name),auth.uid())
  on conflict(financial_transaction_id) do update set updated_at=public.employee_advance_cases.updated_at returning * into result;
  insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,after_data,reason) values(result.id,result.company_id,target_event_key,'admin_confirm_name_match',auth.uid(),jsonb_build_object('holder_id',holder_row.id,'holder_name',holder_name,'recipient_name',transaction_row.recipient_name),'Admin ยืนยันผู้ถือเงินและให้ระบบเรียนรู้ชื่อจากสลิป') on conflict(event_key) do nothing;
  return result;
end;
$$;

revoke all on function public.upsert_employee_advance_holder_simple(uuid,uuid,boolean,text) from public,anon;
grant execute on function public.upsert_employee_advance_holder_simple(uuid,uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
