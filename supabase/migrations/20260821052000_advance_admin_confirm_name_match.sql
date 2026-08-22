create or replace function public.create_employee_advance_from_transaction_with_holder(
  target_transaction_id uuid,
  target_event_key text,
  target_holder_profile_id uuid,
  target_holder_person_id uuid,
  target_purpose_note text default null
) returns public.employee_advance_cases
language plpgsql security definer set search_path=public as $$
declare
  transaction_row public.financial_transactions;
  source_item public.document_flow_items;
  holder_name text;
  result public.employee_advance_cases;
begin
  if num_nonnulls(target_holder_profile_id,target_holder_person_id)<>1 then
    raise exception 'advance_holder_selection_required';
  end if;

  select * into transaction_row from public.financial_transactions where id=target_transaction_id for update;
  if transaction_row.id is null or transaction_row.amount_total is null or coalesce(transaction_row.amount_total,0)<=0 then
    raise exception 'advance_source_transaction_not_found_or_amount_missing';
  end if;

  select * into source_item from public.document_flow_items where source_message_id=transaction_row.source_message_id for update;
  if source_item.id is null or source_item.company_id<>transaction_row.company_id or not public.is_company_manager(source_item.company_id) then
    raise exception 'advance_permission_or_source_flow_denied';
  end if;
  if transaction_row.review_status in ('duplicate','dismissed') then
    raise exception 'advance_source_transaction_not_usable';
  end if;

  if target_holder_profile_id is not null then
    select profile.full_name into holder_name
    from public.employee_employment_records employment
    join public.profiles profile on profile.id=employment.profile_id
    where employment.company_id=source_item.company_id
      and employment.profile_id=target_holder_profile_id
      and employment.employment_type='monthly'
      and employment.employment_status in ('active','probation','notice')
    limit 1;
  else
    select person.full_name into holder_name
    from public.employee_people person
    where person.company_id=source_item.company_id
      and person.id=target_holder_person_id
      and person.employment_type='monthly'
      and person.employee_status='active'
    limit 1;
  end if;

  if holder_name is null then
    raise exception 'advance_holder_not_active_monthly_or_denied';
  end if;

  insert into public.employee_advance_cases(
    company_id,advance_number,financial_transaction_id,source_flow_item_id,
    holder_profile_id,holder_person_id,amount_received,received_at,bank_reference,
    project_id,purpose_note,created_by
  )
  values(
    source_item.company_id,
    'ADV-'||to_char(now() at time zone 'Asia/Bangkok','YYYYMM')||'-'||upper(left(replace(source_item.id::text,'-',''),6)),
    transaction_row.id,source_item.id,target_holder_profile_id,target_holder_person_id,
    transaction_row.amount_total,transaction_row.transfer_at,transaction_row.bank_reference,
    transaction_row.project_id,
    coalesce(nullif(btrim(target_purpose_note),''),'Admin ยืนยันผู้ถือเงินจากชื่อผู้รับในสลิป: '||coalesce(transaction_row.recipient_name,'-')||' → '||holder_name),
    auth.uid()
  )
  on conflict(financial_transaction_id) do update set updated_at=public.employee_advance_cases.updated_at
  returning * into result;

  insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,after_data,reason)
  values(
    result.id,result.company_id,target_event_key,'admin_confirm_name_match',auth.uid(),
    jsonb_build_object('source_flow_item_id',result.source_flow_item_id,'amount_received',result.amount_received,'holder_name',holder_name,'recipient_name',transaction_row.recipient_name),
    'Admin ยืนยันผู้ถือเงินจาก candidate ชื่อใกล้เคียง'
  ) on conflict(event_key) do nothing;

  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(
    source_item.id,source_item.company_id,'advance-admin-name-match:'||result.id::text,'employee_advance_admin_name_match_confirmed',
    source_item.current_flow,source_item.current_flow,source_item.state,source_item.state,source_item.current_room,source_item.current_room,
    'Admin ยืนยันผู้ถือเงินสำรองจากชื่อผู้รับในสลิป ก่อนสร้างเงินทดรอง',
    jsonb_build_object('advance_case_id',result.id,'advance_number',result.advance_number,'holder_name',holder_name,'recipient_name',transaction_row.recipient_name),
    auth.uid()
  ) on conflict(event_key) do nothing;

  return result;
end;
$$;

revoke all on function public.create_employee_advance_from_transaction_with_holder(uuid,text,uuid,uuid,text) from public,anon;
grant execute on function public.create_employee_advance_from_transaction_with_holder(uuid,text,uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
