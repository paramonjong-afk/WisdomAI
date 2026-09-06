-- Fix Master Data confirmation when OCR/candidate evidence contains a full
-- bank-account number. Raw/OCR evidence remains unchanged; only the derived
-- master account projection is normalized to the final four digits.

create or replace function public.normalize_master_data_account_last4(target_value text)
returns text
language sql
immutable
set search_path=public
as $$
  select case
    when length(regexp_replace(coalesce(target_value,''),'[^0-9]','','g')) >= 4
      then right(regexp_replace(target_value,'[^0-9]','','g'),4)
    else null
  end
$$;

revoke all on function public.normalize_master_data_account_last4(text) from public,anon,authenticated;
grant execute on function public.normalize_master_data_account_last4(text) to service_role;

create or replace function public.correct_master_data_candidate(
  target_candidate_id uuid,target_event_key text,target_correction jsonb,target_reason text
) returns public.master_data_candidates
language plpgsql security definer set search_path=public as $$
declare
  before_row public.master_data_candidates;
  result public.master_data_candidates;
  corrected_name text;
  corrected_type text;
  corrected_data jsonb;
  corrected_account_last4 text;
begin
  select * into before_row from public.master_data_candidates where id=target_candidate_id for update;
  if before_row.id is null or not public.is_company_manager(before_row.company_id) then raise exception 'master_candidate_not_found_or_denied'; end if;
  if nullif(btrim(target_reason),'') is null then raise exception 'master_candidate_reason_required'; end if;
  if target_correction is null or target_correction='{}'::jsonb or target_correction - array['display_name','classification_type','account_last4','bank_name','tax_id'] <> '{}'::jsonb then raise exception 'master_candidate_correction_invalid'; end if;
  corrected_name:=coalesce(nullif(btrim(target_correction->>'display_name'),''),before_row.display_name);
  corrected_type:=coalesce(nullif(target_correction->>'classification_type',''),before_row.classification_type);
  if corrected_type not in ('vendor','employee_technician','customer','company_internal','unknown_review') then raise exception 'master_candidate_classification_invalid'; end if;
  if nullif(btrim(target_correction->>'account_last4'),'') is not null then
    corrected_account_last4:=public.normalize_master_data_account_last4(target_correction->>'account_last4');
    if corrected_account_last4 is null then raise exception 'master_candidate_account_last4_invalid'; end if;
  end if;
  corrected_data:=before_row.candidate_data||jsonb_strip_nulls(jsonb_build_object(
    'classification_type',corrected_type,'account_last4',corrected_account_last4,'bank_name',nullif(btrim(target_correction->>'bank_name'),''),'tax_id',nullif(btrim(target_correction->>'tax_id'),''),
    'admin_corrected_at',now(),'admin_corrected_by',auth.uid(),'admin_correction_reason',btrim(target_reason)));
  update public.master_data_candidates set display_name=corrected_name,normalized_name=public.normalize_master_data_name(corrected_name),candidate_data=corrected_data,
    classification_type=corrected_type,status='admin_reviewed',review_reason=btrim(target_reason),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  where id=before_row.id returning * into result;
  insert into public.master_data_audit(company_id,candidate_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(result.company_id,result.id,target_event_key,'candidate_admin_corrected',auth.uid(),to_jsonb(before_row),to_jsonb(result),btrim(target_reason));
  insert into public.master_data_candidate_versions(company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by)
  select result.company_id,result.id,coalesce(max(version_no),0)+1,result.status,to_jsonb(result),result.source_table,result.source_id,target_event_key,auth.uid()
  from public.master_data_candidate_versions where candidate_id=result.id;
  return result;
end;
$$;

revoke all on function public.correct_master_data_candidate(uuid,text,jsonb,text) from public,anon;
grant execute on function public.correct_master_data_candidate(uuid,text,jsonb,text) to authenticated;

create or replace function public.review_master_data_candidate(
  target_candidate_id uuid,target_event_key text,target_action text,target_reason text default null
) returns public.master_data_candidates
language plpgsql security definer set search_path=public as $$
declare
  source_row public.master_data_candidates;
  result public.master_data_candidates;
  bank_row public.master_bank_accounts;
  resolved_owner_type text;
  resolved_account_last4 text;
begin
  select * into source_row from public.master_data_candidates where id=target_candidate_id for update;
  if source_row.id is null or not public.is_company_manager(source_row.company_id) then raise exception 'master_candidate_not_found_or_denied'; end if;
  if target_action not in ('approve','reject','archive','restore','keep_existing','match_master','request_info','lock','controlled_correction') then raise exception 'master_candidate_action_invalid'; end if;
  if target_action in ('approve','reject','keep_existing','match_master','request_info','lock','controlled_correction') and nullif(btrim(target_reason),'') is null then raise exception 'master_candidate_reason_required'; end if;
  if target_action in ('approve','lock') and (source_row.source_table is null or source_row.source_id is null) then raise exception 'master_candidate_source_required'; end if;
  if target_action='approve' and source_row.status not in ('provisional','pending_review','needs_review','needs_more_info','auto_verified','admin_reviewed') then raise exception 'master_candidate_not_reviewable'; end if;
  resolved_owner_type:=case source_row.classification_type when 'employee_technician' then 'employee' when 'vendor' then 'vendor' when 'customer' then 'customer' else 'other' end;
  if target_action in ('approve','match_master') and source_row.entity_type='bank_account' then
    resolved_account_last4:=public.normalize_master_data_account_last4(source_row.candidate_data->>'account_last4');
    if resolved_account_last4 is null then raise exception 'master_candidate_account_last4_invalid'; end if;
  end if;
  if target_action='approve' and source_row.entity_type='bank_account' then
    insert into public.master_bank_accounts(company_id,owner_type,owner_name,normalized_owner_name,bank_name,account_last4,verification_status,evidence_source_table,evidence_source_id,verified_by,verified_at,created_by)
    values(source_row.company_id,resolved_owner_type,source_row.display_name,source_row.normalized_name,source_row.candidate_data->>'bank_name',resolved_account_last4,'verified',source_row.source_table,source_row.source_id,auth.uid(),now(),auth.uid())
    on conflict do nothing returning * into bank_row;
  elsif target_action='match_master' and source_row.entity_type='bank_account' then
    select * into bank_row from public.master_bank_accounts account where account.company_id=source_row.company_id and account.verification_status<>'archived'
      and account.normalized_owner_name=source_row.normalized_name and account.account_last4=resolved_account_last4 order by account.updated_at desc limit 1;
    if bank_row.id is null then raise exception 'master_candidate_match_not_found'; end if;
  end if;
  update public.master_data_candidates set
    status=case target_action when 'approve' then 'confirmed' when 'match_master' then 'confirmed' when 'reject' then 'rejected' when 'keep_existing' then 'confirmed' when 'request_info' then 'needs_review' when 'lock' then 'locked' when 'controlled_correction' then 'needs_review' when 'archive' then 'archived' when 'restore' then 'needs_review' end,
    review_reason=nullif(btrim(target_reason),''),reviewed_by=auth.uid(),reviewed_at=now(),archived_at=case when target_action='archive' then now() else null end,updated_at=now()
  where id=source_row.id returning * into result;
  insert into public.master_data_audit(company_id,candidate_id,bank_account_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(result.company_id,result.id,bank_row.id,target_event_key,'candidate_'||target_action,auth.uid(),to_jsonb(source_row),to_jsonb(result),nullif(btrim(target_reason),''));
  insert into public.master_data_candidate_versions(company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by)
  select result.company_id,result.id,coalesce(max(version_no),0)+1,result.status,to_jsonb(result),result.source_table,result.source_id,target_event_key,auth.uid()
  from public.master_data_candidate_versions where candidate_id=result.id;
  return result;
end;
$$;

revoke all on function public.review_master_data_candidate(uuid,text,text,text) from public,anon;
grant execute on function public.review_master_data_candidate(uuid,text,text,text) to authenticated;

notify pgrst,'reload schema';
