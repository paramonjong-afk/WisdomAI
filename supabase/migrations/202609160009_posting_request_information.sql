-- POSTING-001: audited request-information hold and source-owner resubmission.
-- This migration changes workflow routing only. It never creates Accounting,
-- AP, Stock, purchase-order, or posting-operation rows.

alter table public.document_flow_items drop constraint if exists document_flow_items_state_check;
alter table public.document_flow_items add constraint document_flow_items_state_check check (state in (
  'received','ai_processing','awaiting_classification','validating','needs_correction',
  'duplicate_hold','ready_for_posting','awaiting_approval','information_requested',
  'approved_waiting_gateway','posting','posted','rejected','failed','dismissed','destination_in_progress'
));

alter table public.document_flow_items
  add column if not exists information_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists information_requested_at timestamptz,
  add column if not exists information_requested_by uuid references public.profiles(id) on delete set null;

drop policy if exists "Source owners read requested document flow items" on public.document_flow_items;
create policy "Source owners read requested document flow items" on public.document_flow_items
for select to authenticated using (
  company_id=public.current_company_id()
  and state='information_requested'
  and information_owner_id=auth.uid()
);

create or replace function public.transition_document_flow_item(
  target_item_id uuid, target_action text, target_expected_version integer,
  target_event_key text, target_note text default null
) returns public.document_flow_items
language plpgsql security definer set search_path=public as $$
declare before_row public.document_flow_items; result_row public.document_flow_items;
  replay_row public.document_flow_items; next_flow text; next_state text; next_room text;
  source_owner uuid;
