-- Master Data Project-first Gate (Local-first; do not apply to Production until
-- contract, RLS, typecheck, lint, build and authenticated browser gates pass).
-- Raw/OCR/source rows are never updated. Admin actions append candidate version
-- and audit records, while this table keeps only the latest Project Candidate snapshot.

create table if not exists public.master_data_project_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_candidate_id uuid not null references public.master_data_candidates(id) on delete restrict,
  linked_project_id uuid references public.projects(id) on delete restrict,
  project_name text not null,
  customer_owner_name text not null,
  site_location text not null,
  responsible_name text not null,
  work_type text not null,
  approximate_start_date date not null,
  source_table text not null,
  source_id uuid not null,
  status text not null default 'awaiting_open_project'
    check (status in ('awaiting_open_project','confirmed_project_candidate','rejected','archived')),
  version_no integer not null default 1 check (version_no > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_candidate_id)
);

create index if not exists master_data_project_candidates_queue_idx
  on public.master_data_project_candidates(company_id,status,updated_at desc);

alter table public.master_data_project_candidates enable row level security;
drop policy if exists "Company managers read project candidates" on public.master_data_project_candidates;
create policy "Company managers read project candidates"
  on public.master_data_project_candidates for select to authenticated
  using ((select public.is_company_manager(company_id)));
revoke insert,update,delete on public.master_data_project_candidates from anon,authenticated;
grant select on public.master_data_project_candidates to authenticated;

