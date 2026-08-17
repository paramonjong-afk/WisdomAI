-- Project-cost accounting: master categories, line allocations and atomic review.
create table if not exists public.accounting_cost_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  parent_id uuid references public.accounting_cost_categories(id) on delete cascade,
  code text not null,
  name_th text not null,
  default_account_code text,
  default_account_name text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists accounting_cost_categories_global_code_uq
  on public.accounting_cost_categories(code) where company_id is null;
create unique index if not exists accounting_cost_categories_company_code_uq
  on public.accounting_cost_categories(company_id,code) where company_id is not null;
create index if not exists accounting_cost_categories_parent_idx
  on public.accounting_cost_categories(parent_id,sort_order);

alter table public.accounting_cost_categories enable row level security;
create policy "Members read cost categories" on public.accounting_cost_categories
  for select to authenticated
  using(company_id is null or public.is_company_manager(company_id));
create policy "Managers maintain company cost categories" on public.accounting_cost_categories
  for all to authenticated
  using(company_id is not null and public.is_company_manager(company_id))
  with check(company_id is not null and public.is_company_manager(company_id));

insert into public.accounting_cost_categories(code,name_th,default_account_code,default_account_name,sort_order) values
  ('01','วัสดุก่อสร้าง','5100','ต้นทุนวัสดุก่อสร้าง',10),
  ('02','ค่าแรงและสวัสดิการบุคลากร','5200','ต้นทุนแรงงานและสวัสดิการ',20),
  ('03','ผู้รับเหมาช่วง','5300','ต้นทุนผู้รับเหมาช่วง',30),
  ('04','เครื่องจักรและอุปกรณ์','5400','ต้นทุนเครื่องจักรและอุปกรณ์',40),
  ('05','ขนส่งและโลจิสติกส์','5500','ต้นทุนขนส่งและโลจิสติกส์',50),
  ('06','ค่าใช้จ่ายหน้างาน','5600','ค่าใช้จ่ายหน้างาน',60),
  ('07','วิชาชีพและควบคุมงาน','5700','ค่าวิชาชีพและควบคุมงาน',70),
  ('08','ใบอนุญาตและประกัน','5800','ค่าใบอนุญาตและประกัน',80),
  ('09','ต้นทุนทางการเงิน','5900','ต้นทุนทางการเงิน',90),
  ('10','ค่าใช้จ่ายส่วนกลางปันส่วน','6100','ค่าใช้จ่ายส่วนกลางปันส่วน',100)
on conflict do nothing;

