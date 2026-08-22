-- Keep Intake as the quality gate and return all queue metadata through the
-- central cursor gateway.  Client pages must never assemble large REST filters.

create or replace function public.document_flow_defaults_before_write()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.target_department:=coalesce(new.target_department,public.document_flow_department_for_route(new.route_target));
  if coalesce(cardinality(new.candidate_departments),0)=0 then
    new.candidate_departments:=array[new.target_department];
  end if;
  if new.target_department='hr' then new.sensitivity:='restricted_hr'; end if;
  return new;
end;
$$;

drop trigger if exists document_flow_defaults_before_write on public.document_flow_items;
create trigger document_flow_defaults_before_write
before insert or update on public.document_flow_items
for each row execute function public.document_flow_defaults_before_write();

create or replace function public.transition_document_flow_item(
  target_item_id uuid, target_action text, target_expected_version integer,
  target_event_key text, target_note text default null
) returns public.document_flow_items
language plpgsql security definer set search_path=public as $$
declare before_row public.document_flow_items; result_row public.document_flow_items;
  next_flow text; next_state text; next_room text;
begin
  if coalesce(trim(target_event_key),'')='' then raise exception 'workflow_event_key_required'; end if;
  select item.* into before_row from public.document_flow_items item join public.document_flow_events event on event.item_id=item.id
  where event.event_key=target_event_key limit 1;
  if before_row.id is not null then return before_row; end if;
  select * into before_row from public.document_flow_items where id=target_item_id for update;
  if before_row.id is null then raise exception 'workflow_item_not_found'; end if;
  if not public.is_platform_admin() and not (before_row.company_id=public.current_company_id() and public.is_company_manager(before_row.company_id)) then raise exception 'workflow_permission_denied'; end if;
  if before_row.version<>target_expected_version then raise exception 'workflow_version_conflict'; end if;
  next_flow:=before_row.current_flow; next_state:=before_row.state; next_room:=before_row.current_room;
  case target_action
    when 'route_filter' then
      if before_row.current_flow<>'intake'
        or cardinality(coalesce(before_row.issue_codes,'{}'::text[]))>0
        or before_row.duplicate_state='duplicate'
        or before_row.state='duplicate_hold' then raise exception 'workflow_intake_quality_not_passed'; end if;
      next_flow:='filter'; next_state:='validating'; next_room:='filter_'||coalesce(before_row.route_target,'document_reference');
    when 'request_classification' then next_flow:='intake'; next_state:='awaiting_classification'; next_room:='intake_manual_review';
    when 'request_correction' then if before_row.current_flow not in ('filter','posting') then raise exception 'workflow_transition_not_allowed'; end if; next_flow:='filter'; next_state:='needs_correction'; next_room:='filter_correction_room';
    when 'ready_posting' then if before_row.current_flow<>'filter' or before_row.accounting_document_id is null or not exists(select 1 from public.accounting_documents where id=before_row.accounting_document_id and status='confirmed') then raise exception 'workflow_document_not_confirmed'; end if; next_flow:='posting'; next_state:='awaiting_approval'; next_room:='posting_approval_room';
    when 'approve' then if before_row.current_flow<>'posting' or before_row.state<>'awaiting_approval' then raise exception 'workflow_transition_not_allowed'; end if; next_state:='approved_waiting_gateway'; next_room:='posting_gateway_queue';
    when 'reject' then if before_row.current_flow not in ('filter','posting') then raise exception 'workflow_transition_not_allowed'; end if; next_state:='rejected'; next_room:=before_row.current_flow||'_rejected_room';
    when 'retry' then if before_row.state not in ('failed','rejected') then raise exception 'workflow_transition_not_allowed'; end if; if before_row.current_flow='posting' then next_state:='awaiting_approval'; next_room:='posting_approval_room'; else next_flow:='filter'; next_state:='validating'; next_room:='filter_'||coalesce(before_row.route_target,'document_reference'); end if;
    when 'dead_letter' then if before_row.state='dismissed' then raise exception 'workflow_transition_not_allowed'; end if; next_state:='dismissed'; next_room:='intake_dead_letter_room';
    when 'recover' then if before_row.state<>'dismissed' then raise exception 'workflow_transition_not_allowed'; end if; next_flow:='intake'; next_state:='awaiting_classification'; next_room:='intake_manual_review';
    else raise exception 'workflow_action_unknown';
  end case;
  update public.document_flow_items set current_flow=next_flow,state=next_state,current_room=next_room,
    approved_by=case when target_action='approve' then auth.uid() else approved_by end,approved_at=case when target_action='approve' then now() else approved_at end,
    last_error=case when target_action in ('retry','recover') then null else last_error end,version=version+1,updated_at=now()
  where id=before_row.id returning * into result_row;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(result_row.id,result_row.company_id,target_event_key,target_action,before_row.current_flow,result_row.current_flow,before_row.state,result_row.state,before_row.current_room,result_row.current_room,target_note,jsonb_build_object('expected_version',target_expected_version,'result_version',result_row.version),auth.uid());
  return result_row;
