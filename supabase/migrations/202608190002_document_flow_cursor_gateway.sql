-- Scalable read gateway for Document Flow.  Browser clients receive one cursor page
-- with source names already resolved; they must not build huge `id=in.(...)` URLs.

create index if not exists document_flow_items_company_updated_cursor_idx
  on public.document_flow_items(company_id, updated_at desc, id desc);
create index if not exists document_flow_events_item_created_idx
  on public.document_flow_events(item_id, created_at desc);

create or replace function public.document_flow_queue_page(
  target_limit integer default 100,
  target_before_updated_at timestamptz default null,
  target_before_id uuid default null
) returns jsonb
language sql stable security definer set search_path=public as $$
  with permitted as (
    select public.current_company_id() as company_id
  ), base as (
    select
      item.id, item.intake_id, item.review_case_id, item.accounting_document_id,
      item.source_message_id, item.current_flow, item.current_room, item.state,
      item.route_target, item.document_type, item.vendor_name, item.confidence,
      item.issue_codes, item.last_error, item.total_amount, item.auto_routed, item.version,
      item.created_at, item.updated_at, project.name as project_name,
      message.occurred_at as source_received_at,
      coalesce(group_row.display_name, case when message.line_group_id is not null then 'กลุ่ม LINE' end) as source_group,
      coalesce(sender.display_name, message.line_user_id, 'ไม่ทราบผู้ส่ง') as source_sender
    from public.document_flow_items item
    join permitted p on (public.is_platform_admin() or item.company_id=p.company_id)
    left join public.projects project on project.id=item.project_id
    left join public.line_messages message on message.id=item.source_message_id
    left join public.line_groups group_row on group_row.line_group_id=message.line_group_id
    left join public.line_senders sender on sender.line_user_id=message.line_user_id
    where target_before_updated_at is null
       or (item.updated_at, item.id) < (target_before_updated_at, target_before_id)
    order by item.updated_at desc, item.id desc
    limit greatest(1, least(coalesce(target_limit,100), 100))
  ), counts as (
    select count(*)::integer as document_total,
      count(*) filter(where current_flow='filter')::integer as filter_total,
      count(*) filter(where current_flow='posting')::integer as posting_total
    from public.document_flow_items item join permitted p on (public.is_platform_admin() or item.company_id=p.company_id)
  ), hr as (
    select count(*)::integer as total from public.employee_intakes intake join permitted p on (public.is_platform_admin() or intake.company_id=p.company_id)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'intake_id',intake_id,'review_case_id',review_case_id,'accounting_document_id',accounting_document_id,
      'source_message_id',source_message_id,'current_flow',current_flow,'current_room',current_room,'state',state,
      'route_target',route_target,'document_type',document_type,'vendor_name',vendor_name,'confidence',confidence,
      'issue_codes',issue_codes,'last_error',last_error,'total_amount',total_amount,'auto_routed',auto_routed,'version',version,'created_at',created_at,'updated_at',updated_at,
      'projects', case when project_name is null then null else jsonb_build_object('name',project_name) end,
      'source_received_at',source_received_at,'source_entry_point',concat_ws(' / ',source_group,source_sender)
    )) from base),'[]'::jsonb),
    'counts', jsonb_build_object('intake',(select document_total+total from counts cross join hr),'filter',(select filter_total from counts),'posting',(select posting_total from counts)),
    'next_cursor', (select jsonb_build_object('updated_at',updated_at,'id',id) from base order by updated_at asc,id asc limit 1)
  );
$$;

revoke all on function public.document_flow_queue_page(integer,timestamptz,uuid) from public, anon;
grant execute on function public.document_flow_queue_page(integer,timestamptz,uuid) to authenticated;