begin
  if coalesce(trim(target_event_key),'')='' then raise exception 'workflow_event_key_required'; end if;
  select item.* into replay_row from public.document_flow_items item
  join public.document_flow_events event on event.item_id=item.id
  where event.event_key=target_event_key and item.id=target_item_id limit 1;
  if replay_row.id is not null then
    if not public.is_platform_admin() and not (
      replay_row.company_id=public.current_company_id()
      and (public.is_company_manager(replay_row.company_id) or replay_row.information_owner_id=auth.uid())
    ) then raise exception 'workflow_permission_denied'; end if;
    return replay_row;
  end if;
  select * into before_row from public.document_flow_items where id=target_item_id for update;
  if before_row.id is null then raise exception 'workflow_item_not_found'; end if;
  if before_row.company_id<>public.current_company_id() and not public.is_platform_admin() then raise exception 'workflow_permission_denied'; end if;
  if target_action='resubmit_information' then
    if not public.is_platform_admin() and before_row.information_owner_id is distinct from auth.uid() then raise exception 'workflow_information_owner_required'; end if;
  elsif not public.is_platform_admin() and not public.is_company_manager(before_row.company_id) then
    raise exception 'workflow_permission_denied';
  end if;
  if before_row.version<>target_expected_version then raise exception 'workflow_version_conflict'; end if;
  next_flow:=before_row.current_flow; next_state:=before_row.state; next_room:=before_row.current_room;
  case target_action
    when 'route_filter' then
      if before_row.current_flow<>'intake' or cardinality(coalesce(before_row.issue_codes,'{}'::text[]))>0
        or before_row.duplicate_state='duplicate' or before_row.state='duplicate_hold' then raise exception 'workflow_intake_quality_not_passed'; end if;
      next_flow:='filter'; next_state:='validating'; next_room:='filter_'||coalesce(before_row.route_target,'document_reference');
    when 'request_classification' then next_flow:='intake'; next_state:='awaiting_classification'; next_room:='intake_manual_review';
    when 'request_correction' then if before_row.current_flow not in ('filter','posting') then raise exception 'workflow_transition_not_allowed'; end if; next_flow:='filter'; next_state:='needs_correction'; next_room:='filter_correction_room';
    when 'ready_posting' then if before_row.current_flow<>'filter' or before_row.accounting_document_id is null or not exists(select 1 from public.accounting_documents where id=before_row.accounting_document_id and status='confirmed') then raise exception 'workflow_document_not_confirmed'; end if; next_flow:='posting'; next_state:='awaiting_approval'; next_room:='posting_approval_room';
    when 'approve' then if before_row.current_flow<>'posting' or before_row.state<>'awaiting_approval' then raise exception 'workflow_transition_not_allowed'; end if; next_state:='approved_waiting_gateway'; next_room:='posting_gateway_queue';
    when 'request_information' then
      if before_row.current_flow<>'posting' or before_row.state<>'awaiting_approval' then raise exception 'workflow_transition_not_allowed'; end if;
      if coalesce(trim(target_note),'')='' then raise exception 'workflow_reason_required'; end if;
      select coalesce(document.created_by,before_row.assigned_to) into source_owner
      from public.accounting_documents document where document.id=before_row.accounting_document_id and document.company_id=before_row.company_id;
      if source_owner is null then raise exception 'workflow_information_owner_missing'; end if;
      next_state:='information_requested'; next_room:='posting_source_information_room';
    when 'resubmit_information' then
      if before_row.current_flow<>'posting' or before_row.state<>'information_requested' then raise exception 'workflow_transition_not_allowed'; end if;
      if coalesce(trim(target_note),'')='' then raise exception 'workflow_reason_required'; end if;
      next_state:='awaiting_approval'; next_room:='posting_approval_room';
    when 'reject' then if before_row.current_flow not in ('filter','posting') then raise exception 'workflow_transition_not_allowed'; end if; next_state:='rejected'; next_room:=before_row.current_flow||'_rejected_room';
    when 'retry' then if before_row.state not in ('failed','rejected') then raise exception 'workflow_transition_not_allowed'; end if; if before_row.current_flow='posting' then next_state:='awaiting_approval'; next_room:='posting_approval_room'; else next_flow:='filter'; next_state:='validating'; next_room:='filter_'||coalesce(before_row.route_target,'document_reference'); end if;
    when 'dead_letter' then if before_row.state='dismissed' then raise exception 'workflow_transition_not_allowed'; end if; next_state:='dismissed'; next_room:='intake_dead_letter_room';
    when 'recover' then if before_row.state<>'dismissed' then raise exception 'workflow_transition_not_allowed'; end if; next_flow:='intake'; next_state:='awaiting_classification'; next_room:='intake_manual_review';
    else raise exception 'workflow_action_unknown';
  end case;
  update public.document_flow_items set current_flow=next_flow,state=next_state,current_room=next_room,
    approved_by=case when target_action='approve' then auth.uid() else approved_by end,
    approved_at=case when target_action='approve' then now() else approved_at end,
    information_owner_id=case when target_action='request_information' then source_owner when target_action='resubmit_information' then null else information_owner_id end,
    information_requested_at=case when target_action='request_information' then now() when target_action='resubmit_information' then null else information_requested_at end,
    information_requested_by=case when target_action='request_information' then auth.uid() when target_action='resubmit_information' then null else information_requested_by end,
    last_error=case when target_action in ('retry','recover') then null else last_error end,version=version+1,updated_at=now()
  where id=before_row.id returning * into result_row;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(result_row.id,result_row.company_id,target_event_key,target_action,before_row.current_flow,result_row.current_flow,before_row.state,result_row.state,before_row.current_room,result_row.current_room,target_note,
    jsonb_build_object('expected_version',target_expected_version,'result_version',result_row.version,'information_owner_id',case when target_action='request_information' then source_owner else before_row.information_owner_id end,'owner_action_path','/document-flows/source-information?document_view=task_types','posting_side_effects',false),auth.uid());
  return result_row;
end;
$$;

revoke all on function public.transition_document_flow_item(uuid,text,integer,text,text) from public,anon;
grant execute on function public.transition_document_flow_item(uuid,text,integer,text,text) to authenticated;