end;
$$;

create or replace function public.document_flow_queue_page(
  target_limit integer default 100,
  target_before_updated_at timestamptz default null,
  target_before_id uuid default null
) returns jsonb
language sql stable security definer set search_path=public as $$
  with permitted as (
    select public.current_company_id() as company_id
  ), accessible as (
    select item.*, project.name as project_name,
      message.occurred_at as source_received_at,
      coalesce(group_row.display_name,case when message.line_group_id is not null then 'กลุ่ม LINE' end,'ไม่ระบุเส้นทาง') as source_group,
      coalesce(sender.display_name,message.line_user_id,'ไม่ทราบผู้ส่ง') as source_sender,
      case when item.review_case_id is not null then 'รูปภาพ/สแกน' else 'เอกสาร' end as source_file_kind
    from public.document_flow_items item
    join permitted p on item.company_id=p.company_id
    left join public.projects project on project.id=item.project_id
    left join public.line_messages message on message.id=item.source_message_id
    left join public.line_groups group_row on group_row.line_group_id=message.line_group_id
    left join public.line_senders sender on sender.line_user_id=message.line_user_id
    where public.can_read_document_flow_item(item.company_id,item.target_department,item.candidate_departments,item.sensitivity)
  ), base as (
    select * from accessible
    where target_before_updated_at is null or (updated_at,id)<(target_before_updated_at,target_before_id)
    order by updated_at desc,id desc limit greatest(1,least(coalesce(target_limit,100),100))
  ), counts as (
    select count(*) filter(where current_flow='intake')::integer as intake_total,
      count(*) filter(where current_flow='filter')::integer as filter_total,
      count(*) filter(where current_flow='posting')::integer as posting_total
    from accessible
  ), facets as (
    select jsonb_build_object(
      'filter',jsonb_build_object('all',count(*) filter(where current_flow='filter'),'classifying',count(*) filter(where current_flow='filter' and state='validating'),'admin',count(*) filter(where current_flow='filter' and (state='needs_correction' or cardinality(issue_codes)>0 or coalesce(confidence,1)<.9)),'ready',count(*) filter(where current_flow='filter' and state='ready_for_posting'),'failed',count(*) filter(where current_flow='filter' and state in ('failed','rejected'))),
      'department',jsonb_build_object('all',count(*) filter(where current_flow='posting'),'accounting',count(*) filter(where current_flow='posting' and target_department='accounting'),'procurement',count(*) filter(where current_flow='posting' and target_department='procurement'),'inventory',count(*) filter(where current_flow='posting' and target_department='inventory'),'hr',count(*) filter(where current_flow='posting' and target_department='hr'),'project',count(*) filter(where current_flow='posting' and target_department='project'),'reference',count(*) filter(where current_flow='posting' and target_department='admin'))
    ) as value from accessible
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'intake_id',intake_id,'review_case_id',review_case_id,'accounting_document_id',accounting_document_id,'source_message_id',source_message_id,
      'current_flow',current_flow,'current_room',current_room,'state',state,'route_target',route_target,'document_type',document_type,'vendor_name',vendor_name,'confidence',confidence,'issue_codes',issue_codes,'last_error',last_error,'total_amount',total_amount,'auto_routed',auto_routed,'version',version,'created_at',created_at,'updated_at',updated_at,
      'target_department',target_department,'candidate_departments',candidate_departments,'assignment_status',assignment_status,'sensitivity',sensitivity,'classification_note',classification_note,
      'projects',case when project_name is null then null else jsonb_build_object('name',project_name) end,
      'source_received_at',source_received_at,'source_group',source_group,'source_sender',source_sender,'source_file_kind',source_file_kind,'source_entry_point',concat_ws(' / ',source_group,source_sender)
    )) from base),'[]'::jsonb),
    'counts',jsonb_build_object('intake',(select intake_total from counts),'filter',(select filter_total from counts),'posting',(select posting_total from counts)),
    'facets',(select value from facets),
    'next_cursor',(select jsonb_build_object('updated_at',updated_at,'id',id) from base order by updated_at asc,id asc limit 1)
  );
$$;

revoke all on function public.document_flow_queue_page(integer,timestamptz,uuid) from public,anon;
grant execute on function public.document_flow_queue_page(integer,timestamptz,uuid) to authenticated;
