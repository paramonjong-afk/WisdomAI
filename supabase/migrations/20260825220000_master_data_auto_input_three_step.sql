-- Master Data three-step review + audited Auto Input metadata (v1.8).
-- This migration is additive. Raw/OCR/source evidence is never updated, and
-- Project Candidate remains a request to open a Project rather than a Project.

alter table if exists public.master_data_project_candidates
  add column if not exists detected_start_date date,
  add column if not exists confirmed_start_date date,
  add column if not exists start_date_source jsonb not null default '{}'::jsonb,
  add column if not exists auto_fill_evidence jsonb not null default '{}'::jsonb;

update public.master_data_project_candidates
set detected_start_date=coalesce(detected_start_date,approximate_start_date),
    confirmed_start_date=coalesce(confirmed_start_date,approximate_start_date),
    start_date_source=case when start_date_source='{}'::jsonb then jsonb_build_object('label','ข้อมูลเดิมก่อน Auto Input v1') else start_date_source end
where detected_start_date is null or confirmed_start_date is null or start_date_source='{}'::jsonb;

create or replace function public.save_master_data_project_gate_v2(
  target_candidate_id uuid,
  target_event_key text,
  target_action text,
  target_payload jsonb default '{}'::jsonb,
  target_reason text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  base_result jsonb;
  candidate_row public.master_data_candidates;
  project_row public.master_data_project_candidates;
  detected_date date;
  confirmed_date date;
  start_source jsonb;
  auto_evidence jsonb;
  auto_event_key text;
begin
  if auth.uid() is null then raise exception 'master_candidate_not_authenticated'; end if;
  if target_payload is null or jsonb_typeof(target_payload)<>'object' then raise exception 'master_candidate_project_payload_invalid'; end if;
  base_result:=public.save_master_data_project_gate(target_candidate_id,target_event_key,target_action,target_payload,target_reason);
  if target_action<>'save_project_candidate' then return base_result; end if;

  if coalesce(base_result->>'replayed','false')='true' then
    select * into project_row from public.master_data_project_candidates where source_candidate_id=target_candidate_id;
    return base_result||jsonb_build_object('project_candidate',to_jsonb(project_row));
  end if;

  if coalesce(target_payload->>'detected_start_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'master_candidate_detected_start_date_required'; end if;
  if coalesce(target_payload->>'confirmed_start_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'master_candidate_confirmed_start_date_required'; end if;
  if target_payload?'start_date_source' and jsonb_typeof(target_payload->'start_date_source')<>'object' then raise exception 'master_candidate_start_date_source_invalid'; end if;
  if target_payload?'auto_fill_evidence' and jsonb_typeof(target_payload->'auto_fill_evidence')<>'object' then raise exception 'master_candidate_auto_fill_evidence_invalid'; end if;
  detected_date:=(target_payload->>'detected_start_date')::date;
  confirmed_date:=(target_payload->>'confirmed_start_date')::date;
  start_source:=coalesce(target_payload->'start_date_source','{}'::jsonb);
  auto_evidence:=coalesce(target_payload->'auto_fill_evidence','{}'::jsonb);

  select * into candidate_row from public.master_data_candidates where id=target_candidate_id for update;
  if candidate_row.id is null or not public.is_company_manager(candidate_row.company_id) then raise exception 'master_candidate_not_found_or_denied'; end if;
  update public.master_data_project_candidates
  set detected_start_date=detected_date,confirmed_start_date=confirmed_date,start_date_source=start_source,
      auto_fill_evidence=auto_evidence,updated_by=auth.uid(),updated_at=now()
  where company_id=candidate_row.company_id and source_candidate_id=candidate_row.id
  returning * into project_row;
  if project_row.id is null then raise exception 'master_candidate_project_candidate_missing'; end if;

  update public.master_data_candidates
  set candidate_data=candidate_data||jsonb_build_object(
    'detected_start_date',detected_date,'confirmed_start_date',confirmed_date,'start_date_source',start_source,
    'project_auto_fill_evidence',auto_evidence,'project_candidate_status',project_row.status
  ),updated_at=now()
  where id=candidate_row.id returning * into candidate_row;

  auto_event_key:=target_event_key||':auto-input';
  insert into public.master_data_audit(company_id,candidate_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(candidate_row.company_id,candidate_row.id,auto_event_key,'candidate_project_auto_input_recorded',auth.uid(),base_result->'candidate',
    to_jsonb(candidate_row)||jsonb_build_object('project_candidate',to_jsonb(project_row)),btrim(target_reason));
  insert into public.master_data_candidate_versions(company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by)
  select candidate_row.company_id,candidate_row.id,coalesce(max(version_no),0)+1,candidate_row.status,
    to_jsonb(candidate_row)||jsonb_build_object('project_candidate',to_jsonb(project_row)),candidate_row.source_table,candidate_row.source_id,auto_event_key,auth.uid()
  from public.master_data_candidate_versions where candidate_id=candidate_row.id;
  return jsonb_build_object('candidate',to_jsonb(candidate_row),'project_candidate',to_jsonb(project_row),'replayed',false);
end;
$$;

revoke all on function public.save_master_data_project_gate_v2(uuid,text,text,jsonb,text) from public,anon;
grant execute on function public.save_master_data_project_gate_v2(uuid,text,text,jsonb,text) to authenticated;

create or replace function public.correct_master_data_candidate_v2(
  target_candidate_id uuid,target_event_key text,target_correction jsonb,target_reason text
) returns public.master_data_candidates
language plpgsql security definer set search_path='' as $$
declare
  base_correction jsonb;
  auto_metadata jsonb;
  before_metadata public.master_data_candidates;
  result public.master_data_candidates;
  auto_event_key text;
begin
  if auth.uid() is null then raise exception 'master_candidate_not_authenticated'; end if;
  if target_correction is null or jsonb_typeof(target_correction)<>'object' then raise exception 'master_candidate_correction_invalid'; end if;
  if nullif(btrim(target_event_key),'') is null then raise exception 'master_candidate_event_key_required'; end if;
  select * into before_metadata from public.master_data_candidates where id=target_candidate_id for update;
  if before_metadata.id is null or not public.is_company_manager(before_metadata.company_id) then raise exception 'master_candidate_not_found_or_denied'; end if;
  if exists(select 1 from public.master_data_audit where event_key=target_event_key and candidate_id<>before_metadata.id) then
    raise exception 'master_candidate_event_key_conflict';
  end if;
  if exists(select 1 from public.master_data_audit where event_key=target_event_key and candidate_id=before_metadata.id) then
    return before_metadata;
  end if;
  if target_correction?'auto_fill_evidence' and jsonb_typeof(target_correction->'auto_fill_evidence')<>'object' then raise exception 'master_candidate_auto_fill_evidence_invalid'; end if;
  base_correction:=target_correction-array['auto_fill_evidence','suggested_destination','suggested_owner','suggested_next_action'];
  result:=public.correct_master_data_candidate(target_candidate_id,target_event_key,base_correction,target_reason);
  auto_metadata:=jsonb_strip_nulls(jsonb_build_object(
    'auto_fill_evidence',target_correction->'auto_fill_evidence',
    'suggested_destination',nullif(btrim(target_correction->>'suggested_destination'),''),
    'suggested_owner',nullif(btrim(target_correction->>'suggested_owner'),''),
    'suggested_next_action',nullif(btrim(target_correction->>'suggested_next_action'),'')
  ));
  if auto_metadata='{}'::jsonb then return result; end if;
  before_metadata:=result;
  update public.master_data_candidates
  set candidate_data=candidate_data||auto_metadata,updated_at=now()
  where id=result.id returning * into result;
  auto_event_key:=target_event_key||':auto-input';
  insert into public.master_data_audit(company_id,candidate_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(result.company_id,result.id,auto_event_key,'candidate_auto_input_recorded',auth.uid(),to_jsonb(before_metadata),to_jsonb(result),btrim(target_reason));
  insert into public.master_data_candidate_versions(company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by)
  select result.company_id,result.id,coalesce(max(version_no),0)+1,result.status,to_jsonb(result),result.source_table,result.source_id,auto_event_key,auth.uid()
  from public.master_data_candidate_versions where candidate_id=result.id;
  return result;
end;
$$;

revoke all on function public.correct_master_data_candidate_v2(uuid,text,jsonb,text) from public,anon;
grant execute on function public.correct_master_data_candidate_v2(uuid,text,jsonb,text) to authenticated;

notify pgrst,'reload schema';
