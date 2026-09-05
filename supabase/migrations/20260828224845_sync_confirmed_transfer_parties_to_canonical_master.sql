-- A confirmed transfer slip is authoritative evidence for party identity.
-- Master bank accounts remain the single canonical source; candidates remain
-- append-only evidence and are linked or flagged without mutating Raw/OCR.

create or replace function public.normalize_master_data_bank(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  with normalized as (
    select lower(regexp_replace(btrim(coalesce(value, '')), '[^[:alnum:]ก-๙]+', '', 'g')) as value
  )
  select case
    when value = '' then null
    when value in ('kbank','kasikorn','kasikornbank','กสิกรไทย','ธกสิกรไทย','ธนาคารกสิกรไทย') then 'kbank'
    when value in ('scb','siamcommercialbank','ไทยพาณิชย์','ธไทยพาณิชย์','ธนาคารไทยพาณิชย์') then 'scb'
    when value in ('ktb','krungthai','krungthaibank','กรุงไทย','ธกรุงไทย','ธนาคารกรุงไทย') then 'ktb'
    when value in ('bbl','bangkokbank','กรุงเทพ','ธกรุงเทพ','ธนาคารกรุงเทพ') then 'bbl'
    when value in ('bay','krungsri','bankofayudhya','กรุงศรี','กรุงศรีอยุธยา','ธนาคารกรุงศรีอยุธยา') then 'bay'
    when value in ('ttb','ttbbank','tmbthanachartbank','tmbthanachart','ทหารไทยธนชาต','ธนาคารทหารไทยธนชาต') then 'ttb'
    when value in ('gsb','governmentsavingsbank','ออมสิน','ธนาคารออมสิน') then 'gsb'
    when value in ('baac','ธกส','ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร') then 'baac'
    when value in ('promptpay','พร้อมเพย์') then 'promptpay'
    else value
  end
  from normalized
$$;

create or replace function public.sync_confirmed_transfer_party_to_canonical_master(
  target_lineage_id uuid,
  target_party_role text,
  target_name text,
  target_bank_name text,
  target_account_last4 text,
  target_actor_id uuid,
  target_confirmed_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lineage_row public.transfer_slip_money_lineages;
  transaction_row public.financial_transactions;
  canonical_row public.master_bank_accounts;
  candidate_row public.master_data_candidates;
  result_candidate public.master_data_candidates;
  normalized_name_value text;
  normalized_bank_value text;
  account_value text;
  fingerprint_value text;
  account_before jsonb;
  candidate_before jsonb;
  audit_key text;
  linked_count integer := 0;
  conflict_count integer := 0;
  rule_version constant text := 'confirmed-transfer-party-canonical-v1';
begin
  if target_party_role not in ('sender','recipient') then
    raise exception 'confirmed_transfer_party_role_invalid';
  end if;

  select * into lineage_row
  from public.transfer_slip_money_lineages
  where id = target_lineage_id;
  if lineage_row.id is null or lineage_row.confirmed_at is null
     or lineage_row.route_status not in ('routed','accounting_review','closed') then
    return jsonb_build_object('status','skipped','reason','lineage_not_confirmed');
  end if;

  select * into transaction_row
  from public.financial_transactions
  where id = lineage_row.transaction_id;
  if transaction_row.id is null or transaction_row.review_status in ('duplicate','dismissed') then
    return jsonb_build_object('status','skipped','reason','source_not_eligible');
  end if;

  normalized_name_value := public.normalize_master_data_name(target_name);
  normalized_bank_value := public.normalize_master_data_bank(target_bank_name);
  account_value := public.normalize_master_data_account_last4(target_account_last4);
  if nullif(normalized_name_value,'') is null or normalized_bank_value is null or account_value is null then
    return jsonb_build_object('status','skipped','reason','identity_key_incomplete');
  end if;

  fingerprint_value := md5(lineage_row.company_id::text || '|' || normalized_name_value || '|' || account_value);
  perform pg_advisory_xact_lock(hashtextextended(
    lineage_row.company_id::text || '|' || normalized_name_value || '|' || account_value, 0
  ));

  select * into canonical_row
  from public.master_bank_accounts account
  where account.company_id = lineage_row.company_id
    and account.account_fingerprint = fingerprint_value
    and account.verification_status <> 'archived'
  for update;

  if canonical_row.id is not null
     and public.normalize_master_data_bank(canonical_row.bank_name) is not null
     and public.normalize_master_data_bank(canonical_row.bank_name) <> normalized_bank_value then
    audit_key := 'confirmed-transfer-canonical-conflict:' || lineage_row.id::text || ':' || target_party_role;
    insert into public.master_data_audit(
      company_id,bank_account_id,event_key,action,actor_profile_id,before_data,after_data,reason
    ) values (
      lineage_row.company_id,canonical_row.id,audit_key,'confirmed_transfer_party_bank_conflict',target_actor_id,
      to_jsonb(canonical_row),
      jsonb_build_object('lineage_id',lineage_row.id,'transaction_id',transaction_row.id,
        'party_role',target_party_role,'confirmed_name',target_name,'confirmed_bank_name',target_bank_name,
        'confirmed_account_last4',account_value,'rule_version',rule_version),
      'ธนาคารจากสลิปยืนยันขัดแย้งกับ Canonical เดิม จึงไม่เขียนทับ'
    ) on conflict(event_key) do nothing;
    return jsonb_build_object('status','conflict','reason','canonical_bank_conflict','canonical_bank_account_id',canonical_row.id);
  end if;

  if canonical_row.id is null then
    insert into public.master_bank_accounts(
      company_id,owner_type,owner_name,normalized_owner_name,bank_name,account_last4,
      account_fingerprint,verification_status,evidence_source_table,evidence_source_id,
      verified_by,verified_at,created_by
    ) values (
      lineage_row.company_id,'other',btrim(target_name),normalized_name_value,btrim(target_bank_name),account_value,
      fingerprint_value,'verified','transfer_slip_money_lineages',lineage_row.id,
      target_actor_id,coalesce(target_confirmed_at,lineage_row.confirmed_at),target_actor_id
    ) returning * into canonical_row;
    account_before := null;
  else
    account_before := to_jsonb(canonical_row);
    update public.master_bank_accounts
    set owner_name = btrim(target_name),
        normalized_owner_name = normalized_name_value,
        bank_name = coalesce(nullif(btrim(target_bank_name),''),bank_name),
        verification_status = 'verified',
        evidence_source_table = 'transfer_slip_money_lineages',
        evidence_source_id = lineage_row.id,
        verified_by = target_actor_id,
        verified_at = coalesce(target_confirmed_at,lineage_row.confirmed_at),
        updated_at = now()
    where id = canonical_row.id
    returning * into canonical_row;
  end if;

  audit_key := 'confirmed-transfer-canonical:' || lineage_row.id::text || ':' || target_party_role;
  insert into public.master_data_audit(
    company_id,bank_account_id,event_key,action,actor_profile_id,before_data,after_data,reason
  ) values (
    lineage_row.company_id,canonical_row.id,audit_key,'confirmed_transfer_party_canonical_upserted',target_actor_id,
    account_before,to_jsonb(canonical_row) || jsonb_build_object(
      'lineage_id',lineage_row.id,'transaction_id',transaction_row.id,'party_role',target_party_role,
      'rule_version',rule_version,'source_immutable',true
    ),'Admin ยืนยันสลิปแล้ว จึงอัปเดตข้อมูลหลักโดยไม่แก้ Raw/OCR'
  ) on conflict(event_key) do nothing;

  for candidate_row in
    select * from public.master_data_candidates candidate
    where candidate.company_id = lineage_row.company_id
      and candidate.entity_type = 'bank_account'
      and candidate.normalized_name = normalized_name_value
      and public.normalize_master_data_account_last4(candidate.candidate_data->>'account_last4') = account_value
      and candidate.status in ('provisional','pending_review','auto_verified','needs_review','needs_more_info','admin_reviewed')
    order by candidate.created_at
    for update
  loop
    candidate_before := to_jsonb(candidate_row);
    if public.normalize_master_data_bank(candidate_row.candidate_data->>'bank_name') = normalized_bank_value then
      update public.master_data_candidates
      set status = 'archived',
          review_reason = 'เชื่อมข้อมูลหลักอัตโนมัติจากสลิปที่ Admin ยืนยันแล้ว',
          reviewed_by = target_actor_id,
          reviewed_at = coalesce(target_confirmed_at,lineage_row.confirmed_at),
          archived_at = now(),
          candidate_data = candidate_data || jsonb_build_object(
            'canonical_bank_account_id',canonical_row.id,
            'canonical_match_status','linked',
            'canonical_match_reason','admin_confirmed_transfer_exact_name_bank_account_last4',
            'canonical_match_rule','company+normalized_name+normalized_bank+account_last4',
            'canonical_match_rule_version',rule_version,
            'canonical_match_confidence',1,
            'canonical_source_lineage_id',lineage_row.id,
            'canonical_source_transaction_id',transaction_row.id,
            'canonical_source_confirmed_by',target_actor_id,
            'canonical_source_confirmed_at',coalesce(target_confirmed_at,lineage_row.confirmed_at),
            'canonical_auto_applied_by','system'
          ),
          updated_at = now()
      where id = candidate_row.id
      returning * into result_candidate;
      linked_count := linked_count + 1;
      audit_key := 'confirmed-transfer-candidate-link:' || canonical_row.id::text || ':' || candidate_row.id::text;
      insert into public.master_data_audit(
        company_id,candidate_id,bank_account_id,event_key,action,actor_profile_id,before_data,after_data,reason
      ) values (
        lineage_row.company_id,result_candidate.id,canonical_row.id,audit_key,
        'candidate_linked_to_confirmed_transfer_canonical',target_actor_id,
        candidate_before,to_jsonb(result_candidate),'Candidate เป็นหลักฐานของ Canonical เดียว ไม่สร้างข้อมูลหลักซ้ำ'
      ) on conflict(event_key) do nothing;
    else
      update public.master_data_candidates
      set candidate_data = candidate_data || jsonb_build_object(
            'canonical_bank_account_id',canonical_row.id,
            'canonical_match_status','conflict',
            'canonical_match_reason','same_name_and_account_last4_but_bank_conflicts_with_admin_confirmed_slip',
            'canonical_match_rule_version',rule_version,
            'canonical_source_lineage_id',lineage_row.id,
            'canonical_conflict_checked_at',now()
          ),
          updated_at = now()
      where id = candidate_row.id
      returning * into result_candidate;
      conflict_count := conflict_count + 1;
      audit_key := 'confirmed-transfer-candidate-conflict:' || canonical_row.id::text || ':' || candidate_row.id::text;
      insert into public.master_data_audit(
        company_id,candidate_id,bank_account_id,event_key,action,actor_profile_id,before_data,after_data,reason
      ) values (
        lineage_row.company_id,result_candidate.id,canonical_row.id,audit_key,
        'candidate_conflicts_with_confirmed_transfer_canonical',target_actor_id,
        candidate_before,to_jsonb(result_candidate),'ชื่อและเลขท้ายบัญชีตรง แต่ธนาคารขัดแย้ง จึงคงไว้รอตรวจ'
      ) on conflict(event_key) do nothing;
    end if;

    if not exists (
      select 1 from public.master_data_candidate_versions version
      where version.candidate_id = result_candidate.id and version.audit_event_key = audit_key
    ) then
      insert into public.master_data_candidate_versions(
        company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by
      ) select result_candidate.company_id,result_candidate.id,coalesce(max(version.version_no),0)+1,
          result_candidate.status,to_jsonb(result_candidate),result_candidate.source_table,result_candidate.source_id,
          audit_key,target_actor_id
        from public.master_data_candidate_versions version
        where version.candidate_id = result_candidate.id;
    end if;
  end loop;

  return jsonb_build_object(
    'status','canonical','canonical_bank_account_id',canonical_row.id,
    'linked_candidates',linked_count,'conflicting_candidates',conflict_count,'rule_version',rule_version
  );
end;
$$;

revoke all on function public.sync_confirmed_transfer_party_to_canonical_master(uuid,text,text,text,text,uuid,timestamptz)
  from public,anon,authenticated;

create or replace function public.sync_confirmed_transfer_parties_to_canonical_master()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare transaction_row public.financial_transactions;
begin
  if new.confirmed_at is null or new.route_status not in ('routed','accounting_review','closed') then return new; end if;
  select * into transaction_row from public.financial_transactions where id = new.transaction_id;
  if transaction_row.id is null or transaction_row.review_status in ('duplicate','dismissed') then return new; end if;

  perform public.sync_confirmed_transfer_party_to_canonical_master(
    new.id,'sender',transaction_row.sender_name,transaction_row.sender_bank_name,
    transaction_row.sender_account_last4,new.confirmed_by,new.confirmed_at
  );
  perform public.sync_confirmed_transfer_party_to_canonical_master(
    new.id,'recipient',transaction_row.recipient_name,transaction_row.recipient_bank_name,
    transaction_row.recipient_account_last4,new.confirmed_by,new.confirmed_at
  );
  return new;
end;
$$;

revoke all on function public.sync_confirmed_transfer_parties_to_canonical_master()
  from public,anon,authenticated;

drop trigger if exists sync_confirmed_transfer_parties_to_canonical_master_after_review
  on public.transfer_slip_money_lineages;
create trigger sync_confirmed_transfer_parties_to_canonical_master_after_review
after insert or update of confirmed_at,route_status
on public.transfer_slip_money_lineages
for each row execute function public.sync_confirmed_transfer_parties_to_canonical_master();

-- Idempotent backfill: only Admin-confirmed, non-duplicate source rows qualify.
do $$
declare lineage_row public.transfer_slip_money_lineages; transaction_row public.financial_transactions;
begin
  for lineage_row in
    select * from public.transfer_slip_money_lineages lineage
    where lineage.confirmed_at is not null
      and lineage.route_status in ('routed','accounting_review','closed')
    order by lineage.confirmed_at,lineage.id
  loop
    select * into transaction_row from public.financial_transactions where id = lineage_row.transaction_id;
    if transaction_row.id is not null and transaction_row.review_status not in ('duplicate','dismissed') then
      perform public.sync_confirmed_transfer_party_to_canonical_master(
        lineage_row.id,'sender',transaction_row.sender_name,transaction_row.sender_bank_name,
        transaction_row.sender_account_last4,lineage_row.confirmed_by,lineage_row.confirmed_at
      );
      perform public.sync_confirmed_transfer_party_to_canonical_master(
        lineage_row.id,'recipient',transaction_row.recipient_name,transaction_row.recipient_bank_name,
        transaction_row.recipient_account_last4,lineage_row.confirmed_by,lineage_row.confirmed_at
      );
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
