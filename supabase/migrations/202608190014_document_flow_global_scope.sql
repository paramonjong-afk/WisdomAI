-- One source-of-truth scope for the Document Flow Center.
-- The received-at timestamp belongs to the source message, never to a later workflow transition.
create or replace function public.document_flow_queue_page_for_flow(
  target_limit integer default 100,
  target_before_updated_at timestamptz default null,
  target_before_id uuid default null,
  target_flow text default null,
  target_channel text default null,
  target_received_from timestamptz default null,
  target_received_to timestamptz default null,
  target_room text default null,
  target_sender text default null,
  target_file_kind text default null,
  target_project text default null
) returns jsonb language sql stable security definer set search_path=public as $$
  with p as (select public.current_company_id() company_id), a as (
    select i.*, pr.name project_name, m.occurred_at source_received_at_fallback
    from public.document_flow_items i
    join p on p.company_id=i.company_id
    left join public.projects pr on pr.id=i.project_id
    left join public.line_messages m on m.id=i.source_message_id
    where public.can_read_document_flow_item(i.company_id,i.target_department,i.candidate_departments,i.sensitivity)
      and (target_channel is null or target_channel='all' or i.source_channel=target_channel)
      and (target_received_from is null or coalesce(i.source_received_at,m.occurred_at)>=target_received_from)
      and (target_received_to is null or coalesce(i.source_received_at,m.occurred_at)<=target_received_to)
      and (target_room is null or target_room='' or i.source_room_name ilike ('%'||target_room||'%'))
      and (target_sender is null or target_sender='' or i.source_sender_name ilike ('%'||target_sender||'%'))
      and (target_file_kind is null or target_file_kind='all' or i.source_file_kind=target_file_kind)
      and (target_project is null or target_project='' or coalesce(pr.name,'') ilike ('%'||target_project||'%'))
  ), b as (
    select * from a
    where (target_flow is null or current_flow=target_flow)
      and (target_before_updated_at is null or (updated_at,id)<(target_before_updated_at,target_before_id))
    order by updated_at desc,id desc
    limit greatest(1,least(coalesce(target_limit,100),100))
  ), c as (
    select count(*) filter(where current_flow='intake')::int intake_total,
      count(*) filter(where current_flow='filter')::int filter_total,
      count(*) filter(where current_flow='posting')::int posting_total from a
  ), h as (
    select count(*)::int total from public.employee_intakes e join p on e.company_id=p.company_id
    where (target_channel is null or target_channel='all' or e.channel=target_channel)
      and (target_received_from is null or e.source_started_at>=target_received_from)
      and (target_received_to is null or e.source_started_at<=target_received_to)
      and (target_room is null or target_room='' or coalesce(e.external_chat_id,'') ilike ('%'||target_room||'%'))
      and (target_sender is null or target_sender='' or coalesce(e.external_user_id,'') ilike ('%'||target_sender||'%'))
      and (target_file_kind is null or target_file_kind='all' or target_file_kind in ('document','unknown'))
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(b)) from b),'[]'::jsonb),
    'counts',jsonb_build_object('intake',(select intake_total+total from c cross join h),'filter',(select filter_total from c),'posting',(select posting_total from c)),
    'next_cursor',(select jsonb_build_object('updated_at',updated_at,'id',id) from b order by updated_at asc,id asc limit 1)
  );
$$;
revoke all on function public.document_flow_queue_page_for_flow(integer,timestamptz,uuid,text,text,timestamptz,timestamptz,text,text,text,text) from public,anon;
grant execute on function public.document_flow_queue_page_for_flow(integer,timestamptz,uuid,text,text,timestamptz,timestamptz,text,text,text,text) to authenticated;

create or replace function public.document_flow_queue_facets(
  target_channel text default null,
  target_received_from timestamptz default null,
  target_received_to timestamptz default null,
  target_room text default null,
  target_sender text default null,
  target_file_kind text default null,
  target_project text default null
) returns jsonb language sql stable security definer set search_path=public as $$
  with a as (
    select item.* from public.document_flow_items item
    left join public.projects project_row on project_row.id=item.project_id
    left join public.line_messages message on message.id=item.source_message_id
    where item.company_id=public.current_company_id()
      and public.can_read_document_flow_item(item.company_id,item.target_department,item.candidate_departments,item.sensitivity)
      and (target_channel is null or target_channel='all' or item.source_channel=target_channel)
      and (target_received_from is null or coalesce(item.source_received_at,message.occurred_at)>=target_received_from)
      and (target_received_to is null or coalesce(item.source_received_at,message.occurred_at)<=target_received_to)
      and (target_room is null or target_room='' or item.source_room_name ilike ('%'||target_room||'%'))
      and (target_sender is null or target_sender='' or item.source_sender_name ilike ('%'||target_sender||'%'))
      and (target_file_kind is null or target_file_kind='all' or item.source_file_kind=target_file_kind)
      and (target_project is null or target_project='' or coalesce(project_row.name,'') ilike ('%'||target_project||'%'))
  )
  select jsonb_build_object(
    'intake',jsonb_build_object('all',(select count(*) from a where current_flow='intake'),'admin',(select count(*) from a where current_flow='intake' and current_room like '%manual%'),'quality',(select count(*) from a where current_flow='intake' and (quality_state in ('low_quality','unreadable') or cardinality(issue_codes)>0)),'duplicate',(select count(*) from a where current_flow='intake' and (duplicate_state='duplicate' or state='duplicate_hold')),'failed',(select count(*) from a where current_flow='intake' and state in ('failed','rejected'))),
    'filter',jsonb_build_object('all',(select count(*) from a where current_flow='filter'),'classifying',(select count(*) from a where current_flow='filter' and state='validating'),'admin',(select count(*) from a where current_flow='filter' and (state='needs_correction' or cardinality(issue_codes)>0 or coalesce(confidence,1)<.9)),'ready',(select count(*) from a where current_flow='filter' and state='ready_for_posting'),'failed',(select count(*) from a where current_flow='filter' and state in ('failed','rejected'))),
    'department',jsonb_build_object('all',(select count(*) from a where current_flow='posting'),'accounting',(select count(*) from a where current_flow='posting' and target_department='accounting'),'procurement',(select count(*) from a where current_flow='posting' and target_department='procurement'),'inventory',(select count(*) from a where current_flow='posting' and target_department='inventory'),'hr',(select count(*) from a where current_flow='posting' and target_department='hr'),'project',(select count(*) from a where current_flow='posting' and target_department='project'),'reference',(select count(*) from a where current_flow='posting' and target_department='admin'))
  );
$$;
revoke all on function public.document_flow_queue_facets(text,timestamptz,timestamptz,text,text,text,text) from public,anon;
grant execute on function public.document_flow_queue_facets(text,timestamptz,timestamptz,text,text,text,text) to authenticated;

create index if not exists document_flow_items_global_scope_idx
  on public.document_flow_items(company_id,source_channel,source_received_at desc,current_flow,updated_at desc);
