-- Actual price history must use accepted receipt quantities, including split variants.
create or replace function public.capture_actual_received_product_prices()
returns trigger language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents;review_line record;vendor_value uuid;item_value uuid;effective_price numeric(14,4);
begin
  if new.status<>'confirmed' or old.status is not distinct from new.status or new.document_type<>'goods_receipt' then return new;end if;
  doc:=new;
  vendor_value:=doc.vendor_id;
  if vendor_value is null and coalesce(trim(doc.vendor_name),'')<>'' then
    select id into vendor_value from public.vendors where lower(regexp_replace(trim(name),'\s+',' ','g'))=lower(regexp_replace(trim(doc.vendor_name),'\s+',' ','g')) order by created_at limit 1;
    if vendor_value is null then insert into public.vendors(name,tax_id) values(trim(doc.vendor_name),nullif(trim(doc.vendor_tax_id),'')) returning id into vendor_value;end if;
    update public.accounting_documents set vendor_id=vendor_value where id=doc.id;
  end if;
  if vendor_value is null then return new;end if;
  for review_line in
    select l.*,r.received_quantity from public.accounting_document_lines l join public.goods_receipt_line_reviews r on r.document_line_id=l.id
    join public.goods_receipt_reviews gr on gr.id=r.review_id where l.document_id=doc.id and r.accepted and r.received_quantity>0
  loop
    item_value:=review_line.inventory_item_id;
    if item_value is null then
      insert into public.inventory_items(name,normalized_name,product_code,unit,item_kind)
      values(trim(review_line.description),lower(regexp_replace(trim(review_line.description),'\s+',' ','g')),review_line.product_code,review_line.unit,'material')
      on conflict(normalized_name) do update set product_code=coalesce(excluded.product_code,public.inventory_items.product_code),unit=coalesce(excluded.unit,public.inventory_items.unit),updated_at=now() returning id into item_value;
      update public.accounting_document_lines set inventory_item_id=item_value,updated_at=now() where id=review_line.id;
    end if;
    effective_price:=coalesce(review_line.unit_price,case when coalesce(review_line.quantity,0)>0 then review_line.line_amount/review_line.quantity end,0);
    insert into public.vendor_product_prices(company_id,inventory_item_id,vendor_id,document_id,document_line_id,observed_at,quantity,unit,stated_unit_price,effective_unit_price,currency,price_basis)
    values(doc.company_id,item_value,vendor_value,doc.id,review_line.id,coalesce(doc.document_date,doc.created_at::date),review_line.received_quantity,review_line.unit,review_line.unit_price,effective_price,doc.currency,'actual')
    on conflict(document_line_id) do update set company_id=excluded.company_id,inventory_item_id=excluded.inventory_item_id,vendor_id=excluded.vendor_id,observed_at=excluded.observed_at,quantity=excluded.quantity,unit=excluded.unit,stated_unit_price=excluded.stated_unit_price,effective_unit_price=excluded.effective_unit_price,currency=excluded.currency,price_basis='actual',updated_at=now();
  end loop;
  return new;
end;$$;
drop trigger if exists zz_capture_actual_received_product_prices on public.accounting_documents;
create trigger zz_capture_actual_received_product_prices after update of status on public.accounting_documents for each row execute function public.capture_actual_received_product_prices();
notify pgrst,'reload schema';