-- Keep the held item visible to its source owner even when that user is not a
-- manager. All other rows still use the existing department/sensitivity gate.
create or replace function public.document_flow_queue_page_for_flow(
  target_limit integer default 100, target_before_updated_at timestamptz default null,
  target_before_id uuid default null, target_flow text default null,
  target_channel text default null, target_received_from timestamptz default null,
  target_received_to timestamptz default null, target_room text default null,
  target_sender text default null, target_file_kind text default null,
  target_project text default null
) returns jsonb language sql stable security definer set search_path=public as $$
  with p as (select public.current_company_id() company_id), a as (
    select i.*, pr.name project_name, m.occurred_at source_received_at_fallback
    from public.document_flow_items i join p on p.company_id=i.company_id
    left join public.projects pr on pr.id=i.project_id
    left join public.line_messages m on m.id=i.source_message_id
    where (public.can_read_document_flow_item(i.company_id,i.target_department,i.candidate_departments,i.sensitivity)
      or (i.state='information_requested' and i.information_owner_id=auth.uid()))
      and (target_channel is null or target_channel='all' or i.source_channel=target_channel)
      and (target_received_from is null or coalesce(i.source_received_at,m.occurred_at)>=target_received_from)
      and (target_received_to is null or coalesce(i.source_received_at,m.occurred_at)<=target_received_to)
      and (target_room is null or target_room='' or i.source_room_name ilike ('%'||target_room||'%'))
      and (target_sender is null or target_sender='' or i.source_sender_name ilike ('%'||target_sender||'%'))
      and (target_file_kind is null or target_file_kind='all' or i.source_file_kind=target_file_kind)
      and (target_project is null or target_project='' or coalesce(pr.name,'') ilike ('%'||target_project||'%'))
  ), b as (
    select * from a where (target_flow is null or current_flow=target_flow)
      and (target_before_updated_at is null or (updated_at,id)<(target_before_updated_at,target_before_id))
    order by updated_at desc,id desc limit greatest(1,least(coalesce(target_limit,100),100))
  ), c as (
    select count(*) filter(where current_flow='intake')::int intake_total,
      count(*) filter(where current_flow='filter')::int filter_total,
      count(*) filter(where current_flow='posting')::int posting_total from a
  ), h as (
    select count(*)::int total from public.employee_intakes e join p on e.company_id=p.company_id
    where e.status not in ('approved','cancelled')
      and (target_channel is null or target_channel='all' or e.channel=target_channel)
      and (target_received_from is null or e.source_started_at>=target_received_from)
      and (target_received_to is null or e.source_started_at<=target_received_to)
      and (target_room is null or target_room='' or coalesce(e.external_chat_id,'') ilike ('%'||target_room||'%'))
      and (target_sender is null or target_sender='' or coalesce(e.external_user_id,'') ilike ('%'||target_sender||'%'))
      and (target_file_kind is null or target_file_kind='all' or target_file_kind in ('document','unknown'))
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(b)) from b),'[]'::jsonb),
    'counts',jsonb_build_object('intake',(select intake_total+total from c cross join h),'filter',(select filter_total from c),'posting',(select posting_total from c)),
    'next_cursor',(select jsonb_build_object('updated_at',updated_at,'id',id) from b order by updated_at asc,id asc limit 1));
$$;

revoke all on function public.document_flow_queue_page_for_flow(integer,timestamptz,uuid,text,text,timestamptz,timestamptz,text,text,text,text) from public,anon;
grant execute on function public.document_flow_queue_page_for_flow(integer,timestamptz,uuid,text,text,timestamptz,timestamptz,text,text,text,text) to authenticated;

comment on constraint document_flow_items_state_check on public.document_flow_items is
  'Valid central Document Flow states, including active multi-destination work and an open source-owner information hold.';
notify pgrst, 'reload schema';
