-- A tab must page its own queue in the database.  Filtering a shared first
-- page made Filter appear empty while its count was non-zero.
create or replace function public.document_flow_queue_page_for_flow(
  target_limit integer default 100, target_before_updated_at timestamptz default null,
  target_before_id uuid default null, target_flow text default null
) returns jsonb language sql stable security definer set search_path=public as $$
  with p as (select public.current_company_id() company_id), a as (
    select i.*,pr.name project_name,m.occurred_at source_received_at,
      coalesce(g.display_name,case when m.line_group_id is not null then 'กลุ่ม LINE' end,'ไม่ระบุเส้นทาง') source_group,
      coalesce(s.display_name,m.line_user_id,'ไม่ทราบผู้ส่ง') source_sender,
      case when i.review_case_id is not null then 'รูปภาพ/สแกน' else 'เอกสาร' end source_file_kind
    from public.document_flow_items i join p on i.company_id=p.company_id
    left join public.projects pr on pr.id=i.project_id left join public.line_messages m on m.id=i.source_message_id
    left join public.line_groups g on g.line_group_id=m.line_group_id left join public.line_senders s on s.line_user_id=m.line_user_id
    where public.can_read_document_flow_item(i.company_id,i.target_department,i.candidate_departments,i.sensitivity)
  ), b as (
    select * from a where (target_flow is null or current_flow=target_flow)
      and (target_before_updated_at is null or (updated_at,id)<(target_before_updated_at,target_before_id))
    order by updated_at desc,id desc limit greatest(1,least(coalesce(target_limit,100),100))
  ), c as (select count(*) filter(where current_flow='intake')::int as intake_total,count(*) filter(where current_flow='filter')::int as filter_total,count(*) filter(where current_flow='posting')::int as posting_total from a), h as (select count(*)::int total from public.employee_intakes e join p on e.company_id=p.company_id)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(b)) from b),'[]'::jsonb),'counts',jsonb_build_object('intake',(select intake_total+total from c cross join h),'filter',(select filter_total from c),'posting',(select posting_total from c)),'next_cursor',(select jsonb_build_object('updated_at',updated_at,'id',id) from b order by updated_at asc,id asc limit 1));
$$;
revoke all on function public.document_flow_queue_page_for_flow(integer,timestamptz,uuid,text) from public,anon;
grant execute on function public.document_flow_queue_page_for_flow(integer,timestamptz,uuid,text) to authenticated;
