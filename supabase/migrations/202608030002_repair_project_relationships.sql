-- Restore PostgREST relationships against the legacy project_id that existing
-- sites, assignments, attendance, LINE, BOQ and finance records already use.
-- This migration intentionally does not rewrite any existing identifier.
do $$
declare
  column_row record;
  constraint_name text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects'
      and column_name = 'project_id' and udt_name = 'uuid'
  ) then
    raise exception 'projects.project_id must be uuid before restoring relationships';
  end if;

  create unique index if not exists projects_legacy_project_id_uidx
    on public.projects(project_id);

  for column_row in
    select c.table_name, c.column_name, c.is_nullable
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name <> 'projects'
      and c.udt_name = 'uuid'
      and c.column_name in ('project_id', 'proposed_project_id', 'confirmed_project_id')
  loop
    if not exists (
      select 1
      from pg_constraint fk
      join pg_attribute attribute
        on attribute.attrelid = fk.conrelid and attribute.attnum = any(fk.conkey)
      where fk.contype = 'f'
        and fk.conrelid = format('public.%I', column_row.table_name)::regclass
        and fk.confrelid = 'public.projects'::regclass
        and attribute.attname = column_row.column_name
    ) then
      constraint_name := left(column_row.table_name || '_' || column_row.column_name || '_projects_fkey', 63);
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.projects(project_id) on delete %s not valid',
        column_row.table_name, constraint_name, column_row.column_name,
        case when column_row.is_nullable = 'YES' then 'set null' else 'cascade' end
      );
    end if;
  end loop;
end
$$;

-- Keep both column generations populated for all projects created or edited
-- after this repair, without changing any existing project identifier.
create or replace function public.sync_project_legacy_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.project_id := coalesce(new.project_id, new.id, gen_random_uuid());
  new.id := coalesce(new.id, new.project_id);
  new.name := coalesce(nullif(btrim(new.name), ''), nullif(btrim(new.project_name), ''));
  new.project_name := coalesce(nullif(btrim(new.project_name), ''), new.name);
  return new;
end
$$;

drop trigger if exists sync_project_legacy_columns on public.projects;
create trigger sync_project_legacy_columns
before insert or update of id, project_id, name, project_name on public.projects
for each row execute function public.sync_project_legacy_columns();

create or replace function public.import_boq_document(
  target_project_id uuid,
  target_document_number text,
  target_title text,
  target_overhead numeric,
  target_profit numeric,
  target_vat numeric,
  source_file_name text,
  source_storage_path text,
  source_sheet_name text,
  source_rows jsonb
) returns uuid
language plpgsql
security invoker
set search_path=public
as $$
declare
  new_document_id uuid;
  next_revision integer;
begin
  if not public.is_work_manager() then raise exception 'Manager permission required'; end if;
  if not exists(select 1 from public.projects where project_id=target_project_id) then
    raise exception 'Project not found';
  end if;
  if jsonb_typeof(source_rows)<>'array' or jsonb_array_length(source_rows)=0 then
    raise exception 'BOQ rows are required';
  end if;
  select coalesce(max(revision),0)+1 into next_revision from public.boq_documents
  where project_id=target_project_id and document_number=trim(target_document_number);
  insert into public.boq_documents(
    project_id,document_number,title,overhead_percent,profit_percent,vat_percent,
    revision,status,source_file_name,source_storage_path,source_sheet_name,imported_at,created_by
  ) values(
    target_project_id,trim(target_document_number),trim(target_title),
    coalesce(target_overhead,0),coalesce(target_profit,0),coalesce(target_vat,7),
    next_revision,'draft',source_file_name,source_storage_path,source_sheet_name,now(),auth.uid()
  ) returning id into new_document_id;
  insert into public.boq_items(
    boq_document_id,line_number,boq_code,category,description,unit,quantity,
    material_unit_cost,labour_unit_cost,equipment_unit_cost,subcontract_unit_cost,
    indirect_unit_cost,selling_unit_price,created_by
  )
  select new_document_id,
    greatest(1,coalesce((row->>'line_number')::integer,ordinality::integer)),
    coalesce(row->>'boq_code',''),coalesce(row->>'category',''),
    coalesce(nullif(trim(row->>'description'),''),'ไม่ระบุรายการ'),coalesce(row->>'unit',''),
    coalesce((row->>'quantity')::numeric,0),coalesce((row->>'material_unit_cost')::numeric,0),
    coalesce((row->>'labour_unit_cost')::numeric,0),coalesce((row->>'equipment_unit_cost')::numeric,0),
    coalesce((row->>'subcontract_unit_cost')::numeric,0),coalesce((row->>'indirect_unit_cost')::numeric,0),
    coalesce((row->>'selling_unit_price')::numeric,0),auth.uid()
  from jsonb_array_elements(source_rows) with ordinality as imported(row,ordinality);
  return new_document_id;
end
$$;

notify pgrst, 'reload schema';