insert into public.accounting_cost_categories(parent_id,code,name_th,default_account_code,default_account_name,sort_order)
select parent.id, child.code, child.name_th, child.account_code, child.account_name, child.sort_order
from (values
  ('01','01.01','งานโครงสร้าง','5101','วัสดุงานโครงสร้าง',1),
  ('01','01.02','งานสถาปัตยกรรม','5102','วัสดุงานสถาปัตยกรรม',2),
  ('01','01.03','งานระบบไฟฟ้า','5103','วัสดุงานระบบไฟฟ้า',3),
  ('01','01.04','งานระบบประปา','5104','วัสดุงานระบบประปา',4),
  ('01','01.05','งานปรับอากาศ','5105','วัสดุงานปรับอากาศ',5),
  ('01','01.06','งานภายนอกและภูมิทัศน์','5106','วัสดุงานภายนอกและภูมิทัศน์',6),
  ('02','02.01','ค่าแรงและเงินเดือน','5201','ค่าแรงและเงินเดือนโครงการ',1),
  ('02','02.02','เบี้ยเลี้ยงและค่าที่พัก','5202','เบี้ยเลี้ยงและค่าที่พัก',2),
  ('02','02.03','อาหารและน้ำดื่ม','5203','สวัสดิการอาหารและน้ำดื่ม',3),
  ('02','02.04','PPE และเครื่องแบบ','5204','สวัสดิการ PPE และเครื่องแบบ',4),
  ('02','02.05','ประกันสังคมและเงินสมทบ','5205','เงินสมทบนายจ้าง',5),
  ('02','02.06','ประกันและค่ารักษาพยาบาล','5206','ประกันและค่ารักษาพยาบาล',6),
  ('02','02.07','รถรับส่งและค่าเดินทาง','5207','สวัสดิการเดินทาง',7),
  ('02','02.08','สวัสดิการอื่น','5208','สวัสดิการอื่น',8),
  ('03','03.01','ผู้รับเหมาช่วงงานโครงสร้าง','5301','ผู้รับเหมาช่วงงานโครงสร้าง',1),
  ('03','03.02','ผู้รับเหมาช่วงงานระบบ','5302','ผู้รับเหมาช่วงงานระบบ',2),
  ('04','04.01','ค่าเช่าเครื่องจักร','5401','ค่าเช่าเครื่องจักร',1),
  ('04','04.02','เครื่องมือและอุปกรณ์สิ้นเปลือง','5402','เครื่องมือและอุปกรณ์',2),
  ('05','05.01','ค่าขนส่ง','5501','ค่าขนส่ง',1),
  ('05','05.02','น้ำมันและทางด่วน','5502','น้ำมันและทางด่วน',2),
  ('06','06.01','ค่าสาธารณูปโภคหน้างาน','5601','ค่าน้ำ ค่าไฟ และสาธารณูปโภค',1),
  ('06','06.02','สำนักงานสนามและที่พัก','5602','สำนักงานสนามและที่พัก',2),
  ('06','06.03','รักษาความปลอดภัยและทำความสะอาด','5603','รักษาความปลอดภัยและทำความสะอาด',3),
  ('07','07.01','วิศวกร สถาปนิก และที่ปรึกษา','5701','ค่าวิชาชีพและที่ปรึกษา',1),
  ('07','07.02','ทดสอบและควบคุมคุณภาพ','5702','ค่าทดสอบและควบคุมคุณภาพ',2),
  ('08','08.01','ใบอนุญาตและค่าธรรมเนียม','5801','ใบอนุญาตและค่าธรรมเนียม',1),
  ('08','08.02','ประกันภัยโครงการ','5802','ประกันภัยโครงการ',2),
  ('09','09.01','ดอกเบี้ยโครงการ','5901','ดอกเบี้ยโครงการ',1),
  ('09','09.02','ค่าธรรมเนียมและหนังสือค้ำประกัน','5902','ค่าธรรมเนียมธนาคารและค้ำประกัน',2),
  ('10','10.01','บริหารและบัญชีปันส่วน','6101','ค่าใช้จ่ายบริหารปันส่วน',1),
  ('10','10.02','IT และสำนักงานปันส่วน','6102','ค่าใช้จ่าย IT และสำนักงานปันส่วน',2)
) as child(parent_code,code,name_th,account_code,account_name,sort_order)
join public.accounting_cost_categories parent
  on parent.company_id is null and parent.code=child.parent_code
on conflict do nothing;

alter table public.accounting_documents
  add column if not exists site_id uuid references public.project_sites(id) on delete set null,
  add column if not exists recognition_date date;
alter table public.accounting_document_lines
  add column if not exists site_id uuid references public.project_sites(id) on delete set null,
  add column if not exists cost_category_id uuid references public.accounting_cost_categories(id) on delete set null,
  add column if not exists account_code text,
  add column if not exists account_name text;

