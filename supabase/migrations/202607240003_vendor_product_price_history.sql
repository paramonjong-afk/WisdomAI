-- Vendor/product price history is populated only from reviewed documents.
-- This keeps unverified OCR/Gemini output out of purchasing master data.

create table if not exists public.vendor_product_prices (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  document_id uuid not null references public.accounting_documents(id) on delete cascade,
  document_line_id uuid not null references public.accounting_document_lines(id) on delete cascade,
  observed_at date not null,
  quantity numeric(14,3),
  unit text,
  stated_unit_price numeric(14,4),
  effective_unit_price numeric(14,4) not null check (effective_unit_price >= 0),
  currency text not null default 'THB',
  price_basis text not null default 'actual'
    check (price_basis in ('actual', 'quotation', 'purchase_order')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_line_id)
);

create index if not exists vendor_product_prices_item_date_idx
  on public.vendor_product_prices(inventory_item_id, observed_at desc);
create index if not exists vendor_product_prices_vendor_date_idx
  on public.vendor_product_prices(vendor_id, observed_at desc);
create index if not exists vendor_product_prices_compare_idx
  on public.vendor_product_prices(inventory_item_id, unit, effective_unit_price);

alter table public.vendor_product_prices enable row level security;

create policy "Authenticated users read vendor prices"
  on public.vendor_product_prices
  for select to authenticated using (true);

create policy "Managers maintain vendor prices"
  on public.vendor_product_prices
  for all to authenticated
  using (public.is_work_manager())
  with check (public.is_work_manager());

