-- Atomically persist an Admin correction and confirm the resulting Master Data (v3.7).
-- Raw/OCR/source evidence remains immutable; only the derived candidate and
-- confirmed Master projection are changed.

create or replace function public.correct_and_confirm_master_data_candidate(
  target_candidate_id uuid,
  target_event_key text,
  target_correction jsonb,
  target_reason text
) returns public.master_data_candidates
language plpgsql
security definer
set search_path=''
as $$
declare
  before_row public.master_data_candidates;
  corrected_row public.master_data_candidates;
  result public.master_data_candidates;
  correction_event_key text;
  confirmation_event_key text;
  gate_status text;
  corrected_name text;
  corrected_type text;
begin
  if auth.uid() is null then raise exception 'master_candidate_not_authenticated'; end if;
  if nullif(btrim(target_event_key),'') is null then raise exception 'master_candidate_event_key_required'; end if;
  if nullif(btrim(target_reason),'') is null then raise exception 'master_candidate_reason_required'; end if;
  if target_correction is null or jsonb_typeof(target_correction)<>'object' then raise exception 'master_candidate_correction_invalid'; end if;

  correction_event_key:=target_event_key||':correction';
  confirmation_event_key:=target_event_key||':confirmation';

  select * into before_row
  from public.master_data_candidates
  where id=target_candidate_id
  for update;

  if before_row.id is null or not public.is_company_manager(before_row.company_id) then
    raise exception 'master_candidate_not_found_or_denied';
  end if;
  if exists(
    select 1 from public.master_data_audit
    where event_key in (target_event_key,correction_event_key,confirmation_event_key)
      and candidate_id<>before_row.id
  ) then raise exception 'master_candidate_event_key_conflict'; end if;
  if exists(select 1 from public.master_data_audit where candidate_id=before_row.id and event_key=target_event_key) then
    return before_row;
  end if;

  gate_status:=coalesce(before_row.candidate_data->>'project_gate_status','received');
  if gate_status not in ('linked_existing_project','awaiting_new_project','confirmed') then
    raise exception 'master_candidate_project_gate_required';
  end if;
  if before_row.source_table is null or before_row.source_id is null then
    raise exception 'master_candidate_source_required';
  end if;

  corrected_name:=coalesce(nullif(btrim(target_correction->>'display_name'),''),before_row.display_name);
  corrected_type:=coalesce(nullif(btrim(target_correction->>'classification_type'),''),before_row.classification_type);
  if nullif(btrim(corrected_name),'') is null then raise exception 'master_candidate_display_name_required'; end if;
  if corrected_type not in ('vendor','employee_technician','customer','company_internal') then
    raise exception 'master_candidate_classification_required';
  end if;

  corrected_row:=public.correct_master_data_candidate_v2(
    target_candidate_id,
    correction_event_key,
    target_correction,
    target_reason
  );
  result:=public.review_master_data_candidate(
    target_candidate_id,
    confirmation_event_key,
    'approve',
    target_reason
  );

  update public.master_data_candidates
  set candidate_data=candidate_data||jsonb_build_object(
        'master_data_effective_source','admin_correct_and_confirm',
        'master_data_effective_at',now(),
        'master_data_effective_by',auth.uid(),
        'master_data_effective_event_key',target_event_key
      ),
      updated_at=now()
  where id=result.id
  returning * into result;

  insert into public.master_data_audit(
    company_id,candidate_id,event_key,action,actor_profile_id,before_data,after_data,reason
  ) values (
    result.company_id,result.id,target_event_key,'candidate_correct_and_confirm',auth.uid(),
    to_jsonb(before_row),to_jsonb(result),btrim(target_reason)
  );
  insert into public.master_data_candidate_versions(
    company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by
  )
  select result.company_id,result.id,coalesce(max(version_no),0)+1,result.status,to_jsonb(result),
    result.source_table,result.source_id,target_event_key,auth.uid()
  from public.master_data_candidate_versions
  where candidate_id=result.id;

  return result;
end;
$$;

revoke all on function public.correct_and_confirm_master_data_candidate(uuid,text,jsonb,text) from public,anon;
grant execute on function public.correct_and_confirm_master_data_candidate(uuid,text,jsonb,text) to authenticated;

notify pgrst,'reload schema';
