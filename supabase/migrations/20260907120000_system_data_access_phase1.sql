-- Phase 1: server-side cursors for Accounting Documents.
-- Detail, lines, evidence and mutation paths remain lazy and unchanged.

create or replace function public.accounting_document_queue_page(
  target_limit integer default 100,
  target_before_created_at timestamptz default null,
  target_before_id uuid default null
) returns jsonb language sql stable security definer set search_path=public as $$
  with allowed as (
    select d.*, p.name project_name, ls.display_name sender_display_name, lg.display_name group_display_name
    from public.accounting_documents d
    left join public.projects p on p.id=d.project_id
    left join public.line_messages lm on lm.id=d.source_message_id
    left join public.line_senders ls on ls.line_user_id=lm.line_user_id
    left join public.line_groups lg on lg.line_group_id=lm.line_group_id
    where d.company_id=public.current_company_id()
      and d.document_type <> 'transfer_slip'
      and (public.is_platform_admin() or public.is_company_manager(d.company_id)
        or exists (select 1 from public.company_members m where m.company_id=d.company_id and m.profile_id=auth.uid() and m.active and (m.ends_on is null or m.ends_on>=current_date) and m.company_role='accounting_hr')
        or exists (select 1 from public.document_flow_department_members m where m.company_id=d.company_id and m.profile_id=auth.uid() and lower(m.department)=any(array['accounting','finance','audit','auditor'])))
  ), page as (
    select * from allowed
    where target_before_created_at is null or (created_at,id)<(target_before_created_at,target_before_id)
    order by created_at desc,id desc limit greatest(1,least(coalesce(target_limit,100),100))
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(page)-'company_id'-'project_name'-'sender_display_name'-'group_display_name' || jsonb_build_object('projects',jsonb_build_object('name',project_name),'line_messages',jsonb_build_object('line_senders',jsonb_build_object('display_name',sender_display_name),'line_groups',jsonb_build_object('display_name',group_display_name)))) from page),'[]'::jsonb),
    'counts',jsonb_build_object('all',(select count(*) from allowed),'pending',(select count(*) from allowed where status in ('pending','needs_correction')),'confirmed',(select count(*) from allowed where status='confirmed'),'duplicate',(select count(*) from allowed where status='duplicate')),
    'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at asc,id asc limit 1)
  );
$$;

revoke all on function public.accounting_document_queue_page(integer,timestamptz,uuid) from public,anon;
grant execute on function public.accounting_document_queue_page(integer,timestamptz,uuid) to authenticated;

create index if not exists accounting_documents_company_created_cursor_idx on public.accounting_documents(company_id,created_at desc,id desc);
