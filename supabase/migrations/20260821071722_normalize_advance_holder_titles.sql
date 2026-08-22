-- Normalize the name exactly once in the central database rule.  The UI may
-- suggest a name, but the automatic route must use the same title-insensitive
-- comparison to avoid missing "นาย/นาง/น.ส." on a bank slip.
create or replace function public.normalize_advance_holder_name(value text)
returns text
language sql
immutable
set search_path=public
as $$
  select lower(
    regexp_replace(
      regexp_replace(
        btrim(coalesce(value,'')),
        '^(นาย|นาง|นางสาว|น\\.ส\\.|บริษัท|บจก\\.?|หจก\\.?)\\s*',
        '',
        'i'
      ),
      '\\s+',
      '',
      'g'
    )
  )
$$;

create or replace function public.auto_create_safe_employee_advance_from_transfer(target_source_message_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare transaction_row public.financial_transactions; source_item public.document_flow_items; holder public.employee_advance_holders; holder_id uuid; holder_count integer:=0; result public.employee_advance_cases;
begin
  select * into transaction_row from public.financial_transactions where source_message_id=target_source_message_id limit 1;
  if transaction_row.id is null or transaction_row.review_status in ('duplicate','dismissed') or coalesce(transaction_row.amount_total,0)<=0 or coalesce(transaction_row.payment_party_confidence,0)<0.900 or nullif(btrim(transaction_row.recipient_name),'') is null or not exists(select 1 from public.financial_transaction_account_pairs pair where pair.financial_transaction_id=transaction_row.id and pair.registration_status in ('auto_registered','manual_verified')) then return; end if;
  select * into source_item from public.document_flow_items where source_message_id=target_source_message_id for update;
  if source_item.id is null or source_item.company_id<>transaction_row.company_id or source_item.current_flow<>'posting' or source_item.state<>'destination_in_progress' or source_item.current_room<>'destination_accounting_queue' then return; end if;
  select count(*),(array_agg(id))[1] into holder_count,holder_id from (
    select distinct candidate.id
    from public.employee_advance_holders candidate
    left join public.employee_advance_holder_aliases alias on alias.holder_id=candidate.id
    where candidate.company_id=source_item.company_id and candidate.is_active and (
      public.normalize_advance_holder_name(candidate.display_name)=public.normalize_advance_holder_name(transaction_row.recipient_name)
      or public.normalize_advance_holder_name(alias.alias_name)=public.normalize_advance_holder_name(transaction_row.recipient_name)
    )
  ) matches;
  if holder_count<>1 then return; end if;
  select * into holder from public.employee_advance_holders where id=holder_id;
  insert into public.employee_advance_cases(company_id,advance_number,financial_transaction_id,source_flow_item_id,holder_profile_id,holder_person_id,amount_received,received_at,bank_reference,project_id,status,purpose_note,created_by)
  values(source_item.company_id,'ADV-'||to_char(now() at time zone 'Asia/Bangkok','YYYYMM')||'-'||upper(left(replace(source_item.id::text,'-',''),6)),transaction_row.id,source_item.id,holder.holder_profile_id,holder.holder_person_id,transaction_row.amount_total,transaction_row.transfer_at,transaction_row.bank_reference,transaction_row.project_id,'draft','ระบบสร้างจากทะเบียนผู้ถือเงินและชื่อที่เรียนรู้จากสลิป',null)
  on conflict(financial_transaction_id) do update set updated_at=public.employee_advance_cases.updated_at returning * into result;
  insert into public.employee_advance_audit(case_id,company_id,event_key,action,after_data,reason)
  values(result.id,result.company_id,'auto-create-advance:'||transaction_row.id::text,'auto_create_from_holder_registry',jsonb_build_object('holder_id',holder.id,'financial_transaction_id',transaction_row.id,'name_match','title_normalized'),'ระบบสร้างเงินสำรองจ่ายฉบับร่างจากทะเบียนผู้ถือเงิน') on conflict(event_key) do nothing;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload)
  values(source_item.id,source_item.company_id,'auto-advance-created:'||transaction_row.id::text,'employee_advance_auto_created',source_item.current_flow,source_item.current_flow,source_item.state,source_item.state,source_item.current_room,source_item.current_room,'ระบบสร้างเงินสำรองจ่ายจากทะเบียนผู้ถือเงินที่ match ตรงกัน',jsonb_build_object('advance_case_id',result.id,'holder_id',holder.id,'name_match','title_normalized')) on conflict(event_key) do nothing;
end;
$$;

-- Re-run the same idempotent central rule so previously qualified slips are
-- repaired without creating a second case or changing the original slip.
do $$
declare source_message uuid;
begin
  for source_message in select distinct source_message_id from public.financial_transactions where source_message_id is not null loop
    perform public.auto_create_safe_employee_advance_from_transfer(source_message);
  end loop;
end;
$$;

revoke all on function public.normalize_advance_holder_name(text) from public,anon,authenticated;
notify pgrst,'reload schema';
