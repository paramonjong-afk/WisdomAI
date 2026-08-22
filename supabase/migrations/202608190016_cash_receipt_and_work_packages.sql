-- Financial document type: cash receipt / cash bill.
insert into public.financial_document_type_catalog(code,name_th,description,sort_order)
values ('cash_receipt','บิลเงินสด','หลักฐานซื้อหรือชำระเงินสด แยกจากใบเสร็จรับเงินทั่วไป',25)
on conflict(code) do update set name_th=excluded.name_th,description=excluded.description,sort_order=excluded.sort_order,active=true,updated_at=now();

alter table public.accounting_documents drop constraint if exists accounting_documents_document_type_check;
alter table public.accounting_documents add constraint accounting_documents_document_type_check check(document_type in (
  'transfer_slip','receipt','cash_receipt','tax_invoice_full','tax_invoice_abbreviated',
  'receipt_tax_invoice','invoice_tax_invoice','receipt_tax_invoice_abbreviated',
  'quotation','purchase_order','invoice','billing_note','delivery_note','goods_receipt',
  'withholding_tax_certificate','payroll','other','unreadable'
));

create table if not exists public.project_work_packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  site_id uuid references public.project_sites(id) on delete set null,
  parent_id uuid references public.project_work_packages(id) on delete restrict,
  code text, name text not null, description text,
  status text not null default 'active' check(status in ('active','paused','closed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists project_work_packages_name_per_parent_idx
  on public.project_work_packages(project_id,coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(btrim(name)));
create index if not exists project_work_packages_tree_idx on public.project_work_packages(company_id,project_id,parent_id,status);

alter table public.document_flow_items add column if not exists work_package_id uuid references public.project_work_packages(id) on delete set null;
alter table public.accounting_documents add column if not exists work_package_id uuid references public.project_work_packages(id) on delete set null;

alter table public.project_work_packages enable row level security;
drop policy if exists "Members read project work packages" on public.project_work_packages;
create policy "Members read project work packages" on public.project_work_packages for select to authenticated using (company_id=public.current_company_id());
drop policy if exists "Managers manage project work packages" on public.project_work_packages;
create policy "Managers manage project work packages" on public.project_work_packages for all to authenticated using (public.is_platform_admin() or public.is_company_manager(company_id)) with check (public.is_platform_admin() or public.is_company_manager(company_id));

create or replace function public.create_project_work_package(target_project_id uuid,target_parent_id uuid default null,target_site_id uuid default null,target_name text default null,target_description text default null,target_code text default null)
returns public.project_work_packages language plpgsql security definer set search_path=public as $$
declare project_row public.projects; parent_row public.project_work_packages; result public.project_work_packages; company uuid:=public.current_company_id();
begin
  if coalesce(trim(target_name),'')='' then raise exception 'work_package_name_required'; end if;
  select * into project_row from public.projects where id=target_project_id and company_id=company;
  if not found then raise exception 'project_not_found_or_denied'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(company) then raise exception 'work_package_permission_denied'; end if;
  if target_parent_id is not null then
    select * into parent_row from public.project_work_packages where id=target_parent_id;
    if not found or parent_row.company_id<>company or parent_row.project_id<>target_project_id then raise exception 'work_package_parent_mismatch'; end if;
  end if;
  if target_site_id is not null and not exists(select 1 from public.project_sites where id=target_site_id and project_id=target_project_id and company_id=company) then raise exception 'work_package_site_mismatch'; end if;
  insert into public.project_work_packages(company_id,project_id,site_id,parent_id,code,name,description,created_by)
  values(company,target_project_id,target_site_id,target_parent_id,nullif(trim(target_code),''),trim(target_name),nullif(trim(target_description),''),auth.uid()) returning * into result;
  return result;
exception when unique_violation then raise exception 'work_package_duplicate_name';
end; $$;
revoke all on function public.create_project_work_package(uuid,uuid,uuid,text,text,text) from public,anon;
grant execute on function public.create_project_work_package(uuid,uuid,uuid,text,text,text) to authenticated;

create or replace function public.assign_document_flow_work_package(target_item_id uuid,target_project_id uuid,target_work_package_id uuid default null,target_expected_version integer default null,target_event_key text default null)
returns public.document_flow_items language plpgsql security definer set search_path=public as $$
declare before_row public.document_flow_items; result public.document_flow_items; package_row public.project_work_packages;
begin
  if coalesce(trim(target_event_key),'')='' then raise exception 'workflow_event_key_required'; end if;
  select * into before_row from public.document_flow_items where id=target_item_id for update;
  if not found or (before_row.company_id<>public.current_company_id() and not public.is_platform_admin()) then raise exception 'workflow_item_not_found_or_denied'; end if;
  if before_row.version<>target_expected_version then raise exception 'workflow_version_conflict'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(before_row.company_id) then raise exception 'workflow_permission_denied'; end if;
  if not exists(select 1 from public.projects where id=target_project_id and company_id=before_row.company_id) then raise exception 'workflow_project_mismatch'; end if;
  if target_work_package_id is not null then select * into package_row from public.project_work_packages where id=target_work_package_id; if not found or package_row.project_id<>target_project_id or package_row.company_id<>before_row.company_id then raise exception 'workflow_work_package_mismatch'; end if; end if;
  update public.document_flow_items set project_id=target_project_id,work_package_id=target_work_package_id,version=version+1,updated_at=now() where id=before_row.id returning * into result;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id) values(result.id,result.company_id,target_event_key,'assign_project_work_package',before_row.current_flow,result.current_flow,before_row.state,result.state,before_row.current_room,result.current_room,null,jsonb_build_object('project_id',target_project_id,'work_package_id',target_work_package_id),auth.uid());
  return result;
end; $$;
revoke all on function public.assign_document_flow_work_package(uuid,uuid,uuid,integer,text) from public,anon;
grant execute on function public.assign_document_flow_work_package(uuid,uuid,uuid,integer,text) to authenticated;

-- Keep the accounting classification APIs aligned with the shared type catalog.
create or replace function public.classify_accounting_document(p_document_id uuid,p_document_type text,p_document_purpose text,p_apply_to_similar boolean default false)
returns integer language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents; vendor_key_value text; saved_rule_id uuid; affected integer:=0;
  allowed_types constant text[]:=array['receipt','cash_receipt','tax_invoice_full','tax_invoice_abbreviated','receipt_tax_invoice','invoice_tax_invoice','receipt_tax_invoice_abbreviated','quotation','purchase_order','invoice','billing_note','delivery_note','goods_receipt','withholding_tax_certificate','payroll','other','unreadable'];
  allowed_purposes constant text[]:=array['material','subcontractor','service','labor','equipment','welfare','overhead','other'];
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if doc.status not in ('pending','needs_correction') then raise exception 'confirmed_document_type_is_locked'; end if;
  if not (p_document_type=any(allowed_types)) then raise exception 'invalid_document_type'; end if;
  if not (p_document_purpose=any(allowed_purposes)) then raise exception 'invalid_document_purpose'; end if;
  update public.accounting_documents set document_type=p_document_type,document_purpose=p_document_purpose,classification_source='human',classification_rule_id=null,updated_at=now() where id=p_document_id;
  affected:=1;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason) values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('document_type',doc.document_type,'document_purpose',doc.document_purpose),jsonb_build_object('document_type',p_document_type,'document_purpose',p_document_purpose),'manual_document_classification');
  if p_apply_to_similar and doc.document_type in ('other','unreadable') and coalesce(trim(doc.vendor_name),'')<>'' then
    vendor_key_value:=public.normalize_accounting_vendor(doc.vendor_name);
    insert into public.accounting_document_classification_rules(company_id,vendor_key,vendor_name,source_document_type,target_document_type,target_document_purpose,created_by) values(doc.company_id,vendor_key_value,doc.vendor_name,doc.document_type,p_document_type,p_document_purpose,auth.uid()) on conflict(company_id,vendor_key,source_document_type) do update set vendor_name=excluded.vendor_name,target_document_type=excluded.target_document_type,target_document_purpose=excluded.target_document_purpose,active=true,updated_at=now() returning id into saved_rule_id;
    with changed as (update public.accounting_documents other_doc set document_type=p_document_type,document_purpose=p_document_purpose,classification_source='learned_rule',classification_rule_id=saved_rule_id,updated_at=now() where other_doc.company_id=doc.company_id and other_doc.id<>doc.id and other_doc.status in ('pending','needs_correction') and other_doc.document_type=doc.document_type and public.normalize_accounting_vendor(other_doc.vendor_name)=vendor_key_value returning other_doc.id) select affected+count(*) into affected from changed;
  end if;
  return affected;
