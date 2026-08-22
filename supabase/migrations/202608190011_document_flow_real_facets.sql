-- Real queue counters for all sub-tabs.  These are calculated before paging.
create or replace function public.document_flow_queue_facets(target_flow text default null)
returns jsonb language sql stable security definer set search_path=public as $$
  with a as (
    select item.* from public.document_flow_items item
    where item.company_id=public.current_company_id()
      and public.can_read_document_flow_item(item.company_id,item.target_department,item.candidate_departments,item.sensitivity)
  )
  select jsonb_build_object(
    'intake',jsonb_build_object('all',(select count(*) from a where current_flow='intake'),'admin',(select count(*) from a where current_flow='intake' and current_room like '%manual%'),'quality',(select count(*) from a where current_flow='intake' and (quality_state in ('low_quality','unreadable') or cardinality(issue_codes)>0)),'duplicate',(select count(*) from a where current_flow='intake' and (duplicate_state='duplicate' or state='duplicate_hold')),'failed',(select count(*) from a where current_flow='intake' and state in ('failed','rejected'))),
    'filter',jsonb_build_object('all',(select count(*) from a where current_flow='filter'),'classifying',(select count(*) from a where current_flow='filter' and state='validating'),'admin',(select count(*) from a where current_flow='filter' and (state='needs_correction' or cardinality(issue_codes)>0 or coalesce(confidence,1)<.9)),'ready',(select count(*) from a where current_flow='filter' and state='ready_for_posting'),'failed',(select count(*) from a where current_flow='filter' and state in ('failed','rejected'))),
    'department',jsonb_build_object('all',(select count(*) from a where current_flow='posting'),'accounting',(select count(*) from a where current_flow='posting' and target_department='accounting'),'procurement',(select count(*) from a where current_flow='posting' and target_department='procurement'),'inventory',(select count(*) from a where current_flow='posting' and target_department='inventory'),'hr',(select count(*) from a where current_flow='posting' and target_department='hr'),'project',(select count(*) from a where current_flow='posting' and target_department='project'),'reference',(select count(*) from a where current_flow='posting' and target_department='admin'))
  );
$$;
revoke all on function public.document_flow_queue_facets(text) from public,anon;
grant execute on function public.document_flow_queue_facets(text) to authenticated;
