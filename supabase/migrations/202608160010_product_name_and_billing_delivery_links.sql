-- Audited product name corrections and many-delivery-note billing matching.
create table if not exists public.billing_delivery_note_links(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  billing_document_id uuid not null references public.accounting_documents(id) on delete cascade,
  delivery_note_document_id uuid not null references public.accounting_documents(id) on delete restrict,
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz not null default now(),
  unique(billing_document_id,delivery_note_document_id),
  unique(delivery_note_document_id)
);
alter table public.billing_delivery_note_links enable row level security;
create policy "Managers read billing delivery links" on public.billing_delivery_note_links for select to authenticated
using(public.is_company_manager(company_id));

create or replace function public.save_accounting_product_name(p_line_id uuid,p_description text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare line public.accounting_document_lines; doc public.accounting_documents; old_name text; item_name_updated boolean:=false;
begin
  select * into line from public.accounting_document_lines where id=p_line_id for update;
  if not found then raise exception 'document_line_not_found'; end if;
  select * into doc from public.accounting_documents where id=line.document_id;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if nullif(trim(p_description),'') is null then raise exception 'product_name_required'; end if;
  old_name:=line.description;
  if trim(p_description)=trim(old_name) then return jsonb_build_object('updated',false,'description',old_name); end if;
  update public.accounting_document_lines set description=trim(p_description),updated_at=now() where id=line.id;
  if line.inventory_item_id is not null and not exists(
    select 1 from public.inventory_items i where i.id<>line.inventory_item_id and i.normalized_name=lower(regexp_replace(trim(p_description),'\s+',' ','g'))
  ) then
    update public.inventory_items set name=trim(p_description),normalized_name=lower(regexp_replace(trim(p_description),'\s+',' ','g')),updated_at=now()
    where id=line.inventory_item_id;
    item_name_updated:=true;
  end if;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('line_id',line.id,'description',old_name),jsonb_build_object('line_id',line.id,'description',trim(p_description),'inventory_name_updated',item_name_updated),'manual_product_name_correction');
  return jsonb_build_object('updated',true,'description',trim(p_description),'inventory_name_updated',item_name_updated);
end; $$;
grant execute on function public.save_accounting_product_name(uuid,text) to authenticated;

create or replace function public.confirm_billing_note_delivery_notes(p_billing_document_id uuid,p_delivery_note_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare bill public.accounting_documents; delivery public.accounting_documents; delivery_id uuid; selected_total numeric(14,2):=0; selected_count integer:=0;
begin
  select * into bill from public.accounting_documents where id=p_billing_document_id for update;
  if not found then raise exception 'billing_note_not_found'; end if;
  if not public.is_company_manager(bill.company_id) then raise exception 'not_authorized'; end if;
  if bill.document_type<>'billing_note' then raise exception 'billing_note_required'; end if;
  if bill.status not in ('pending','needs_correction') then raise exception 'billing_note_already_confirmed'; end if;
  if coalesce(array_length(p_delivery_note_ids,1),0)=0 then raise exception 'delivery_note_required'; end if;
  delete from public.billing_delivery_note_links where billing_document_id=bill.id;
  foreach delivery_id in array p_delivery_note_ids loop
    select * into delivery from public.accounting_documents where id=delivery_id for update;
    if not found or delivery.company_id<>bill.company_id or delivery.document_type<>'delivery_note' or delivery.status<>'confirmed' then raise exception 'invalid_delivery_note_%',delivery_id; end if;
    if lower(regexp_replace(coalesce(delivery.vendor_name,''),'\s+','','g'))<>lower(regexp_replace(coalesce(bill.vendor_name,''),'\s+','','g')) then raise exception 'delivery_note_vendor_mismatch_%',delivery_id; end if;
    insert into public.billing_delivery_note_links(company_id,billing_document_id,delivery_note_document_id,linked_by)
    values(bill.company_id,bill.id,delivery.id,auth.uid());
    selected_total:=selected_total+coalesce(delivery.total_amount,0); selected_count:=selected_count+1;
  end loop;
  update public.accounting_documents set status='confirmed',posting_status='not_posted',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=bill.id;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,after_dimensions,reason)
  values(bill.company_id,bill.id,auth.uid(),'human_review',jsonb_build_object('delivery_note_ids',p_delivery_note_ids,'delivery_note_count',selected_count,'delivery_note_total',selected_total,'billing_total',bill.total_amount,'variance',coalesce(bill.total_amount,0)-selected_total),'billing_note_multiple_delivery_notes_confirmed');
  return jsonb_build_object('status','confirmed','delivery_note_count',selected_count,'delivery_note_total',selected_total,'billing_total',bill.total_amount,'variance',coalesce(bill.total_amount,0)-selected_total);
end; $$;
grant execute on function public.confirm_billing_note_delivery_notes(uuid,uuid[]) to authenticated;
notify pgrst,'reload schema';