create table if not exists public.accounting_line_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid not null references public.accounting_documents(id) on delete cascade,
  document_line_id uuid not null references public.accounting_document_lines(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  site_id uuid references public.project_sites(id) on delete set null,
  cost_category_id uuid not null references public.accounting_cost_categories(id) on delete restrict,
  account_code text not null,
  account_name text not null,
  cost_center_code text,
  wbs_code text,
  allocation_percent numeric(7,4) not null check(allocation_percent>0 and allocation_percent<=100),
  allocation_amount numeric(14,2) not null check(allocation_amount>=0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists accounting_line_allocations_document_idx
  on public.accounting_line_allocations(document_id,document_line_id);
create index if not exists accounting_line_allocations_project_idx
  on public.accounting_line_allocations(company_id,project_id,cost_category_id);
alter table public.accounting_line_allocations enable row level security;
create policy "Company members read accounting allocations" on public.accounting_line_allocations
  for select to authenticated using(public.is_company_manager(company_id));
create policy "Company managers maintain accounting allocations" on public.accounting_line_allocations
  for all to authenticated using(public.is_company_manager(company_id))
  with check(public.is_company_manager(company_id));

create or replace function public.save_accounting_document_classification(
  p_document_id uuid,
  p_header jsonb,
  p_lines jsonb
) returns void
language plpgsql security definer set search_path=public as $$
declare
  doc public.accounting_documents;
  line_data jsonb;
  allocation_data jsonb;
  line_row public.accounting_document_lines;
  project uuid;
  site uuid;
  category uuid;
  amount numeric(14,2);
  percent numeric(7,4);
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if doc.status not in ('pending','needs_correction') then raise exception 'document_not_editable'; end if;

  project:=nullif(p_header->>'project_id','')::uuid;
  site:=nullif(p_header->>'site_id','')::uuid;
  if project is not null and not exists(select 1 from public.projects where id=project and company_id=doc.company_id) then
    raise exception 'project_not_in_company';
  end if;
  if site is not null and not exists(select 1 from public.project_sites where id=site and project_id=project and company_id=doc.company_id) then
    raise exception 'site_not_in_project';
  end if;

  update public.accounting_documents set
    project_id=project, site_id=site,
    cost_center_code=nullif(trim(p_header->>'cost_center_code'),''),
    wbs_code=nullif(trim(p_header->>'wbs_code'),''),
    contract_reference=nullif(trim(p_header->>'contract_reference'),''),
    recognition_date=coalesce(nullif(p_header->>'recognition_date','')::date,document_date,current_date),
    updated_at=now()
  where id=p_document_id;

  for line_data in select value from jsonb_array_elements(p_lines)
  loop
    select * into line_row from public.accounting_document_lines
      where id=(line_data->>'line_id')::uuid and document_id=p_document_id for update;
    if not found then raise exception 'line_not_in_document'; end if;

    category:=nullif(line_data->>'cost_category_id','')::uuid;
    if category is null or not exists(select 1 from public.accounting_cost_categories where id=category and active) then
      raise exception 'cost_category_required';
    end if;
    if coalesce(trim(line_data->>'account_code'),'')='' then raise exception 'account_code_required'; end if;

    update public.accounting_document_lines set
      item_type=(line_data->>'item_type'),
      project_id=project,
      site_id=site,
      cost_category_id=category,
      expense_category=(select code from public.accounting_cost_categories where id=category),
      account_code=trim(line_data->>'account_code'),
      account_name=trim(line_data->>'account_name'),
      cost_center_code=nullif(trim(p_header->>'cost_center_code'),''),
      wbs_code=nullif(trim(p_header->>'wbs_code'),''),
      updated_at=now()
    where id=line_row.id;

    delete from public.accounting_line_allocations where document_line_id=line_row.id;
    if jsonb_array_length(coalesce(line_data->'allocations','[]'::jsonb))=0 then
      raise exception 'allocation_required';
    end if;
    for allocation_data in select value from jsonb_array_elements(line_data->'allocations')
    loop
      project:=nullif(allocation_data->>'project_id','')::uuid;
      site:=nullif(allocation_data->>'site_id','')::uuid;
      category:=nullif(allocation_data->>'cost_category_id','')::uuid;
      amount:=coalesce(nullif(allocation_data->>'allocation_amount','')::numeric,0);
      percent:=coalesce(nullif(allocation_data->>'allocation_percent','')::numeric,0);
      if not exists(select 1 from public.projects where id=project and company_id=doc.company_id) then raise exception 'allocation_project_not_in_company'; end if;
      if site is not null and not exists(select 1 from public.project_sites where id=site and project_id=project and company_id=doc.company_id) then raise exception 'allocation_site_not_in_project'; end if;
      if not exists(select 1 from public.accounting_cost_categories where id=category and active) then raise exception 'allocation_category_required'; end if;
      insert into public.accounting_line_allocations(
        company_id,document_id,document_line_id,project_id,site_id,cost_category_id,
        account_code,account_name,cost_center_code,wbs_code,allocation_percent,allocation_amount,created_by
      ) values(
        doc.company_id,p_document_id,line_row.id,project,site,category,
        trim(allocation_data->>'account_code'),trim(allocation_data->>'account_name'),
        nullif(trim(allocation_data->>'cost_center_code'),''),nullif(trim(allocation_data->>'wbs_code'),''),
        percent,amount,auth.uid()
      );
    end loop;
    if abs((select coalesce(sum(allocation_amount),0) from public.accounting_line_allocations where document_line_id=line_row.id)-coalesce(line_row.line_amount,0))>0.01 then
      raise exception 'allocation_amount_mismatch_line_%',line_row.line_number;
    end if;
    if abs((select coalesce(sum(allocation_percent),0) from public.accounting_line_allocations where document_line_id=line_row.id)-100)>0.01 then
      raise exception 'allocation_percent_mismatch_line_%',line_row.line_number;
    end if;
  end loop;

  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,after_dimensions,reason)
  values(doc.company_id,p_document_id,auth.uid(),'human_review',jsonb_build_object('header',p_header,'lines',p_lines),'project_cost_classification_saved');
end;
$$;
grant execute on function public.save_accounting_document_classification(uuid,jsonb,jsonb) to authenticated;

-- Preserve inventory and base journal behavior, then replace broad debit lines with allocations.
alter function public.confirm_accounting_document(uuid) rename to confirm_accounting_document_legacy;
create or replace function public.confirm_accounting_document(p_document_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  doc public.accounting_documents;
  line_row public.accounting_document_lines;
  allocation_total numeric(14,2);
  next_line integer:=1000;
  allocation_row public.accounting_line_allocations;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if doc.project_id is null then raise exception 'project_required'; end if;
  for line_row in select * from public.accounting_document_lines where document_id=p_document_id order by line_number
  loop
    select coalesce(sum(allocation_amount),0) into allocation_total
      from public.accounting_line_allocations where document_line_id=line_row.id;
    if abs(allocation_total-coalesce(line_row.line_amount,0))>0.01 then raise exception 'allocation_incomplete_line_%',line_row.line_number; end if;
  end loop;

  perform public.confirm_accounting_document_legacy(p_document_id);
  delete from public.accounting_draft_entries where document_id=p_document_id and debit>0 and account_code<>'1150';
  for allocation_row in select * from public.accounting_line_allocations where document_id=p_document_id order by document_line_id,created_at
  loop
    insert into public.accounting_draft_entries(document_id,line_number,account_code,account_name,debit,credit,project_id,description)
    select p_document_id,next_line,allocation_row.account_code,allocation_row.account_name,
      allocation_row.allocation_amount,0,allocation_row.project_id,line.description
    from public.accounting_document_lines line where line.id=allocation_row.document_line_id;
    next_line:=next_line+1;
  end loop;
end;
$$;
grant execute on function public.confirm_accounting_document(uuid) to authenticated;
revoke execute on function public.confirm_accounting_document_legacy(uuid) from public,anon,authenticated;

comment on table public.accounting_line_allocations is
  'Auditable split of each accounting document line across projects, sites, WBS and cost categories.';
notify pgrst,'reload schema';
