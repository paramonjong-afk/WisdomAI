-- Explicitly confirmed employee advance funding is not a project expense yet.
-- Raw/OCR evidence remains immutable; this RPC only writes reviewed projections,
-- an Accounting task, money-lineage draft and append-only audit/version rows.

create or replace function public.enforce_master_data_project_first_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  gate_status text;
  is_verified_advance_funding boolean := false;
begin
  if new.status in ('confirmed','approved','locked') and old.status not in ('confirmed','approved','locked') then
    gate_status := coalesce(new.candidate_data->>'project_gate_status','received');
    is_verified_advance_funding :=
      new.entity_type = 'bank_account'
      and new.source_table = 'financial_transactions'
      and new.source_id is not null
      and new.classification_type = 'employee_technician'
      and new.candidate_data->>'business_flow' = 'employee_advance_funding'
      and new.candidate_data->>'transaction_purpose' = 'advance_transfer'
      and new.candidate_data->>'project_allocation_status' = 'awaiting_allocation'
      and exists (
        select 1
        from public.financial_transactions transaction
        join public.document_flow_items item on item.source_message_id = transaction.source_message_id
        where transaction.id = new.source_id
          and transaction.company_id = new.company_id
          and item.company_id = new.company_id
          and transaction.review_status not in ('duplicate','dismissed')
          and coalesce(transaction.amount_total,0) > 0
          and nullif(btrim(coalesce(new.candidate_data->>'advance_holder_name',transaction.recipient_name)),'') is not null
          and coalesce(new.candidate_data->>'account_last4',transaction.recipient_account_last4) ~ '^[0-9]{4}$'
      );

    if gate_status not in ('linked_existing_project','awaiting_new_project','confirmed') and not is_verified_advance_funding then
      raise exception 'master_candidate_project_gate_required';
    end if;

    new.candidate_data := new.candidate_data || jsonb_build_object(
      'project_gate_resolution', case when is_verified_advance_funding then 'not_required_advance_funding' else gate_status end,
      'project_gate_status','confirmed',
      'project_gate_confirmed_at',now(),
      'project_gate_confirmed_by',auth.uid()
    );
  end if;
  return new;
end;
$$;

