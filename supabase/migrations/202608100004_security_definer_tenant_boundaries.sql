-- TEN-008: structural tenant protection for references written by SECURITY DEFINER RPCs.
create or replace function public.enforce_company_reference_boundary()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare payload jsonb:=to_jsonb(new); row_company_id uuid:=nullif(payload->>'company_id','')::uuid; reference_id uuid;
begin
  if row_company_id is null then raise exception 'company_id is required'; end if;
  if payload?'profile_id' and nullif(payload->>'profile_id','') is not null then
    reference_id:=(payload->>'profile_id')::uuid;
    if not exists(select 1 from public.company_members m where m.company_id=row_company_id and m.profile_id=reference_id)
      then raise exception 'Cross-company profile reference denied'; end if;
  end if;
  if payload?'project_id' and nullif(payload->>'project_id','') is not null then
    reference_id:=(payload->>'project_id')::uuid;
    if not exists(select 1 from public.projects p where p.project_id=reference_id and p.company_id=row_company_id)
      then raise exception 'Cross-company project reference denied'; end if;
  end if;
  if payload?'site_id' and nullif(payload->>'site_id','') is not null then
    reference_id:=(payload->>'site_id')::uuid;
    if not exists(select 1 from public.project_sites s where s.id=reference_id and s.company_id=row_company_id)
      then raise exception 'Cross-company site reference denied'; end if;
  end if;
  if payload?'boq_document_id' and nullif(payload->>'boq_document_id','') is not null then
    reference_id:=(payload->>'boq_document_id')::uuid;
    if not exists(select 1 from public.boq_documents d where d.id=reference_id and d.company_id=row_company_id)
      then raise exception 'Cross-company BOQ document reference denied'; end if;
  end if;
  if payload?'boq_item_id' and nullif(payload->>'boq_item_id','') is not null then
    reference_id:=(payload->>'boq_item_id')::uuid;
    if not exists(select 1 from public.boq_items i where i.id=reference_id and i.company_id=row_company_id)
      then raise exception 'Cross-company BOQ item reference denied'; end if;
  end if;
  if payload?'document_id' and nullif(payload->>'document_id','') is not null then
    reference_id:=(payload->>'document_id')::uuid;
    if not exists(select 1 from public.accounting_documents d where d.id=reference_id and d.company_id=row_company_id)
      then raise exception 'Cross-company accounting document reference denied'; end if;
  end if;
  if payload?'inventory_item_id' and nullif(payload->>'inventory_item_id','') is not null then
    reference_id:=(payload->>'inventory_item_id')::uuid;
    if not exists(select 1 from public.inventory_items i where i.id=reference_id and i.company_id=row_company_id)
      then raise exception 'Cross-company inventory item reference denied'; end if;
  end if;
  if payload?'contract_id' and nullif(payload->>'contract_id','') is not null then
    reference_id:=(payload->>'contract_id')::uuid;
    if not exists(select 1 from public.contractor_contracts c where c.id=reference_id and c.company_id=row_company_id)
      then raise exception 'Cross-company contractor contract reference denied'; end if;
  end if;
  if payload?'cost_code_id' and nullif(payload->>'cost_code_id','') is not null then
    reference_id:=(payload->>'cost_code_id')::uuid;
    if not exists(select 1 from public.project_cost_codes c where c.id=reference_id and c.company_id=row_company_id)
      then raise exception 'Cross-company cost code reference denied'; end if;
  end if;
  if payload?'pay_period_id' and nullif(payload->>'pay_period_id','') is not null then
    reference_id:=(payload->>'pay_period_id')::uuid;
    if not exists(select 1 from public.pay_periods p where p.id=reference_id and p.company_id=row_company_id)
      then raise exception 'Cross-company pay period reference denied'; end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_company_reference_boundary() from public,anon,authenticated;

do $$ declare target record;
begin
  for target in
    select distinct c.table_name from information_schema.columns c
    where c.table_schema='public' and c.column_name='company_id' and exists(
      select 1 from information_schema.columns r where r.table_schema=c.table_schema and r.table_name=c.table_name
      and r.column_name in ('profile_id','project_id','site_id','boq_document_id','boq_item_id','document_id',
        'inventory_item_id','contract_id','cost_code_id','pay_period_id'))
  loop
    execute format('drop trigger if exists enforce_company_reference_boundary on public.%I',target.table_name);
    execute format('create trigger enforce_company_reference_boundary before insert or update on public.%I for each row execute function public.enforce_company_reference_boundary()',target.table_name);
  end loop;
end $$;

create or replace function public.assert_current_company_project(target_project_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.projects project where project.project_id=target_project_id and project.company_id=public.current_company_id())
    then raise exception 'Project not found in active company'; end if;
end $$;
revoke all on function public.assert_current_company_project(uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
