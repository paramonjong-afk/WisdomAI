-- Keep document, quotation price history, PO and receipt project ownership aligned.
alter table public.quotation_price_references add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists quotation_price_references_project_idx on public.quotation_price_references(project_id,observed_at desc);

create or replace function public.save_accounting_document_project(p_document_id uuid,p_project_id uuid,p_site_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found';end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized';end if;
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and company_id=doc.company_id) then raise exception 'project_not_in_company';end if;
  if p_site_id is not null and not exists(select 1 from public.project_sites where id=p_site_id and project_id=p_project_id) then raise exception 'site_not_in_project';end if;
  update public.accounting_documents set project_id=p_project_id,site_id=p_site_id,updated_at=now() where id=doc.id;
  update public.quotation_price_references set project_id=p_project_id,updated_at=now() where document_id=doc.id;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('project_id',doc.project_id,'site_id',doc.site_id),jsonb_build_object('project_id',p_project_id,'site_id',p_site_id),'document_project_assignment');
  return jsonb_build_object('status','saved','project_id',p_project_id,'site_id',p_site_id);
end;$$;
grant execute on function public.save_accounting_document_project(uuid,uuid,uuid) to authenticated;

with source as(select distinct on(po.source_quotation_document_id) po.source_quotation_document_id document_id,po.project_id from public.purchase_orders po where po.project_id is not null order by po.source_quotation_document_id,po.created_at desc)
update public.accounting_documents document set project_id=source.project_id,updated_at=now() from source
where source.document_id=document.id and document.document_type='quotation' and document.project_id is null;

with source as(select line.document_id,min(allocation.project_id::text)::uuid project_id
  from public.accounting_document_lines line join public.goods_receipt_line_reviews review on review.document_line_id=line.id join public.goods_receipt_allocations allocation on allocation.review_line_id=review.id
  group by line.document_id having count(distinct allocation.project_id)=1 and count(*) filter(where allocation.project_id is null)=0)
update public.accounting_documents document set project_id=source.project_id,updated_at=now() from source
where source.document_id=document.id and document.document_type='goods_receipt' and document.project_id is null;

update public.quotation_price_references price set project_id=document.project_id
from public.accounting_documents document where document.id=price.document_id and price.project_id is null;
notify pgrst,'reload schema';
