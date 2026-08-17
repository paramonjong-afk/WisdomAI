-- A company membership is itself the source of truth for a profile/company
-- relationship. Requiring that relationship to exist before inserting it
-- made the first membership of a newly-created company impossible.

create or replace function public.enforce_company_reference_boundary()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  payload jsonb:=to_jsonb(new);
  row_company_id uuid:=nullif(payload->>'company_id','')::uuid;
  reference_id uuid;
  bootstrap_own_membership boolean;
begin
  if row_company_id is null then raise exception 'company_id is required'; end if;

  if payload?'profile_id' and nullif(payload->>'profile_id','') is not null then
    reference_id:=(payload->>'profile_id')::uuid;

    if tg_table_name='company_members' then
      if not exists(select 1 from public.profiles profile where profile.id=reference_id) then
        raise exception 'Profile not found';
      end if;
      bootstrap_own_membership:=public.is_platform_admin()
        and current_setting('app.platform_company_bootstrap',true)='on'
        and reference_id=auth.uid();
      if not bootstrap_own_membership and not public.is_company_manager(row_company_id) then
        raise exception 'Company member management permission denied';
      end if;
    elsif not exists(
      select 1 from public.company_members member
      where member.company_id=row_company_id
        and member.profile_id=reference_id
        and member.active
        and (member.ends_on is null or member.ends_on>=current_date)
    ) then
      raise exception 'Cross-company profile reference denied';
    end if;
  end if;

  if payload?'project_id' and nullif(payload->>'project_id','') is not null then
    reference_id:=(payload->>'project_id')::uuid;
    if not exists(select 1 from public.projects project where project.project_id=reference_id and project.company_id=row_company_id)
      then raise exception 'Cross-company project reference denied'; end if;
  end if;
  if payload?'site_id' and nullif(payload->>'site_id','') is not null then
    reference_id:=(payload->>'site_id')::uuid;
    if not exists(select 1 from public.project_sites site where site.id=reference_id and site.company_id=row_company_id)
      then raise exception 'Cross-company site reference denied'; end if;
  end if;
  if payload?'boq_document_id' and nullif(payload->>'boq_document_id','') is not null then
    reference_id:=(payload->>'boq_document_id')::uuid;
    if not exists(select 1 from public.boq_documents document where document.id=reference_id and document.company_id=row_company_id)
      then raise exception 'Cross-company BOQ document reference denied'; end if;
  end if;
  if payload?'boq_item_id' and nullif(payload->>'boq_item_id','') is not null then
    reference_id:=(payload->>'boq_item_id')::uuid;
    if not exists(select 1 from public.boq_items item where item.id=reference_id and item.company_id=row_company_id)
      then raise exception 'Cross-company BOQ item reference denied'; end if;
  end if;
  if payload?'document_id' and nullif(payload->>'document_id','') is not null then
    reference_id:=(payload->>'document_id')::uuid;
    if not exists(select 1 from public.accounting_documents document where document.id=reference_id and document.company_id=row_company_id)
      then raise exception 'Cross-company accounting document reference denied'; end if;
  end if;
  if payload?'inventory_item_id' and nullif(payload->>'inventory_item_id','') is not null then
    reference_id:=(payload->>'inventory_item_id')::uuid;
    if not exists(select 1 from public.inventory_items item where item.id=reference_id and item.company_id=row_company_id)
      then raise exception 'Cross-company inventory item reference denied'; end if;
  end if;
  if payload?'contract_id' and nullif(payload->>'contract_id','') is not null then
    reference_id:=(payload->>'contract_id')::uuid;
    if not exists(select 1 from public.contractor_contracts contract where contract.id=reference_id and contract.company_id=row_company_id)
      then raise exception 'Cross-company contractor contract reference denied'; end if;
  end if;
  if payload?'cost_code_id' and nullif(payload->>'cost_code_id','') is not null then
    reference_id:=(payload->>'cost_code_id')::uuid;
    if not exists(select 1 from public.project_cost_codes code where code.id=reference_id and code.company_id=row_company_id)
      then raise exception 'Cross-company cost code reference denied'; end if;
  end if;
  if payload?'pay_period_id' and nullif(payload->>'pay_period_id','') is not null then
    reference_id:=(payload->>'pay_period_id')::uuid;
    if not exists(select 1 from public.pay_periods period where period.id=reference_id and period.company_id=row_company_id)
      then raise exception 'Cross-company pay period reference denied'; end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_company_reference_boundary() from public,anon,authenticated;
notify pgrst,'reload schema';

