-- One document may create independent work for several departments without
-- duplicating the source file, Intake ID, or accounting document.
create table if not exists public.document_flow_destination_tasks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.document_flow_items(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  department text not null check (department in ('accounting','procurement','inventory','hr','project','admin')),
  required boolean not null default true,
  status text not null default 'queued' check (status in ('queued','claimed','completed','returned','cancelled')),
  assigned_to uuid references public.profiles(id) on delete set null,
  note text,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(item_id, department)
);
create index if not exists document_flow_destination_tasks_queue_idx on public.document_flow_destination_tasks(company_id,department,status,updated_at desc);

alter table public.document_flow_destination_tasks enable row level security;
create policy "Department members read destination tasks" on public.document_flow_destination_tasks for select to authenticated using (
  company_id=public.current_company_id() and public.is_document_flow_department_member(company_id,department)
);
create policy "Managers manage destination tasks" on public.document_flow_destination_tasks for all to authenticated using (
  company_id=public.current_company_id() and (public.is_platform_admin() or public.is_company_manager(company_id))
) with check (company_id=public.current_company_id() and (public.is_platform_admin() or public.is_company_manager(company_id)));

create or replace function public.route_document_flow_multi_destination(
  target_item_id uuid, target_expected_version integer, target_event_key text,
  target_document_type text, target_departments text[], target_required_departments text[] default '{}', target_note text default null
) returns public.document_flow_items language plpgsql security definer set search_path=public as $$
declare before_row public.document_flow_items; result_row public.document_flow_items; department_name text; is_required boolean;
  valid_departments constant text[]:=array['accounting','procurement','inventory','hr','project','admin'];
begin
  if coalesce(trim(target_event_key),'')='' then raise exception 'workflow_event_key_required'; end if;
  if cardinality(target_departments)=0 then raise exception 'workflow_destination_required'; end if;
  if exists(select 1 from unnest(target_departments) value where not (value=any(valid_departments))) then raise exception 'workflow_destination_invalid'; end if;
  if exists(select 1 from unnest(target_required_departments) value where not (value=any(target_departments))) then raise exception 'workflow_required_destination_mismatch'; end if;
  select item.* into before_row from public.document_flow_items item join public.document_flow_events event on event.item_id=item.id where event.event_key=target_event_key limit 1;
  if before_row.id is not null then return before_row; end if;
  select * into before_row from public.document_flow_items where id=target_item_id for update;
  if before_row.id is null then raise exception 'workflow_item_not_found'; end if;
  if before_row.company_id<>public.current_company_id() and not public.is_platform_admin() then raise exception 'workflow_permission_denied'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(before_row.company_id) then raise exception 'workflow_permission_denied'; end if;
  if before_row.version<>target_expected_version then raise exception 'workflow_version_conflict'; end if;
  if before_row.current_flow<>'filter' then raise exception 'workflow_transition_not_allowed'; end if;
  foreach department_name in array target_departments loop
    is_required:=department_name=any(target_required_departments);
    insert into public.document_flow_destination_tasks(item_id,company_id,department,required,status,note)
    values(before_row.id,before_row.company_id,department_name,is_required,'queued',nullif(trim(target_note),''))
    on conflict(item_id,department) do update set required=excluded.required,note=excluded.note,updated_at=now()
      where public.document_flow_destination_tasks.status in ('queued','returned','cancelled');
  end loop;
  update public.document_flow_items set current_flow='posting',state='destination_in_progress',current_room='destination_multi_queue',document_type=coalesce(nullif(trim(target_document_type),''),document_type),target_department=target_departments[1],candidate_departments=target_departments,assignment_status='unassigned',sensitivity=case when 'hr'=any(target_departments) then 'restricted_hr' else sensitivity end,classification_note=coalesce(nullif(trim(target_note),''),classification_note),version=version+1,updated_at=now() where id=before_row.id returning * into result_row;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id) values(result_row.id,result_row.company_id,target_event_key,'classify_and_route_multi',before_row.current_flow,result_row.current_flow,before_row.state,result_row.state,before_row.current_room,result_row.current_room,target_note,jsonb_build_object('expected_version',target_expected_version,'result_version',result_row.version,'departments',target_departments,'required_departments',target_required_departments),auth.uid());
  return result_row;
end; $$;

create or replace function public.update_document_flow_destination_task(
  target_task_id uuid, target_expected_version integer, target_action text, target_event_key text, target_note text default null
) returns public.document_flow_destination_tasks language plpgsql security definer set search_path=public as $$
declare before_task public.document_flow_destination_tasks; result_task public.document_flow_destination_tasks; item_row public.document_flow_items; next_status text;
begin
  if coalesce(trim(target_event_key),'')='' then raise exception 'workflow_event_key_required'; end if;
  select * into before_task from public.document_flow_destination_tasks where id=target_task_id for update;
  if not found then raise exception 'workflow_destination_task_not_found'; end if;
  if before_task.company_id<>public.current_company_id() and not public.is_platform_admin() then raise exception 'workflow_permission_denied'; end if;
  if not public.is_document_flow_department_member(before_task.company_id,before_task.department) then raise exception 'workflow_department_permission_denied'; end if;
  if before_task.version<>target_expected_version then raise exception 'workflow_version_conflict'; end if;
  next_status:=case target_action when 'claim' then 'claimed' when 'complete' then 'completed' when 'return' then 'returned' when 'cancel' then 'cancelled' else null end;
  if next_status is null then raise exception 'workflow_destination_action_unknown'; end if;
  if target_action='claim' and before_task.status not in ('queued','returned') then raise exception 'workflow_destination_claim_not_allowed'; end if;
  if target_action='complete' and before_task.status not in ('queued','claimed') then raise exception 'workflow_destination_complete_not_allowed'; end if;
  if target_action='return' and coalesce(trim(target_note),'')='' then raise exception 'workflow_note_required'; end if;
  update public.document_flow_destination_tasks set status=next_status,assigned_to=case when target_action='claim' then auth.uid() else assigned_to end,completed_at=case when target_action='complete' then now() else completed_at end,completed_by=case when target_action='complete' then auth.uid() else completed_by end,note=coalesce(nullif(trim(target_note),''),note),version=version+1,updated_at=now() where id=before_task.id returning * into result_task;
  select * into item_row from public.document_flow_items where id=before_task.item_id for update;
  if target_action='return' then
    update public.document_flow_items set current_flow='filter',state='needs_correction',current_room='filter_correction_room',assignment_status='returned',version=version+1,updated_at=now() where id=item_row.id;
  elsif not exists(select 1 from public.document_flow_destination_tasks where item_id=item_row.id and required and status<>'completed') then
    update public.document_flow_items set state='awaiting_approval',current_room='posting_approval_room',assignment_status='completed',version=version+1,updated_at=now() where id=item_row.id;
  end if;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id) values(item_row.id,item_row.company_id,target_event_key,'destination_task_'||target_action,item_row.current_flow,item_row.current_flow,item_row.state,item_row.state,item_row.current_room,item_row.current_room,target_note,jsonb_build_object('task_id',before_task.id,'department',before_task.department,'required',before_task.required,'task_status',next_status),auth.uid());
  return result_task;
end; $$;

revoke all on function public.route_document_flow_multi_destination(uuid,integer,text,text,text[],text[],text),public.update_document_flow_destination_task(uuid,integer,text,text,text) from public,anon;
grant execute on function public.route_document_flow_multi_destination(uuid,integer,text,text,text[],text[],text),public.update_document_flow_destination_task(uuid,integer,text,text,text) to authenticated;
notify pgrst,'reload schema';