create or replace function public.capture_confirmed_document_prices(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.accounting_documents;
  v_line public.accounting_document_lines;
  v_vendor_id uuid;
  v_item_id uuid;
  v_normalized_name text;
  v_effective_price numeric(14,4);
  v_basis text;
begin
  select * into v_document
  from public.accounting_documents
  where id = p_document_id and status = 'confirmed';

  if not found then
    return;
  end if;

  -- Match a vendor by tax ID first, then by a normalized display name.
  if nullif(trim(coalesce(v_document.vendor_tax_id, '')), '') is not null then
    select id into v_vendor_id
    from public.vendors
    where tax_id = trim(v_document.vendor_tax_id)
    order by created_at
    limit 1;
  end if;

  if v_vendor_id is null
    and nullif(trim(coalesce(v_document.vendor_name, '')), '') is not null then
    select id into v_vendor_id
    from public.vendors
    where lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
      = lower(regexp_replace(trim(v_document.vendor_name), '\s+', ' ', 'g'))
    order by created_at
    limit 1;
  end if;

  if v_vendor_id is null
    and nullif(trim(coalesce(v_document.vendor_name, '')), '') is not null then
    insert into public.vendors(name, tax_id)
    values (
      trim(v_document.vendor_name),
      nullif(trim(coalesce(v_document.vendor_tax_id, '')), '')
    )
    returning id into v_vendor_id;
  end if;

  if v_vendor_id is null then
    -- A price without an identified vendor cannot be used for comparison.
    return;
  end if;

  update public.accounting_documents
  set vendor_id = v_vendor_id, updated_at = now()
  where id = p_document_id and vendor_id is distinct from v_vendor_id;

  v_basis := case v_document.document_type
    when 'quotation' then 'quotation'
    when 'purchase_order' then 'purchase_order'
    else 'actual'
  end;

  for v_line in
    select *
    from public.accounting_document_lines
    where document_id = p_document_id
      and item_type in ('stock', 'direct_project', 'tool_asset')
      and nullif(trim(description), '') is not null
      and coalesce(quantity, 0) > 0
      and (unit_price is not null or line_amount is not null)
  loop
    v_normalized_name := lower(regexp_replace(trim(v_line.description), '\s+', ' ', 'g'));
    v_item_id := null;

    if nullif(trim(coalesce(v_line.product_code, '')), '') is not null then
      select id into v_item_id
      from public.inventory_items
      where product_code = trim(v_line.product_code)
      order by created_at
      limit 1;
    end if;

    if v_item_id is null then
      insert into public.inventory_items(
        name, normalized_name, product_code, unit, item_kind
      )
      values (
        trim(v_line.description),
        v_normalized_name,
        nullif(trim(coalesce(v_line.product_code, '')), ''),
        nullif(trim(coalesce(v_line.unit, '')), ''),
        case when v_line.item_type = 'tool_asset' then 'equipment' else 'material' end
      )
      on conflict (normalized_name) do update set
        product_code = coalesce(excluded.product_code, public.inventory_items.product_code),
        unit = coalesce(excluded.unit, public.inventory_items.unit),
        updated_at = now()
      returning id into v_item_id;
    end if;

    update public.accounting_document_lines
    set inventory_item_id = v_item_id, updated_at = now()
    where id = v_line.id and inventory_item_id is distinct from v_item_id;

    v_effective_price := case
      when v_line.line_amount is not null and v_line.quantity > 0
        then round((v_line.line_amount / v_line.quantity)::numeric, 4)
      else round(v_line.unit_price::numeric, 4)
    end;

    if v_effective_price is not null then
      insert into public.vendor_product_prices(
        inventory_item_id, vendor_id, document_id, document_line_id,
        observed_at, quantity, unit, stated_unit_price,
        effective_unit_price, currency, price_basis
      )
      values (
        v_item_id, v_vendor_id, p_document_id, v_line.id,
        coalesce(v_document.document_date, v_document.created_at::date),
        v_line.quantity, nullif(trim(coalesce(v_line.unit, '')), ''),
        v_line.unit_price, v_effective_price,
        coalesce(nullif(trim(v_document.currency), ''), 'THB'), v_basis
      )
      on conflict (document_line_id) do update set
        inventory_item_id = excluded.inventory_item_id,
        vendor_id = excluded.vendor_id,
        observed_at = excluded.observed_at,
        quantity = excluded.quantity,
        unit = excluded.unit,
        stated_unit_price = excluded.stated_unit_price,
        effective_unit_price = excluded.effective_unit_price,
        currency = excluded.currency,
        price_basis = excluded.price_basis,
        updated_at = now();
    end if;
  end loop;
end;
$$;

revoke all on function public.capture_confirmed_document_prices(uuid) from public;
revoke all on function public.capture_confirmed_document_prices(uuid) from authenticated;

create or replace function public.capture_prices_after_document_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.capture_confirmed_document_prices(new.id);
  return new;
end;
$$;

drop trigger if exists capture_prices_after_confirmation
  on public.accounting_documents;
create trigger capture_prices_after_confirmation
after update of status on public.accounting_documents
for each row
when (new.status = 'confirmed' and old.status is distinct from new.status)
execute function public.capture_prices_after_document_confirmation();

-- Include already-confirmed documents when this migration is first deployed.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.accounting_documents where status = 'confirmed'
  loop
    perform public.capture_confirmed_document_prices(v_id);
  end loop;
end;
$$;

create or replace view public.vendor_price_comparison
with (security_invoker = true)
as
with latest as (
  select distinct on (price.inventory_item_id, price.vendor_id, coalesce(price.unit, ''))
    price.inventory_item_id,
    price.vendor_id,
    price.unit,
    price.effective_unit_price as latest_unit_price,
    price.observed_at as latest_price_date,
    price.document_id as latest_document_id,
    price.price_basis
  from public.vendor_product_prices price
  order by price.inventory_item_id, price.vendor_id, coalesce(price.unit, ''),
    price.observed_at desc, price.created_at desc
),
history as (
  select
    price.inventory_item_id,
    price.vendor_id,
    price.unit,
    min(price.effective_unit_price)::numeric(14,4) as historical_min_price,
    avg(price.effective_unit_price)::numeric(14,4) as average_unit_price,
    count(*)::bigint as observation_count
  from public.vendor_product_prices price
  group by price.inventory_item_id, price.vendor_id, price.unit
),
compared as (
  select
    latest.inventory_item_id,
    item.name as product_name,
    item.product_code,
    latest.vendor_id,
    vendor.name as vendor_name,
    vendor.tax_id as vendor_tax_id,
    latest.unit,
    latest.latest_unit_price,
    history.historical_min_price,
    history.average_unit_price,
    latest.latest_price_date,
    history.observation_count,
    latest.latest_document_id,
    latest.price_basis,
    dense_rank() over (
      partition by latest.inventory_item_id, coalesce(latest.unit, '')
      order by latest.latest_unit_price asc
    ) as price_rank
  from latest
  join history
    on history.inventory_item_id = latest.inventory_item_id
    and history.vendor_id = latest.vendor_id
    and history.unit is not distinct from latest.unit
  join public.inventory_items item on item.id = latest.inventory_item_id
  join public.vendors vendor on vendor.id = latest.vendor_id
)
select *, price_rank = 1 as is_cheapest
from compared;

grant select on public.vendor_product_prices to authenticated;
grant select on public.vendor_price_comparison to authenticated;
