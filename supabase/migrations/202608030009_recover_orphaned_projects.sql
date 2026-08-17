-- Recover only missing project parent rows from surviving references.
-- Existing project IDs and child rows are never rewritten or deleted.
with referenced_projects as (
  select project_id from public.project_sites where project_id is not null
  union select project_id from public.work_summary_items where project_id is not null
  union select project_id from public.line_groups where project_id is not null
  union select project_id from public.line_message_projects where project_id is not null
  union select project_id from public.financial_transactions where project_id is not null
  union select project_id from public.accounting_documents where project_id is not null
  union select project_id from public.accounting_document_lines where project_id is not null
  union select project_id from public.inventory_movements where project_id is not null
  union select project_id from public.accounting_draft_entries where project_id is not null
  union select project_id from public.boq_documents where project_id is not null
  union select project_id from public.drawing_ai_jobs where project_id is not null
), recovered as (
  select
    reference.project_id,
    coalesce(
      (select min(nullif(btrim(site.name),'')) from public.project_sites site where site.project_id=reference.project_id),
      (select min(nullif(btrim(group_row.display_name),'')) from public.line_groups group_row where group_row.project_id=reference.project_id),
      'โครงการกู้คืน ' || left(reference.project_id::text,8)
    ) as recovered_name
  from referenced_projects reference
)
insert into public.projects(project_id,id,project_name,name,status)
select recovered.project_id,recovered.project_id,recovered.recovered_name,recovered.recovered_name,'active'
from recovered
where not exists (
  select 1 from public.projects project
  where project.project_id=recovered.project_id or project.id=recovered.project_id
);

-- Re-sync canonical and legacy display fields without changing identifiers.
update public.projects
set
  id=coalesce(id,project_id),
  project_id=coalesce(project_id,id),
  name=coalesce(nullif(btrim(name),''),nullif(btrim(project_name),''),'โครงการกู้คืน '||left(coalesce(project_id,id)::text,8)),
  project_name=coalesce(nullif(btrim(project_name),''),nullif(btrim(name),''),'โครงการกู้คืน '||left(coalesce(project_id,id)::text,8)),
  status=coalesce(status,'active');

notify pgrst, 'reload schema';