create or replace function public.confirm_master_data_employee_advance_funding(
  target_candidate_id uuid,
  target_event_key text,
  target_reason text,
  target_display_name text default null,
  target_account_last4 text default null,
  target_bank_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.master_data_candidates;
  result public.master_data_candidates;
  transaction_row public.financial_transactions;
  item_row public.document_flow_items;
  bank_row public.master_bank_accounts;
  task_row public.document_flow_destination_tasks;
  lineage_row public.transfer_slip_money_lineages;
  holder_row public.employee_advance_holders;
  prior_audit public.master_data_audit;
  before_lineage public.transfer_slip_money_lineages;
  resolved_account_last4 text;
  resolved_display_name text;
  resolved_bank_name text;
  account_fingerprint_value text;
  matched_profile_id uuid;
  matched_person_id uuid;
  profile_matches integer := 0;
  person_matches integer := 0;
  holder_match_status text := 'awaiting_employee_match';
  money_hops jsonb := '[]'::jsonb;
begin
  if nullif(btrim(target_event_key),'') is null then raise exception 'master_advance_event_key_required'; end if;
  if length(btrim(coalesce(target_reason,''))) < 3 then raise exception 'master_advance_reason_required'; end if;

  select * into prior_audit from public.master_data_audit where event_key = target_event_key;
  if prior_audit.id is not null then
    if prior_audit.candidate_id is distinct from target_candidate_id or prior_audit.action <> 'candidate_confirm_employee_advance_funding' then
      raise exception 'master_advance_event_key_conflict';
    end if;
    select * into result from public.master_data_candidates where id = target_candidate_id;
    select * into bank_row from public.master_bank_accounts where id = prior_audit.bank_account_id;
    select * into transaction_row from public.financial_transactions where id = result.source_id;
    select * into item_row from public.document_flow_items where source_message_id = transaction_row.source_message_id limit 1;
    select * into task_row from public.document_flow_destination_tasks where item_id = item_row.id and department = 'accounting';
    select * into lineage_row from public.transfer_slip_money_lineages where item_id = item_row.id;
    return jsonb_build_object('candidate',to_jsonb(result),'bank_account',to_jsonb(bank_row),'accounting_task',to_jsonb(task_row),'lineage',to_jsonb(lineage_row),'holder_match_status',result.candidate_data->>'advance_holder_match_status','replayed',true);
  end if;

  select * into source_row from public.master_data_candidates where id = target_candidate_id for update;
  if source_row.id is null or not public.is_company_manager(source_row.company_id) then raise exception 'master_advance_candidate_not_found_or_denied'; end if;
  if source_row.status in ('confirmed','approved','locked') and source_row.candidate_data->>'business_flow' = 'employee_advance_funding' then
    select * into transaction_row from public.financial_transactions where id = source_row.source_id;
    select * into item_row from public.document_flow_items where source_message_id = transaction_row.source_message_id limit 1;
    select * into task_row from public.document_flow_destination_tasks where item_id = item_row.id and department = 'accounting';
    select * into lineage_row from public.transfer_slip_money_lineages where item_id = item_row.id;
    return jsonb_build_object('candidate',to_jsonb(source_row),'accounting_task',to_jsonb(task_row),'lineage',to_jsonb(lineage_row),'holder_match_status',source_row.candidate_data->>'advance_holder_match_status','replayed',true);
  end if;
  if source_row.status not in ('provisional','pending_review','needs_review','needs_more_info','auto_verified','admin_reviewed') then raise exception 'master_advance_candidate_not_reviewable'; end if;
  if source_row.entity_type <> 'bank_account' or source_row.source_table <> 'financial_transactions' or source_row.source_id is null then raise exception 'master_advance_financial_source_required'; end if;

  select * into transaction_row from public.financial_transactions where id = source_row.source_id for update;
  if transaction_row.id is null or transaction_row.company_id <> source_row.company_id then raise exception 'master_advance_transaction_not_found'; end if;
  if transaction_row.review_status in ('duplicate','dismissed') then raise exception 'master_advance_transaction_not_usable'; end if;
  if coalesce(transaction_row.amount_total,0) <= 0 then raise exception 'master_advance_amount_required'; end if;
  resolved_display_name := coalesce(nullif(btrim(target_display_name),''),nullif(btrim(transaction_row.recipient_name),''),nullif(btrim(source_row.display_name),''));
  if resolved_display_name is null then raise exception 'master_advance_recipient_required'; end if;
  resolved_account_last4 := public.normalize_master_data_account_last4(coalesce(target_account_last4,source_row.candidate_data->>'account_last4',transaction_row.recipient_account_last4));
  if resolved_account_last4 is null then raise exception 'master_advance_account_last4_required'; end if;
  resolved_bank_name := coalesce(nullif(btrim(target_bank_name),''),nullif(btrim(transaction_row.recipient_bank_name),''),nullif(btrim(source_row.candidate_data->>'bank_name'),''));

  select * into item_row from public.document_flow_items where source_message_id = transaction_row.source_message_id and company_id = source_row.company_id for update;
  if item_row.id is null then raise exception 'master_advance_document_flow_required'; end if;

  select count(distinct employment.profile_id), min(employment.profile_id)
    into profile_matches, matched_profile_id
  from public.employee_employment_records employment
  join public.profiles profile on profile.id = employment.profile_id
  where employment.company_id = source_row.company_id
    and employment.employment_type = 'monthly'
    and employment.employment_status in ('active','probation','notice')
    and public.normalize_advance_holder_name(profile.full_name) = public.normalize_advance_holder_name(resolved_display_name);

  select count(distinct person.id), min(person.id)
    into person_matches, matched_person_id
  from public.employee_people person
  where person.company_id = source_row.company_id
    and person.employment_type = 'monthly'
    and person.employee_status = 'active'
    and public.normalize_advance_holder_name(person.full_name) = public.normalize_advance_holder_name(resolved_display_name);

  if profile_matches = 1 and person_matches = 0 then
    holder_match_status := 'matched_profile';
    matched_person_id := null;
  elsif profile_matches = 0 and person_matches = 1 then
    holder_match_status := 'matched_employee_person';
    matched_profile_id := null;
  else
    matched_profile_id := null;
    matched_person_id := null;
    holder_match_status := case when profile_matches + person_matches = 0 then 'awaiting_employee_match' else 'ambiguous_employee_match' end;
  end if;

  account_fingerprint_value := md5(source_row.company_id::text || '|' || public.normalize_master_data_name(resolved_display_name) || '|' || resolved_account_last4);
  select * into bank_row
  from public.master_bank_accounts account
  where account.company_id = source_row.company_id
    and account.verification_status <> 'archived'
    and account.normalized_owner_name = public.normalize_master_data_name(resolved_display_name)
    and account.account_last4 = resolved_account_last4
  order by account.updated_at desc
  limit 1
  for update;

  if bank_row.id is null then
    insert into public.master_bank_accounts(
      company_id,owner_type,owner_name,normalized_owner_name,profile_id,employee_person_id,
      bank_name,account_last4,account_fingerprint,verification_status,evidence_source_table,
      evidence_source_id,verified_by,verified_at,created_by
    ) values (
      source_row.company_id,'employee',resolved_display_name,public.normalize_master_data_name(resolved_display_name),
      matched_profile_id,matched_person_id,resolved_bank_name,
      resolved_account_last4,account_fingerprint_value,'verified',source_row.source_table,source_row.source_id,auth.uid(),now(),auth.uid()
    )
    on conflict (company_id,account_fingerprint)
      where account_fingerprint is not null and verification_status <> 'archived'
    do update set
      owner_type = 'employee',
      profile_id = coalesce(public.master_bank_accounts.profile_id,excluded.profile_id),
      employee_person_id = coalesce(public.master_bank_accounts.employee_person_id,excluded.employee_person_id),
      bank_name = coalesce(excluded.bank_name,public.master_bank_accounts.bank_name),
      verification_status = 'verified',
      verified_by = auth.uid(),verified_at = now(),updated_at = now()
    returning * into bank_row;
  else
    update public.master_bank_accounts set
      owner_type = 'employee',
      profile_id = coalesce(profile_id,matched_profile_id),
      employee_person_id = coalesce(employee_person_id,matched_person_id),
      owner_name = resolved_display_name,
      normalized_owner_name = public.normalize_master_data_name(resolved_display_name),
      bank_name = coalesce(resolved_bank_name,bank_name),
      account_fingerprint = coalesce(account_fingerprint,account_fingerprint_value),
      verification_status = 'verified',evidence_source_table = source_row.source_table,
      evidence_source_id = source_row.source_id,verified_by = auth.uid(),verified_at = now(),updated_at = now()
    where id = bank_row.id returning * into bank_row;
  end if;

  if matched_profile_id is not null or matched_person_id is not null then
    select * into holder_row
    from public.employee_advance_holders holder
    where holder.company_id = source_row.company_id
      and (holder.holder_profile_id = matched_profile_id or holder.holder_person_id = matched_person_id)
    limit 1;
    if holder_row.id is null then
      holder_row := public.upsert_employee_advance_holder_simple(matched_profile_id,matched_person_id,true,target_event_key || ':holder');
    end if;
    insert into public.employee_advance_holder_aliases(holder_id,alias_name,created_by)
    values(holder_row.id,resolved_display_name,auth.uid())
    on conflict(holder_id,alias_name) do nothing;
  end if;

  if nullif(btrim(transaction_row.sender_name),'') is not null then
    money_hops := jsonb_build_array(jsonb_build_object(
      'sequence',1,'from_party',btrim(transaction_row.sender_name),'to_party',resolved_display_name,
      'amount',transaction_row.amount_total,'source','financial_transactions','source_id',transaction_row.id
    ));
  end if;

  select * into before_lineage from public.transfer_slip_money_lineages where item_id = item_row.id for update;
  insert into public.transfer_slip_money_lineages(
    item_id,transaction_id,company_id,funding_source_type,funding_source_reference,fund_holder_name,
    payer_name,final_beneficiary_name,purpose_type,project_id,site_id,responsible_name,starting_amount,
    paid_amount,returned_amount,remaining_amount,hops,route_status,next_destination,route_note,created_by
  ) values (
    item_row.id,transaction_row.id,source_row.company_id,'company_account',nullif(btrim(transaction_row.sender_account_last4),''),
    resolved_display_name,nullif(btrim(transaction_row.sender_name),''),resolved_display_name,
    'advance_transfer',null,null,resolved_display_name,transaction_row.amount_total,transaction_row.amount_total,
    0,0,money_hops,'accounting_review','advance_finance',
    case when holder_match_status like 'matched_%' then 'Master Data ยืนยันผู้ถือเงินแล้ว · รอบัญชีตรวจสลิปก่อนส่งเงินสำรองจ่าย' else 'รอบัญชีตรวจสลิปและจับคู่ผู้ถือเงินก่อนส่งเงินสำรองจ่าย' end,
    auth.uid()
  ) on conflict(item_id) do update set
    funding_source_type = excluded.funding_source_type,
    funding_source_reference = excluded.funding_source_reference,
    fund_holder_name = excluded.fund_holder_name,payer_name = excluded.payer_name,
    final_beneficiary_name = excluded.final_beneficiary_name,purpose_type = 'advance_transfer',
    project_id = null,site_id = null,responsible_name = excluded.responsible_name,
    starting_amount = excluded.starting_amount,paid_amount = excluded.paid_amount,returned_amount = 0,
    remaining_amount = 0,hops = excluded.hops,route_status = 'accounting_review',
    next_destination = 'advance_finance',route_note = excluded.route_note,
    version = public.transfer_slip_money_lineages.version + 1,updated_at = now()
  returning * into lineage_row;

  insert into public.document_flow_destination_tasks(item_id,company_id,department,required,status,note)
  values(item_row.id,source_row.company_id,'accounting',true,'recheck_required','ตรวจสลิปเติมเงินทดลองจ่ายก่อนส่ง Advance Finance')
  on conflict(item_id,department) do update set
    required = true,
    status = case when public.document_flow_destination_tasks.status = 'claimed' then 'claimed' when public.document_flow_destination_tasks.status in ('queued','recheck_required') then public.document_flow_destination_tasks.status else 'recheck_required' end,
    assigned_to = case when public.document_flow_destination_tasks.status = 'claimed' then public.document_flow_destination_tasks.assigned_to else null end,
    completed_at = case when public.document_flow_destination_tasks.status = 'claimed' then public.document_flow_destination_tasks.completed_at else null end,
    completed_by = case when public.document_flow_destination_tasks.status = 'claimed' then public.document_flow_destination_tasks.completed_by else null end,
    note = excluded.note,version = public.document_flow_destination_tasks.version + 1,updated_at = now()
  returning * into task_row;

  update public.financial_transactions set expense_type = 'advance',updated_at = now() where id = transaction_row.id;

  update public.master_data_candidates set
    display_name = resolved_display_name,
    normalized_name = public.normalize_master_data_name(resolved_display_name),
    candidate_data = candidate_data || jsonb_build_object(
      'classification_type','employee_technician','business_flow','employee_advance_funding',
      'transaction_purpose','advance_transfer','advance_holder_name',resolved_display_name,
      'account_last4',resolved_account_last4,'bank_name',resolved_bank_name,
      'project_gate_status','not_required_advance_funding','project_allocation_status','awaiting_allocation',
      'suggested_destination','Accounting Pending Queue → Advance Finance','suggested_owner','Accounting',
      'suggested_next_action','ตรวจสลิปและผู้ถือเงิน แล้วเปิดเงินทดลองจ่ายรอจัดสรร',
      'advance_holder_match_status',holder_match_status,'accounting_task_id',task_row.id,
      'money_lineage_id',lineage_row.id,'master_bank_account_id',bank_row.id,
      'advance_funding_confirmed_at',now(),'advance_funding_confirmed_by',auth.uid()
    ),
    classification_type = 'employee_technician',
    classification_confidence = greatest(coalesce(classification_confidence,confidence,0),0.95),
    classification_evidence = coalesce(classification_evidence,'[]'::jsonb) || '["admin_advance_funding","bank_account","source_reference"]'::jsonb,
    classification_conflicts = '[]'::jsonb,
    classification_version = 'master-data-advance-funding-v1',classified_at = now(),
    status = 'confirmed',review_reason = btrim(target_reason),reviewed_by = auth.uid(),reviewed_at = now(),updated_at = now()
  where id = source_row.id returning * into result;

  insert into public.master_data_audit(company_id,candidate_id,bank_account_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(result.company_id,result.id,bank_row.id,target_event_key,'candidate_confirm_employee_advance_funding',auth.uid(),to_jsonb(source_row),to_jsonb(result),btrim(target_reason));

  insert into public.master_data_candidate_versions(company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by)
  select result.company_id,result.id,coalesce(max(version_no),0)+1,result.status,
    to_jsonb(result) || jsonb_build_object('accounting_task',to_jsonb(task_row),'money_lineage',to_jsonb(lineage_row)),
    result.source_table,result.source_id,target_event_key,auth.uid()
  from public.master_data_candidate_versions where candidate_id = result.id;

  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(item_row.id,item_row.company_id,target_event_key || ':document-flow','master_data_advance_funding_routed',
    item_row.current_flow,item_row.current_flow,item_row.state,item_row.state,item_row.current_room,item_row.current_room,btrim(target_reason),
    jsonb_build_object('candidate_id',result.id,'bank_account_id',bank_row.id,'accounting_task_id',task_row.id,
      'lineage_id',lineage_row.id,'before_lineage',to_jsonb(before_lineage),'after_lineage',to_jsonb(lineage_row),
      'holder_match_status',holder_match_status,'project_allocation_status','awaiting_allocation','next_destination','advance_finance'),auth.uid())
  on conflict(event_key) do nothing;

  return jsonb_build_object('candidate',to_jsonb(result),'bank_account',to_jsonb(bank_row),
    'accounting_task',to_jsonb(task_row),'lineage',to_jsonb(lineage_row),
    'holder_match_status',holder_match_status,'replayed',false);
end;
$$;

revoke all on function public.confirm_master_data_employee_advance_funding(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.confirm_master_data_employee_advance_funding(uuid,text,text,text,text,text) to authenticated;

comment on function public.confirm_master_data_employee_advance_funding(uuid,text,text,text,text,text) is
  'Confirms an employee/technician bank-account candidate as advance funding without fabricating a Project; routes Accounting first, preserves raw evidence and leaves Project allocation for settlement.';

notify pgrst,'reload schema';

-- Rollback/recovery: revoke the RPC and restore the prior Project-first trigger.
-- Existing candidate versions, Master audit, Accounting tasks and lineage rows
-- must be retained for reconciliation; never delete Raw/OCR or source records.