create or replace function public.save_master_data_project_gate(
  target_candidate_id uuid,
  target_event_key text,
  target_action text,
  target_payload jsonb default '{}'::jsonb,
  target_reason text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  before_row public.master_data_candidates;
  result public.master_data_candidates;
  before_project public.master_data_project_candidates;
  project_result public.master_data_project_candidates;
  target_project public.projects;
  gate_status text;
  project_name text;
  customer_owner_name text;
  site_location text;
  responsible_name text;
  work_type text;
  approximate_start_date date;
begin
  if auth.uid() is null then raise exception 'master_candidate_not_authenticated'; end if;
  select * into before_row from public.master_data_candidates where id=target_candidate_id for update;
  if before_row.id is null or not public.is_company_manager(before_row.company_id) then
    raise exception 'master_candidate_not_found_or_denied';
  end if;
  if nullif(btrim(target_event_key),'') is null then raise exception 'master_candidate_event_key_required'; end if;
  if exists(select 1 from public.master_data_audit where event_key=target_event_key and candidate_id<>before_row.id) then
    raise exception 'master_candidate_event_key_conflict';
  end if;
  if exists(select 1 from public.master_data_audit where event_key=target_event_key and candidate_id=before_row.id) then
    return (
      select jsonb_build_object(
        'candidate',audit.after_data,
        'project_candidate',audit.after_data->'project_candidate',
        'replayed',true
      )
      from public.master_data_audit audit
      where audit.event_key=target_event_key and audit.candidate_id=before_row.id
      limit 1
    );
  end if;
  if nullif(btrim(target_reason),'') is null or length(btrim(target_reason)) < 3 then raise exception 'master_candidate_reason_required'; end if;
  if target_action not in ('link_existing_project','save_project_candidate','request_information','return_review') then
    raise exception 'master_candidate_project_action_invalid';
  end if;
  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then raise exception 'master_candidate_project_payload_invalid'; end if;

  if target_action='link_existing_project' then
    begin
      select * into target_project from public.projects
      where id=(target_payload->>'project_id')::uuid and company_id=before_row.company_id and status='active';
    exception when invalid_text_representation then
      raise exception 'master_candidate_project_invalid';
    end;
    if target_project.id is null then raise exception 'master_candidate_project_not_found_or_denied'; end if;
    gate_status:='linked_existing_project';
    update public.master_data_candidates set
      candidate_data=(candidate_data||jsonb_build_object(
        'project_gate_status',gate_status,
        'project_gate_resolution',gate_status,
        'project_id',target_project.id,
        'project_name',target_project.name,
        'project_match_evidence',coalesce(target_payload->'match_evidence','[]'::jsonb),
        'project_gate_updated_at',now(),
        'project_gate_updated_by',auth.uid()
      ))-'project_candidate_id',
      status=case when status='needs_more_info' then 'needs_review' else status end,
      review_reason=btrim(target_reason),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=before_row.id returning * into result;

  elsif target_action='save_project_candidate' then
    project_name:=nullif(btrim(target_payload->>'project_name'),'');
    customer_owner_name:=nullif(btrim(target_payload->>'customer_owner_name'),'');
    site_location:=nullif(btrim(target_payload->>'site_location'),'');
    responsible_name:=nullif(btrim(target_payload->>'responsible_name'),'');
    work_type:=nullif(btrim(target_payload->>'work_type'),'');
    if coalesce(target_payload->>'approximate_start_date','') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'master_candidate_project_start_date_required';
    end if;
    approximate_start_date:=(target_payload->>'approximate_start_date')::date;
    if project_name is null then raise exception 'master_candidate_project_name_required'; end if;
    if customer_owner_name is null then raise exception 'master_candidate_project_customer_required'; end if;
    if site_location is null then raise exception 'master_candidate_project_site_required'; end if;
    if responsible_name is null then raise exception 'master_candidate_project_responsible_required'; end if;
    if work_type is null then raise exception 'master_candidate_project_work_type_required'; end if;
    if before_row.source_table is null or before_row.source_id is null then raise exception 'master_candidate_source_required'; end if;

    select * into before_project from public.master_data_project_candidates
    where company_id=before_row.company_id and source_candidate_id=before_row.id for update;
    insert into public.master_data_project_candidates(
      company_id,source_candidate_id,project_name,customer_owner_name,site_location,responsible_name,work_type,
      approximate_start_date,source_table,source_id,status,version_no,created_by,updated_by
    ) values (
      before_row.company_id,before_row.id,project_name,customer_owner_name,site_location,responsible_name,work_type,
      approximate_start_date,before_row.source_table,before_row.source_id,'awaiting_open_project',1,auth.uid(),auth.uid()
    ) on conflict(company_id,source_candidate_id) do update set
      project_name=excluded.project_name,customer_owner_name=excluded.customer_owner_name,site_location=excluded.site_location,
      responsible_name=excluded.responsible_name,work_type=excluded.work_type,approximate_start_date=excluded.approximate_start_date,
      status='awaiting_open_project',version_no=public.master_data_project_candidates.version_no+1,
      updated_by=auth.uid(),updated_at=now()
    returning * into project_result;

    gate_status:='awaiting_new_project';
    update public.master_data_candidates set
      candidate_data=(candidate_data||jsonb_build_object(
        'project_gate_status',gate_status,
        'project_gate_resolution',gate_status,
        'project_candidate_id',project_result.id,
        'project_name',project_result.project_name,
        'customer_owner_name',project_result.customer_owner_name,
        'site_location',project_result.site_location,
        'responsible_name',project_result.responsible_name,
        'work_type',project_result.work_type,
        'approximate_start_date',project_result.approximate_start_date,
        'project_gate_updated_at',now(),
        'project_gate_updated_by',auth.uid()
      ))-'project_id',
      status=case when status='needs_more_info' then 'needs_review' else status end,
      review_reason=btrim(target_reason),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=before_row.id returning * into result;

  elsif target_action='request_information' then
    gate_status:='awaiting_information';
    update public.master_data_candidates set
      candidate_data=candidate_data||jsonb_build_object('project_gate_status',gate_status,'project_gate_updated_at',now(),'project_gate_updated_by',auth.uid()),
      status='needs_more_info',review_reason=btrim(target_reason),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=before_row.id returning * into result;
  else
    gate_status:='review';
    update public.master_data_candidates set
      candidate_data=candidate_data||jsonb_build_object('project_gate_status',gate_status,'project_gate_updated_at',now(),'project_gate_updated_by',auth.uid()),
      status='needs_review',review_reason=btrim(target_reason),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=before_row.id returning * into result;
  end if;

  insert into public.master_data_audit(company_id,candidate_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(
    result.company_id,result.id,target_event_key,'candidate_project_'||target_action,auth.uid(),to_jsonb(before_row),
    to_jsonb(result)||jsonb_build_object('project_candidate',case when project_result.id is null then null else to_jsonb(project_result) end),
    btrim(target_reason)
  );
  insert into public.master_data_candidate_versions(company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by)
  select result.company_id,result.id,coalesce(max(version_no),0)+1,result.status,
    to_jsonb(result)||jsonb_build_object('project_candidate',case when project_result.id is null then null else to_jsonb(project_result) end),
    result.source_table,result.source_id,target_event_key,auth.uid()
  from public.master_data_candidate_versions where candidate_id=result.id;

  return jsonb_build_object('candidate',to_jsonb(result),'project_candidate',case when project_result.id is null then null else to_jsonb(project_result) end);
end;
$$;

revoke all on function public.save_master_data_project_gate(uuid,text,text,jsonb,text) from public,anon;
grant execute on function public.save_master_data_project_gate(uuid,text,text,jsonb,text) to authenticated;

-- Confirmation/lock is blocked until an existing Project is linked or a complete
-- Project Candidate has been saved. Existing terminal records are not rewritten.
create or replace function public.enforce_master_data_project_first_gate()
returns trigger language plpgsql set search_path=public as $$
declare gate_status text;
begin
  if new.status in ('confirmed','approved','locked') and old.status not in ('confirmed','approved','locked') then
    gate_status:=coalesce(new.candidate_data->>'project_gate_status','received');
    if gate_status not in ('linked_existing_project','awaiting_new_project','confirmed') then
      raise exception 'master_candidate_project_gate_required';
    end if;
    new.candidate_data:=new.candidate_data||jsonb_build_object(
      'project_gate_resolution',gate_status,
      'project_gate_status','confirmed',
      'project_gate_confirmed_at',now(),
      'project_gate_confirmed_by',auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_master_data_project_first_gate on public.master_data_candidates;
create trigger enforce_master_data_project_first_gate
before update of status on public.master_data_candidates
for each row execute function public.enforce_master_data_project_first_gate();

-- Preserve a controlled Admin classification. The previous trigger ignored
-- candidate_data.classification_type and could overwrite a corrected type.
create or replace function public.classify_master_data_candidate_row()
returns trigger language plpgsql set search_path=public as $$
declare explicit_type text; evidence jsonb := '[]'::jsonb; conflicts jsonb := '[]'::jsonb; evidence_count integer := 0;
begin
  explicit_type := lower(coalesce(new.candidate_data->>'matched_master_type',new.candidate_data->>'master_entity_type',new.candidate_data->>'owner_type',new.candidate_data->>'classification_type',''));
  new.classification_type := case
    when explicit_type in ('vendor','supplier') or new.entity_type='vendor' then 'vendor'
    when explicit_type in ('employee','technician','worker','employee_technician') or new.entity_type='employee' then 'employee_technician'
    when explicit_type='customer' or new.entity_type='customer' then 'customer'
    when explicit_type in ('company','internal','company_internal','project','work_package') or new.entity_type in ('project','work_package') then 'company_internal'
    else 'unknown_review' end;
  if nullif(new.candidate_data->>'matched_master_id','') is not null or nullif(new.candidate_data->>'master_id','') is not null then evidence:=evidence||'"master_match"'::jsonb; evidence_count:=evidence_count+1; end if;
  if nullif(new.candidate_data->>'account_last4','') is not null then evidence:=evidence||'"bank_account"'::jsonb; evidence_count:=evidence_count+1; end if;
  if nullif(coalesce(new.candidate_data->>'tax_id',new.candidate_data->>'vendor_tax_id',new.candidate_data->>'customer_tax_id'),'') is not null then evidence:=evidence||'"tax_id"'::jsonb; evidence_count:=evidence_count+1; end if;
  if nullif(coalesce(new.candidate_data->>'project_id',new.candidate_data->>'site_id',new.candidate_data->>'project_name',new.candidate_data->>'site_name'),'') is not null then evidence:=evidence||'"project_site"'::jsonb; evidence_count:=evidence_count+1; end if;
  if nullif(coalesce(new.candidate_data->>'message_context',new.candidate_data->>'context_text',new.candidate_data->>'source_text'),'') is not null then evidence:=evidence||'"message_context"'::jsonb; evidence_count:=evidence_count+1; end if;
  if new.source_table is not null and new.source_id is not null then evidence:=evidence||'"source_reference"'::jsonb; evidence_count:=evidence_count+1; end if;
  if new.duplicate_of is not null then conflicts:=conflicts||'"duplicate_candidate"'::jsonb; end if;
  if jsonb_typeof(new.candidate_data->'conflict_flags')='array' then conflicts:=conflicts||(new.candidate_data->'conflict_flags'); end if;
  new.classification_evidence:=evidence; new.classification_conflicts:=conflicts;
  new.classification_confidence:=coalesce(new.confidence,0); new.classification_version:='master-data-rules-v2-project-gate'; new.classified_at:=now();
  if new.status in ('provisional','pending_review','needs_review') and new.classification_type<>'unknown_review'
    and new.classification_confidence>=0.95 and evidence_count>=2 and jsonb_array_length(conflicts)=0
  then new.status:='auto_verified'; end if;
  return new;
end;
$$;

notify pgrst,'reload schema';
