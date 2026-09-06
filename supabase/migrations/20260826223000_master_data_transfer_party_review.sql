-- Review and persist both parties of an advance-funding transfer slip.
-- Raw/OCR/financial source rows remain read-only. The current pair projection is
-- versioned here while command history stays append-only in master_data_audit,
-- master_data_candidate_versions and document_flow_events.

create table if not exists public.master_data_transfer_party_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid not null references public.master_data_candidates(id) on delete restrict,
  transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  source_message_id uuid references public.line_messages(id) on delete restrict,
  sender_name text not null,
  sender_bank_name text,
  sender_account_last4 text not null check (sender_account_last4 ~ '^[0-9]{4}$'),
  sender_classification text not null default 'company_internal'
    check (sender_classification in ('vendor','employee_technician','customer','company_internal','unknown_review')),
  sender_master_bank_account_id uuid references public.master_bank_accounts(id) on delete restrict,
  sender_review_status text not null default 'confirmed'
    check (sender_review_status in ('needs_review','confirmed')),
  recipient_name text not null,
  recipient_bank_name text,
  recipient_account_last4 text not null check (recipient_account_last4 ~ '^[0-9]{4}$'),
  recipient_classification text not null default 'employee_technician'
    check (recipient_classification in ('vendor','employee_technician','customer','company_internal','unknown_review')),
  recipient_master_bank_account_id uuid references public.master_bank_accounts(id) on delete restrict,
  recipient_review_status text not null default 'confirmed'
    check (recipient_review_status in ('needs_review','confirmed')),
  review_status text not null default 'confirmed'
    check (review_status in ('needs_review','confirmed')),
  reason text not null,
  last_event_key text not null,
  version integer not null default 1 check (version > 0),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,transaction_id)
);

create index if not exists master_data_transfer_party_reviews_candidate_idx
  on public.master_data_transfer_party_reviews(company_id,candidate_id,review_status);

alter table public.master_data_transfer_party_reviews enable row level security;
drop policy if exists "Company managers read transfer-party reviews" on public.master_data_transfer_party_reviews;
create policy "Company managers read transfer-party reviews"
  on public.master_data_transfer_party_reviews for select to authenticated
  using ((select public.is_company_manager(company_id)));

revoke all on table public.master_data_transfer_party_reviews from anon;
revoke insert,update,delete on table public.master_data_transfer_party_reviews from authenticated;
grant select on table public.master_data_transfer_party_reviews to authenticated;

