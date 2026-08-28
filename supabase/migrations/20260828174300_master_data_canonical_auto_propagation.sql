-- Propagate confirmed Master Data to matching Candidate evidence without
-- mutating Raw/OCR, source documents, or financial transactions.

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
    when value in ('ttb','ttbbank','ทหารไทยธนชาต','ธนาคารทหารไทยธนชาต') then 'ttb'
    when value in ('gsb','governmentsavingsbank','ออมสิน','ธนาคารออมสิน') then 'gsb'
    when value in ('baac','ธกส','ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร') then 'baac'
    when value in ('promptpay','พร้อมเพย์') then 'promptpay'
    else value
  end
  from normalized
$$;

create or replace function public.apply_master_data_canonical_match(target_candidate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_row public.master_data_candidates;
  canonical_row public.master_data_candidates;
  result_row public.master_data_candidates;
  before_data jsonb;
  target_bank text;
  target_account text;
  canonical_count integer := 0;
  canonical_ids text;
  match_fingerprint text;
  audit_key text;
  conflict_reason text;
  rule_version constant text := 'master-data-canonical-exact-v1';
begin
  select * into target_row
  from public.master_data_candidates
  where id = target_candidate_id
  for update;

  if target_row.id is null then
    return jsonb_build_object('status', 'missing', 'candidate_id', target_candidate_id);
  end if;
  if target_row.status not in ('provisional','pending_review','auto_verified','needs_review','needs_more_info','admin_reviewed') then
    return jsonb_build_object('status', 'skipped', 'candidate_id', target_row.id, 'reason', 'candidate_not_open');
  end if;

  target_bank := public.normalize_master_data_bank(target_row.candidate_data->>'bank_name');
  target_account := public.normalize_master_data_account_last4(target_row.candidate_data->>'account_last4');
  if nullif(target_row.normalized_name, '') is null or target_bank is null or target_account is null then
    return jsonb_build_object('status', 'skipped', 'candidate_id', target_row.id, 'reason', 'exact_key_incomplete');
  end if;

  select count(*), string_agg(candidate.id::text, ',' order by candidate.id)
  into canonical_count, canonical_ids
  from public.master_data_candidates candidate
  where candidate.company_id = target_row.company_id
    and candidate.entity_type = target_row.entity_type
    and candidate.id <> target_row.id
    and candidate.status in ('confirmed','approved','locked')
    and candidate.normalized_name = target_row.normalized_name
    and public.normalize_master_data_bank(candidate.candidate_data->>'bank_name') = target_bank
    and public.normalize_master_data_account_last4(candidate.candidate_data->>'account_last4') = target_account;

  if canonical_count = 0 then
    return jsonb_build_object('status', 'skipped', 'candidate_id', target_row.id, 'reason', 'no_exact_canonical');
  end if;

  match_fingerprint := md5(concat_ws('|', target_row.company_id, target_row.entity_type,
    target_row.normalized_name, target_bank, target_account, canonical_ids, target_row.classification_type));

  if canonical_count > 1 then
    conflict_reason := 'พบ Canonical มากกว่า 1 รายการสำหรับชื่อ ธนาคาร และเลขท้ายบัญชีเดียวกัน';
  else
    select * into canonical_row
    from public.master_data_candidates candidate
    where candidate.id = canonical_ids::uuid;

    if target_row.classification_type <> 'unknown_review'
       and canonical_row.classification_type <> 'unknown_review'
       and target_row.classification_type <> canonical_row.classification_type then
      conflict_reason := 'ประเภทข้อมูลเดิมขัดแย้งกับ Canonical ที่จับคู่ได้';
    end if;
  end if;

  if conflict_reason is not null then
    if target_row.candidate_data->>'canonical_match_status' = 'conflict'
       and target_row.candidate_data->>'canonical_match_fingerprint' = match_fingerprint then
      return jsonb_build_object('status', 'conflict', 'candidate_id', target_row.id, 'replayed', true);
    end if;

    before_data := to_jsonb(target_row);
    update public.master_data_candidates
    set candidate_data = candidate_data || jsonb_build_object(
          'canonical_match_status', 'conflict',
          'canonical_match_reason', conflict_reason,
          'canonical_match_rule', 'company+normalized_name+normalized_bank+account_last4',
          'canonical_match_rule_version', rule_version,
          'canonical_match_confidence', 0,
          'canonical_match_fingerprint', match_fingerprint,
          'canonical_match_candidate_ids', string_to_array(canonical_ids, ','),
          'canonical_match_checked_at', now()
        ),
        updated_at = now()
    where id = target_row.id
    returning * into result_row;

    audit_key := 'master-canonical-conflict:' || target_row.id::text || ':' || match_fingerprint;
    insert into public.master_data_audit(
      company_id,candidate_id,event_key,action,actor_profile_id,before_data,after_data,reason
    ) values (
      result_row.company_id,result_row.id,audit_key,'candidate_canonical_match_conflict',null,
      before_data,to_jsonb(result_row),conflict_reason
    ) on conflict(event_key) do nothing;
    insert into public.master_data_candidate_versions(
      company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by
    ) values (
      result_row.company_id,result_row.id,
      (select coalesce(max(version.version_no),0)+1 from public.master_data_candidate_versions version where version.candidate_id=result_row.id),
      result_row.status,to_jsonb(result_row),result_row.source_table,result_row.source_id,audit_key,null
    );
    return jsonb_build_object('status', 'conflict', 'candidate_id', result_row.id, 'reason', conflict_reason, 'replayed', false);
  end if;

  before_data := to_jsonb(target_row);
  update public.master_data_candidates
  set display_name = canonical_row.display_name,
      normalized_name = canonical_row.normalized_name,
      status = 'archived',
      duplicate_of = canonical_row.id,
      classification_type = canonical_row.classification_type,
      classification_confidence = 1,
      classification_version = rule_version,
      review_reason = 'เชื่อม Canonical อัตโนมัติ: ชื่อ ธนาคาร และเลขท้ายบัญชีตรงครบ',
      reviewed_by = null,
      reviewed_at = now(),
      archived_at = now(),
      candidate_data = target_row.candidate_data || jsonb_build_object(
        'matched_master_id', canonical_row.id,
        'matched_master_type', canonical_row.classification_type,
        'canonical_candidate_id', canonical_row.id,
        'canonical_display_name', canonical_row.display_name,
        'canonical_bank_name', canonical_row.candidate_data->>'bank_name',
        'canonical_account_last4', public.normalize_master_data_account_last4(canonical_row.candidate_data->>'account_last4'),
        'canonical_match_status', 'linked',
        'canonical_match_reason', 'exact_name_bank_account_last4',
        'canonical_match_rule', 'company+normalized_name+normalized_bank+account_last4',
        'canonical_match_rule_version', rule_version,
        'canonical_match_confidence', 1,
        'canonical_match_fingerprint', match_fingerprint,
        'canonical_source_reviewed_at', canonical_row.reviewed_at,
        'canonical_source_reviewed_by', canonical_row.reviewed_by,
        'canonical_matched_at', now(),
        'canonical_auto_applied_by', 'system'
      ),
      updated_at = now()
  where id = target_row.id
  returning * into result_row;

  audit_key := 'master-canonical-link:' || canonical_row.id::text || ':' || result_row.id::text;
  insert into public.master_data_audit(
    company_id,candidate_id,event_key,action,actor_profile_id,before_data,after_data,reason
  ) values (
    result_row.company_id,result_row.id,audit_key,'candidate_canonical_auto_linked',null,
    before_data,to_jsonb(result_row),
    'จับคู่ด้วยชื่อมาตรฐาน ธนาคารมาตรฐาน และเลขท้ายบัญชีครบ โดยไม่แก้ Raw/OCR'
  ) on conflict(event_key) do nothing;
  insert into public.master_data_candidate_versions(
    company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by
  ) values (
    result_row.company_id,result_row.id,
    (select coalesce(max(version.version_no),0)+1 from public.master_data_candidate_versions version where version.candidate_id=result_row.id),
    result_row.status,to_jsonb(result_row),result_row.source_table,result_row.source_id,audit_key,null
  );

  return jsonb_build_object(
    'status', 'linked', 'candidate_id', result_row.id,
    'canonical_candidate_id', canonical_row.id, 'replayed', false
  );
end;
$$;

revoke all on function public.apply_master_data_canonical_match(uuid) from public,anon,authenticated;

create or replace function public.reprocess_master_data_canonical_matches(
  target_company_id uuid,
  target_limit integer default 500
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_row record;
  match_result jsonb;
  processed_count integer := 0;
  linked_count integer := 0;
  conflict_count integer := 0;
  skipped_count integer := 0;
begin
  if auth.uid() is null then raise exception 'master_candidate_not_authenticated'; end if;
  if target_company_id is null or not public.is_company_manager(target_company_id) then
    raise exception 'master_candidate_company_not_found_or_denied';
  end if;
  if target_limit < 1 or target_limit > 1000 then raise exception 'master_candidate_limit_invalid'; end if;

  for candidate_row in
    select candidate.id
    from public.master_data_candidates candidate
    where candidate.company_id = target_company_id
      and candidate.status in ('provisional','pending_review','auto_verified','needs_review','needs_more_info','admin_reviewed')
    order by candidate.created_at
    limit target_limit
  loop
    match_result := public.apply_master_data_canonical_match(candidate_row.id);
    processed_count := processed_count + 1;
    case match_result->>'status'
      when 'linked' then linked_count := linked_count + 1;
      when 'conflict' then conflict_count := conflict_count + 1;
      else skipped_count := skipped_count + 1;
    end case;
  end loop;

  return jsonb_build_object(
    'processed', processed_count,
    'linked', linked_count,
    'conflict', conflict_count,
    'skipped', skipped_count,
    'rule_version', 'master-data-canonical-exact-v1'
  );
end;
$$;

revoke all on function public.reprocess_master_data_canonical_matches(uuid,integer) from public,anon;
grant execute on function public.reprocess_master_data_canonical_matches(uuid,integer) to authenticated;

create or replace function public.auto_apply_master_data_canonical_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.status in ('provisional','pending_review','auto_verified','needs_review','needs_more_info','admin_reviewed') then
    perform public.apply_master_data_canonical_match(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.auto_apply_master_data_canonical_match() from public,anon,authenticated;

drop trigger if exists auto_apply_master_data_canonical_match_after_change on public.master_data_candidates;
create trigger auto_apply_master_data_canonical_match_after_change
after insert or update of display_name,normalized_name,candidate_data,status
on public.master_data_candidates
for each row execute function public.auto_apply_master_data_canonical_match();

notify pgrst, 'reload schema';
