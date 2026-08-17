-- Transactional BOQ import with the original spreadsheet retained as evidence.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'boq-imports','boq-imports',false,20971520,
  array[
    'text/csv','application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict(id) do update set
  public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "Managers upload BOQ source files" on storage.objects
for insert to authenticated with check(
  bucket_id='boq-imports' and public.is_work_manager()
  and (storage.foldername(name))[1]=auth.uid()::text
);
create policy "Managers read BOQ source files" on storage.objects
for select to authenticated using(bucket_id='boq-imports' and public.is_work_manager());
create policy "Managers remove own BOQ source files" on storage.objects
for delete to authenticated using(
  bucket_id='boq-imports' and public.is_work_manager()
  and (storage.foldername(name))[1]=auth.uid()::text
);

create or replace function public.import_boq_document(
  target_project_id uuid,
  target_document_number text,
  target_title text,
  target_overhead_percent numeric,
  target_profit_percent numeric,
  target_vat_percent numeric,
  source_file_name text,
  source_storage_path text,
  imported_items jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  created_document_id uuid;
  item_count integer;
begin
  if not public.is_work_manager() then raise exception 'Permission denied'; end if;
  if not exists(select 1 from public.projects where id=target_project_id) then
    raise exception 'ไม่พบโครงการที่เลือก';
  end if;
  if nullif(trim(target_document_number),'') is null or nullif(trim(target_title),'') is null then
    raise exception 'กรุณาระบุเลขที่และชื่อ BOQ';
  end if;
  if jsonb_typeof(imported_items)<>'array' then raise exception 'รูปแบบรายการนำเข้าไม่ถูกต้อง'; end if;
  item_count:=jsonb_array_length(imported_items);
  if item_count<1 or item_count>5000 then raise exception 'นำเข้าได้ครั้งละ 1–5,000 รายการ'; end if;
  if exists(
    select 1 from jsonb_to_recordset(imported_items) as row(boq_code text)
    group by lower(trim(row.boq_code)) having count(*)>1
  ) then raise exception 'พบรหัส BOQ ซ้ำในไฟล์'; end if;

  insert into public.boq_documents(
    project_id,document_number,title,overhead_percent,profit_percent,vat_percent,
    notes,created_by
  ) values(
    target_project_id,trim(target_document_number),trim(target_title),
    greatest(coalesce(target_overhead_percent,0),0),
    greatest(coalesce(target_profit_percent,0),0),
    greatest(coalesce(target_vat_percent,0),0),
    'นำเข้าจากไฟล์ '||coalesce(source_file_name,'-'),auth.uid()
  ) returning id into created_document_id;

  insert into public.boq_items(
    boq_document_id,line_number,boq_code,category,description,specification,unit,
    quantity,material_unit_cost,labour_unit_cost,equipment_unit_cost,
    subcontract_unit_cost,indirect_unit_cost,selling_unit_price,
    source_type,source_reference
  )
  select
    created_document_id,row.line_number,trim(row.boq_code),trim(row.category),
    trim(row.description),nullif(trim(row.specification),''),
    trim(row.unit),greatest(coalesce(row.quantity,0),0),
    greatest(coalesce(row.material_unit_cost,0),0),
    greatest(coalesce(row.labour_unit_cost,0),0),
    greatest(coalesce(row.equipment_unit_cost,0),0),
    greatest(coalesce(row.subcontract_unit_cost,0),0),
    greatest(coalesce(row.indirect_unit_cost,0),0),
    greatest(coalesce(row.selling_unit_price,0),0),
    'import',
    jsonb_build_object('file_name',source_file_name,'storage_path',source_storage_path,'imported_at',now())
  from jsonb_to_recordset(imported_items) as row(
    line_number integer,boq_code text,category text,description text,specification text,unit text,
    quantity numeric,material_unit_cost numeric,labour_unit_cost numeric,equipment_unit_cost numeric,
    subcontract_unit_cost numeric,indirect_unit_cost numeric,selling_unit_price numeric
  );
  return created_document_id;
end;
$$;
grant execute on function public.import_boq_document(uuid,text,text,numeric,numeric,numeric,text,text,jsonb) to authenticated;