create or replace function public.confirm_master_data_employee_advance_funding_v2(
  target_candidate_id uuid,
  target_event_key text,
  target_reason text,
  target_sender_name text default null,
  target_sender_account_last4 text default null,
  target_sender_bank_name text default null,
  target_recipient_name text default null,
  target_recipient_account_last4 text default null,
  target_recipient_bank_name text default null
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
  task_row public.document_flow_destination_tasks;
  lineage_row public.transfer_slip_money_lineages;
  pair_row public.master_data_transfer_party_reviews;
  before_pair public.master_data_transfer_party_reviews;
  sender_bank_row public.master_bank_accounts;
  recipient_bank_row public.master_bank_accounts;
  prior_audit public.master_data_audit;
  advance_result jsonb;
  pair_event_key text;
  sender_name_value text;
  sender_account_value text;
  sender_bank_value text;
  recipient_name_value text;
  recipient_account_value text;
  recipient_bank_value text;
  sender_fingerprint text;
begin
  if nullif(btrim(target_event_key),'') is null then raise exception 'master_transfer_parties_event_key_required'; end if;
  if length(btrim(coalesce(target_reason,''))) < 3 then raise exception 'master_transfer_parties_reason_required'; end if;
  pair_event_key := btrim(target_event_key) || ':transfer-parties';

  select * into prior_audit from public.master_data_audit where event_key = pair_event_key;
  if prior_audit.id is not null then
    if prior_audit.candidate_id is distinct from target_candidate_id
       or prior_audit.action <> 'candidate_confirm_transfer_parties_advance_funding' then
      raise exception 'master_transfer_parties_event_key_conflict';
    end if;
    select * into result from public.master_data_candidates where id = target_candidate_id;
    select * into transaction_row from public.financial_transactions where id = result.source_id;
    select * into item_row from public.document_flow_items
      where source_message_id = transaction_row.source_message_id and company_id = result.company_id limit 1;
    select * into pair_row from public.master_data_transfer_party_reviews
      where company_id = result.company_id and transaction_id = transaction_row.id;
    select * into sender_bank_row from public.master_bank_accounts where id = pair_row.sender_master_bank_account_id;
    select * into recipient_bank_row from public.master_bank_accounts where id = pair_row.recipient_master_bank_account_id;
    select * into task_row from public.document_flow_destination_tasks
      where item_id = item_row.id and department = 'accounting';
    select * into lineage_row from public.transfer_slip_money_lineages where item_id = item_row.id;
    return jsonb_build_object(
      'candidate',to_jsonb(result),'party_review',to_jsonb(pair_row),
      'sender_bank_account',to_jsonb(sender_bank_row),'recipient_bank_account',to_jsonb(recipient_bank_row),
      'accounting_task',to_jsonb(task_row),'lineage',to_jsonb(lineage_row),
      'holder_match_status',result.candidate_data->>'advance_holder_match_status','replayed',true
    );
  end if;

  select * into source_row from public.master_data_candidates where id = target_candidate_id for update;
  if source_row.id is null or not public.is_company_manager(source_row.company_id) then
    raise exception 'master_transfer_parties_candidate_not_found_or_denied';
  end if;
  if source_row.entity_type <> 'bank_account'
     or source_row.source_table <> 'financial_transactions'
     or source_row.source_id is null then
    raise exception 'master_transfer_parties_financial_source_required';
  end if;

  select * into transaction_row from public.financial_transactions where id = source_row.source_id for update;
  if transaction_row.id is null or transaction_row.company_id <> source_row.company_id then
    raise exception 'master_transfer_parties_transaction_not_found';
  end if;
  if transaction_row.review_status in ('duplicate','dismissed') then
    raise exception 'master_transfer_parties_transaction_not_usable';
  end if;

  sender_name_value := coalesce(nullif(btrim(target_sender_name),''),nullif(btrim(transaction_row.sender_name),''));
  sender_account_value := public.normalize_master_data_account_last4(coalesce(target_sender_account_last4,transaction_row.sender_account_last4));
  sender_bank_value := coalesce(nullif(btrim(target_sender_bank_name),''),nullif(btrim(transaction_row.sender_bank_name),''));
  recipient_name_value := coalesce(nullif(btrim(target_recipient_name),''),nullif(btrim(transaction_row.recipient_name),''),nullif(btrim(source_row.display_name),''));
  recipient_account_value := public.normalize_master_data_account_last4(coalesce(target_recipient_account_last4,transaction_row.recipient_account_last4,source_row.candidate_data->>'account_last4'));
  recipient_bank_value := coalesce(nullif(btrim(target_recipient_bank_name),''),nullif(btrim(transaction_row.recipient_bank_name),''),nullif(btrim(source_row.candidate_data->>'bank_name'),''));

  if sender_name_value is null then raise exception 'master_transfer_parties_sender_name_required'; end if;
  if sender_account_value is null then raise exception 'master_transfer_parties_sender_account_last4_required'; end if;
  if recipient_name_value is null then raise exception 'master_transfer_parties_recipient_name_required'; end if;
  if recipient_account_value is null then raise exception 'master_transfer_parties_recipient_account_last4_required'; end if;

  select * into item_row from public.document_flow_items
    where source_message_id = transaction_row.source_message_id and company_id = source_row.company_id for update;
  if item_row.id is null then raise exception 'master_transfer_parties_document_flow_required'; end if;

  -- The existing command remains the canonical recipient/Accounting/Advance write.
  -- Calling it here keeps all writes in the same transaction, so a pair failure rolls everything back.
  advance_result := public.confirm_master_data_employee_advance_funding(
    target_candidate_id,target_event_key || ':advance',target_reason,
    recipient_name_value,recipient_account_value,recipient_bank_value
  );
  select * into result from public.master_data_candidates where id = target_candidate_id for update;
  select * into recipient_bank_row from public.master_bank_accounts
    where id = nullif(advance_result->'bank_account'->>'id','')::uuid;
  if recipient_bank_row.id is null then raise exception 'master_transfer_parties_recipient_master_missing'; end if;

  sender_fingerprint := md5(source_row.company_id::text || '|' || public.normalize_master_data_name(sender_name_value) || '|' || sender_account_value);
  insert into public.master_bank_accounts(
    company_id,owner_type,owner_name,normalized_owner_name,bank_name,account_last4,
    account_fingerprint,verification_status,evidence_source_table,evidence_source_id,
    verified_by,verified_at,created_by
  ) values (
    source_row.company_id,'other',sender_name_value,public.normalize_master_data_name(sender_name_value),
    sender_bank_value,sender_account_value,sender_fingerprint,'verified',source_row.source_table,
    source_row.source_id,auth.uid(),now(),auth.uid()
  ) on conflict (company_id,account_fingerprint)
      where account_fingerprint is not null and verification_status <> 'archived'
    do update set
      owner_type = 'other',owner_name = excluded.owner_name,
      normalized_owner_name = excluded.normalized_owner_name,
      bank_name = coalesce(excluded.bank_name,public.master_bank_accounts.bank_name),
      verification_status = 'verified',evidence_source_table = excluded.evidence_source_table,
      evidence_source_id = excluded.evidence_source_id,verified_by = auth.uid(),
      verified_at = now(),updated_at = now()
  returning * into sender_bank_row;

  select * into before_pair from public.master_data_transfer_party_reviews
    where company_id = source_row.company_id and transaction_id = transaction_row.id for update;

  insert into public.master_data_transfer_party_reviews as current_review(
    company_id,candidate_id,transaction_id,source_message_id,
    sender_name,sender_bank_name,sender_account_last4,sender_classification,
    sender_master_bank_account_id,sender_review_status,
    recipient_name,recipient_bank_name,recipient_account_last4,recipient_classification,
    recipient_master_bank_account_id,recipient_review_status,review_status,reason,
    last_event_key,reviewed_by,reviewed_at
  ) values (
    source_row.company_id,source_row.id,transaction_row.id,transaction_row.source_message_id,
    sender_name_value,sender_bank_value,sender_account_value,'company_internal',
    sender_bank_row.id,'confirmed',recipient_name_value,recipient_bank_value,
    recipient_account_value,'employee_technician',recipient_bank_row.id,'confirmed',
    'confirmed',btrim(target_reason),pair_event_key,auth.uid(),now()
  ) on conflict(company_id,transaction_id) do update set
    candidate_id = excluded.candidate_id,source_message_id = excluded.source_message_id,
    sender_name = excluded.sender_name,sender_bank_name = excluded.sender_bank_name,
    sender_account_last4 = excluded.sender_account_last4,
    sender_classification = 'company_internal',
    sender_master_bank_account_id = excluded.sender_master_bank_account_id,
    sender_review_status = 'confirmed',recipient_name = excluded.recipient_name,
    recipient_bank_name = excluded.recipient_bank_name,
    recipient_account_last4 = excluded.recipient_account_last4,
    recipient_classification = 'employee_technician',
    recipient_master_bank_account_id = excluded.recipient_master_bank_account_id,
    recipient_review_status = 'confirmed',review_status = 'confirmed',
    reason = excluded.reason,last_event_key = excluded.last_event_key,
    reviewed_by = auth.uid(),reviewed_at = now(),
    version = current_review.version + 1,updated_at = now()
  returning * into pair_row;

  update public.master_data_candidates set
    candidate_data = candidate_data || jsonb_build_object(
      'transfer_party_review_id',pair_row.id,'transfer_party_review_status','confirmed',
      'transfer_party_review_version',pair_row.version,
      'sender_name',sender_name_value,'sender_bank_name',sender_bank_value,
      'sender_account_last4',sender_account_value,'sender_classification','company_internal',
      'sender_master_bank_account_id',sender_bank_row.id,'sender_review_status','confirmed',
      'recipient_name',recipient_name_value,'recipient_bank_name',recipient_bank_value,
      'recipient_account_last4',recipient_account_value,'recipient_classification','employee_technician',
      'recipient_master_bank_account_id',recipient_bank_row.id,'recipient_review_status','confirmed',
      'transfer_party_reviewed_at',now(),'transfer_party_reviewed_by',auth.uid()
    ),updated_at = now()
  where id = source_row.id returning * into result;

  insert into public.master_data_audit(
    company_id,candidate_id,bank_account_id,event_key,action,actor_profile_id,
    before_data,after_data,reason
  ) values (
    result.company_id,result.id,recipient_bank_row.id,pair_event_key,
    'candidate_confirm_transfer_parties_advance_funding',auth.uid(),
    jsonb_build_object('candidate',to_jsonb(source_row),'party_review',to_jsonb(before_pair)),
    jsonb_build_object('candidate',to_jsonb(result),'party_review',to_jsonb(pair_row),
      'sender_bank_account_id',sender_bank_row.id,'recipient_bank_account_id',recipient_bank_row.id),
    btrim(target_reason)
  );

  insert into public.master_data_candidate_versions(
    company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by
  ) select result.company_id,result.id,coalesce(max(version_no),0)+1,result.status,
      to_jsonb(result) || jsonb_build_object('transfer_party_review',to_jsonb(pair_row)),
      result.source_table,result.source_id,pair_event_key,auth.uid()
    from public.master_data_candidate_versions where candidate_id = result.id;

  insert into public.document_flow_events(
    item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,
    from_room,to_room,note,payload,actor_id
  ) values (
    item_row.id,item_row.company_id,target_event_key || ':transfer-parties:document-flow',
    'master_data_transfer_parties_confirmed',item_row.current_flow,item_row.current_flow,
    item_row.state,item_row.state,item_row.current_room,item_row.current_room,btrim(target_reason),
    jsonb_build_object('candidate_id',result.id,'transaction_id',transaction_row.id,
      'party_review_id',pair_row.id,'sender_master_bank_account_id',sender_bank_row.id,
      'recipient_master_bank_account_id',recipient_bank_row.id,
      'sender_classification','company_internal','recipient_classification','employee_technician',
      'next_destination','accounting'),auth.uid()
  ) on conflict(event_key) do nothing;

  select * into task_row from public.document_flow_destination_tasks
    where item_id = item_row.id and department = 'accounting';
  select * into lineage_row from public.transfer_slip_money_lineages where item_id = item_row.id;

  return jsonb_build_object(
    'candidate',to_jsonb(result),'party_review',to_jsonb(pair_row),
    'sender_bank_account',to_jsonb(sender_bank_row),'recipient_bank_account',to_jsonb(recipient_bank_row),
    'accounting_task',to_jsonb(task_row),'lineage',to_jsonb(lineage_row),
    'holder_match_status',advance_result->>'holder_match_status','replayed',false
  );
end;
$$;

revoke all on function public.confirm_master_data_employee_advance_funding_v2(uuid,text,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.confirm_master_data_employee_advance_funding_v2(uuid,text,text,text,text,text,text,text,text) to authenticated;

comment on table public.master_data_transfer_party_reviews is
  'Current reviewed sender/recipient pair for one financial transaction. Raw transfer evidence remains canonical and immutable.';
comment on function public.confirm_master_data_employee_advance_funding_v2(uuid,text,text,text,text,text,text,text,text) is
  'Atomically confirms both transfer parties, reuses/creates their Master bank references, routes Accounting first and preserves the original source/audit chain.';

notify pgrst,'reload schema';

-- Rollback/recovery: revoke v2 RPC and deploy the prior UI. Retain pair reviews,
-- Master accounts, Candidate Versions, Audit and Document Flow events for recovery.
-- Never delete or overwrite Raw/OCR/financial source rows.