end; $$;
grant execute on function public.classify_accounting_document(uuid,text,text,boolean) to authenticated;

create or replace function public.correct_confirmed_accounting_document_type(p_document_id uuid,p_document_type text,p_document_purpose text,p_reason text default 'manual_type_correction')
returns void language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents;
  allowed_types constant text[]:=array['receipt','cash_receipt','tax_invoice_full','tax_invoice_abbreviated','receipt_tax_invoice','invoice_tax_invoice','receipt_tax_invoice_abbreviated','quotation','purchase_order','invoice','billing_note','delivery_note','goods_receipt','withholding_tax_certificate','payroll','other','unreadable'];
  allowed_purposes constant text[]:=array['material','subcontractor','service','labor','equipment','welfare','overhead','other'];
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if doc.status<>'confirmed' then raise exception 'document_is_not_confirmed'; end if;
  if not (p_document_type=any(allowed_types)) then raise exception 'invalid_document_type'; end if;
  if not (p_document_purpose=any(allowed_purposes)) then raise exception 'invalid_document_purpose'; end if;
  update public.accounting_documents set document_type=p_document_type,document_purpose=p_document_purpose,classification_source='human',classification_rule_id=null,updated_at=now() where id=p_document_id;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason) values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('document_type',doc.document_type,'document_purpose',doc.document_purpose,'status',doc.status),jsonb_build_object('document_type',p_document_type,'document_purpose',p_document_purpose,'status',doc.status),coalesce(nullif(trim(p_reason),''),'manual_type_correction'));
end; $$;
grant execute on function public.correct_confirmed_accounting_document_type(uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
