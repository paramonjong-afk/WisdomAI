-- A data-review status is intentionally separate from workflow state.  It tells
-- every room whether the values are safe to use, incomplete, edited, or rechecked.
alter table public.document_flow_items
  add column if not exists data_review_status text not null default 'complete'
    check (data_review_status in ('complete','incomplete','recheck_required','rechecked')),
  add column if not exists data_review_note text,
  add column if not exists data_review_changed_fields jsonb not null default '[]'::jsonb,
  add column if not exists data_reviewed_at timestamptz,
  add column if not exists data_reviewed_by uuid references public.profiles(id) on delete set null;

update public.document_flow_items
set data_review_status=case
  when coalesce(last_error,'')<>'' or cardinality(coalesce(issue_codes,'{}'::text[]))>0 then 'incomplete'
  else 'complete'
end
where data_review_status='complete';

alter table public.document_flow_destination_tasks
  drop constraint if exists document_flow_destination_tasks_status_check;
alter table public.document_flow_destination_tasks
  add constraint document_flow_destination_tasks_status_check
  check (status in ('queued','claimed','completed','returned','cancelled','recheck_required'));

create or replace function public.mark_document_flow_data_review(
  target_item_id uuid, target_expected_version integer, target_event_key text,
  target_status text, target_departments text[] default '{}', target_note text default null, target_changed_fields text[] default '{}'
) returns public.document_flow_items language plpgsql security definer set search_path=public as $$
declare before_row public.document_flow_items; result_row public.document_flow_items; affected_departments text[];
begin
  if coalesce(trim(target_event_key),'')='' then raise exception 'workflow_event_key_required'; end if;
  if target_status not in ('complete','incomplete','recheck_required','rechecked') then raise exception 'workflow_data_review_status_invalid'; end if;
  if target_status in ('incomplete','recheck_required') and coalesce(trim(target_note),'')='' then raise exception 'workflow_data_review_note_required'; end if;
  select item.* into before_row from public.document_flow_items item join public.document_flow_events event on event.item_id=item.id where event.event_key=target_event_key limit 1;
  if before_row.id is not null then return before_row; end if;
  select * into before_row from public.document_flow_items where id=target_item_id for update;
  if before_row.id is null then raise exception 'workflow_item_not_found'; end if;
  if before_row.company_id<>public.current_company_id() and not public.is_platform_admin() then raise exception 'workflow_permission_denied'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(before_row.company_id) then raise exception 'workflow_permission_denied'; end if;
  if before_row.version<>target_expected_version then raise exception 'workflow_version_conflict'; end if;
  affected_departments:=array(select distinct department from unnest(coalesce(target_departments,'{}'::text[])) department);
  if target_status='recheck_required' and cardinality(affected_departments)>0 then
    update public.document_flow_destination_tasks set status='recheck_required',assigned_to=null,completed_at=null,completed_by=null,version=version+1,updated_at=now()
    where item_id=before_row.id and department=any(affected_departments) and status<>'cancelled';
  end if;
  update public.document_flow_items set
    data_review_status=target_status,data_review_note=nullif(trim(target_note),''),data_review_changed_fields=to_jsonb(coalesce(target_changed_fields,'{}'::text[])),data_reviewed_at=now(),data_reviewed_by=auth.uid(),
    state=case when target_status='incomplete' then 'needs_correction' else state end,
    current_room=case when target_status='incomplete' then 'filter_correction_room' else current_room end,
    current_flow=case when target_status='incomplete' then 'filter' else current_flow end,
    version=version+1,updated_at=now()
  where id=before_row.id returning * into result_row;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(result_row.id,result_row.company_id,target_event_key,'data_review_'||target_status,before_row.current_flow,result_row.current_flow,before_row.state,result_row.state,before_row.current_room,result_row.current_room,target_note,jsonb_build_object('status',target_status,'departments',affected_departments,'changed_fields',target_changed_fields),auth.uid());
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
  if target_action='claim' and before_task.status not in ('queued','returned','recheck_required') then raise exception 'workflow_destination_claim_not_allowed'; end if;
  if target_action='complete' and before_task.status not in ('queued','claimed','recheck_required') then raise exception 'workflow_destination_complete_not_allowed'; end if;
  if target_action='return' and coalesce(trim(target_note),'')='' then raise exception 'workflow_note_required'; end if;
  update public.document_flow_destination_tasks set status=next_status,assigned_to=case when target_action='claim' then auth.uid() else assigned_to end,completed_at=case when target_action='complete' then now() else completed_at end,completed_by=case when target_action='complete' then auth.uid() else completed_by end,note=coalesce(nullif(trim(target_note),''),note),version=version+1,updated_at=now() where id=before_task.id returning * into result_task;
  select * into item_row from public.document_flow_items where id=before_task.item_id for update;
  if target_action='return' then
    update public.document_flow_items set current_flow='filter',state='needs_correction',current_room='filter_correction_room',assignment_status='returned',data_review_status='incomplete',data_review_note=coalesce(nullif(trim(target_note),''),data_review_note),data_reviewed_at=now(),data_reviewed_by=auth.uid(),version=version+1,updated_at=now() where id=item_row.id;
  elsif not exists(select 1 from public.document_flow_destination_tasks where item_id=item_row.id and required and status<>'completed') then
    update public.document_flow_items set state='awaiting_approval',current_room='posting_approval_room',assignment_status='completed',data_review_status=case when data_review_status='recheck_required' then 'rechecked' else data_review_status end,data_reviewed_at=case when data_review_status='recheck_required' then now() else data_reviewed_at end,data_reviewed_by=case when data_review_status='recheck_required' then auth.uid() else data_reviewed_by end,version=version+1,updated_at=now() where id=item_row.id;
  end if;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id) values(item_row.id,item_row.company_id,target_event_key,'destination_task_'||target_action,item_row.current_flow,item_row.current_flow,item_row.state,item_row.state,item_row.current_room,item_row.current_room,target_note,jsonb_build_object('task_id',before_task.id,'department',before_task.department,'required',before_task.required,'task_status',next_status),auth.uid());
  return result_task;
end; $$;

revoke all on function public.mark_document_flow_data_review(uuid,integer,text,text,text[],text,text[]),public.update_document_flow_destination_task(uuid,integer,text,text,text) from public,anon;
grant execute on function public.mark_document_flow_data_review(uuid,integer,text,text,text[],text,text[]),public.update_document_flow_destination_task(uuid,integer,text,text,text) to authenticated;
notify pgrst,'reload schema';
