-- Master Data review v2.1: persist the selected Project work scope without
-- changing Raw/OCR evidence. This wrapper is idempotent and appends its own
-- audit/version after the existing Project-first RPC succeeds.

create or replace function public.save_master_data_project_gate_v3(
  target_candidate_id uuid,
  target_event_key text,
  target_action text,
  target_payload jsonb default '{}'::jsonb,
  target_reason text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  base_result jsonb;
  before_row public.master_data_candidates;
  result public.master_data_candidates;
  package_row public.project_work_packages;
  target_project_id uuid;
  scope_event_key text := target_event_key || ':work-scope';
  scope_data jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'master_candidate_not_authenticated'; end if;
  if nullif(btrim(target_event_key),'') is null then raise exception 'master_candidate_event_key_required'; end if;
  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then raise exception 'master_candidate_project_payload_invalid'; end if;

  select * into before_row from public.master_data_candidates where id=target_candidate_id for update;
  if before_row.id is null or not public.is_company_manager(before_row.company_id) then raise exception 'master_candidate_not_found_or_denied'; end if;

  if target_action='link_existing_project' then
    begin
      target_project_id := (target_payload->>'project_id')::uuid;
      select package.* into package_row
      from public.project_work_packages package
      join public.projects project on project.id=package.project_id
      where package.id=(target_payload->>'work_package_id')::uuid
        and package.project_id=target_project_id
        and package.status='active'
        and project.company_id=before_row.company_id
        and project.status='active';
    exception when invalid_text_representation then
      raise exception 'master_candidate_work_package_invalid';
    end;
    if package_row.id is null then raise exception 'master_candidate_work_package_required_or_denied'; end if;
    scope_data := jsonb_build_object(
      'work_package_id',package_row.id,
      'work_package_name',package_row.name,
      'work_package_code',package_row.code,
      'work_package_parent_id',package_row.parent_id
    );
  elsif target_action='save_project_candidate' then
    if nullif(btrim(target_payload->>'proposed_work_package_name'),'') is null then
      raise exception 'master_candidate_proposed_work_package_required';
    end if;
    scope_data := jsonb_build_object('proposed_work_package_name',btrim(target_payload->>'proposed_work_package_name'));
  end if;

  base_result := public.save_master_data_project_gate_v2(target_candidate_id,target_event_key,target_action,target_payload,target_reason);
  select * into result from public.master_data_candidates where id=target_candidate_id for update;

  if scope_data <> '{}'::jsonb and not exists(
    select 1 from public.master_data_audit where candidate_id=target_candidate_id and event_key=scope_event_key
  ) then
    before_row := result;
    update public.master_data_candidates
      set candidate_data=candidate_data||scope_data,
          updated_at=now()
      where id=target_candidate_id
      returning * into result;
    insert into public.master_data_audit(company_id,candidate_id,event_key,action,actor_profile_id,before_data,after_data,reason)
    values(result.company_id,result.id,scope_event_key,'candidate_project_work_scope_linked',auth.uid(),to_jsonb(before_row),to_jsonb(result),btrim(target_reason));
    insert into public.master_data_candidate_versions(company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by)
    select result.company_id,result.id,coalesce(max(version_no),0)+1,result.status,to_jsonb(result),result.source_table,result.source_id,scope_event_key,auth.uid()
    from public.master_data_candidate_versions where candidate_id=result.id;
  end if;

  return base_result||jsonb_build_object('candidate',to_jsonb(result),'work_scope',scope_data);
end;
$$;

revoke all on function public.save_master_data_project_gate_v3(uuid,text,text,jsonb,text) from public,anon;
grant execute on function public.save_master_data_project_gate_v3(uuid,text,text,jsonb,text) to authenticated;

notify pgrst,'reload schema';

-- Rollback: drop save_master_data_project_gate_v3(uuid,text,text,jsonb,text).
-- Existing candidate_data, audit and versions remain valid append-only evidence.
