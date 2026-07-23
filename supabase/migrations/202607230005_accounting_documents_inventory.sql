create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_id text,
  address text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vendors_tax_id_unique
  on public.vendors(tax_id) where tax_id is not null and tax_id <> '';

create table if not exists public.accounting_documents (
  id uuid primary key default gen_random_uuid(),
  source_message_id uuid not null unique references public.line_messages(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  document_type text not null default 'other'
    check (document_type in (
      'transfer_slip', 'receipt', 'tax_invoice_full', 'tax_invoice_abbreviated',
      'quotation', 'purchase_order', 'invoice', 'billing_note', 'delivery_note',
      'goods_receipt', 'withholding_tax_certificate', 'payroll', 'other', 'unreadable'
    )),
  document_number text,
  document_date date,
  due_date date,
  vendor_name text,
  vendor_tax_id text,
  subtotal numeric(14, 2),
  discount_amount numeric(14, 2),
  vat_amount numeric(14, 2),
  withholding_tax_amount numeric(14, 2),
  total_amount numeric(14, 2),
  paid_amount numeric(14, 2),
  currency text not null default 'THB',
  payment_method text,
  image_sha256 text not null,
  dedupe_key text,
  duplicate_of uuid references public.accounting_documents(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'duplicate', 'dismissed', 'needs_correction')),
  posting_status text not null default 'not_posted'
    check (posting_status in ('not_posted', 'draft', 'posted')),
  notes text,
  analysis_provider text not null default 'gemini',
  analysis_model text,
  analysis_confidence numeric(4, 3),
  analysis_error text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (duplicate_of is null or status = 'duplicate')
);

create table if not exists public.accounting_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.accounting_documents(id) on delete cascade,
  line_number integer not null,
  description text not null,
  product_code text,
  quantity numeric(14, 3),
  unit text,
  unit_price numeric(14, 2),
  line_amount numeric(14, 2),
  item_type text not null default 'unknown'
    check (item_type in ('stock', 'direct_project', 'tool_asset', 'expense', 'service', 'labor', 'unknown')),
  inventory_item_id uuid,
  project_id uuid references public.projects(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, line_number)
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  product_code text,
  unit text,
  item_kind text not null default 'material'
    check (item_kind in ('material', 'equipment', 'consumable', 'tool')),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accounting_document_lines
  drop constraint if exists accounting_document_lines_inventory_item_id_fkey;
alter table public.accounting_document_lines
  add constraint accounting_document_lines_inventory_item_id_fkey
  foreign key (inventory_item_id) references public.inventory_items(id) on delete set null;

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  document_line_id uuid references public.accounting_document_lines(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  movement_type text not null check (movement_type in ('receipt', 'issue', 'adjustment', 'return')),
  quantity numeric(14, 3) not null,
  unit_cost numeric(14, 2),
  occurred_at timestamptz not null default now(),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists inventory_movement_document_line_unique
  on public.inventory_movements(document_line_id)
  where document_line_id is not null and movement_type = 'receipt';

create table if not exists public.accounting_draft_entries (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.accounting_documents(id) on delete cascade,
  line_number integer not null,
  account_code text not null,
  account_name text not null,
  debit numeric(14, 2) not null default 0,
  credit numeric(14, 2) not null default 0,
  project_id uuid references public.projects(id) on delete set null,
  description text,
  created_at timestamptz not null default now(),
  unique (document_id, line_number),
  check (debit >= 0 and credit >= 0),
  check (not (debit > 0 and credit > 0))
);

create index if not exists accounting_documents_date_idx
  on public.accounting_documents(document_date desc, created_at desc);
create index if not exists accounting_documents_dedupe_idx
  on public.accounting_documents(dedupe_key) where dedupe_key is not null;
create index if not exists accounting_documents_hash_idx
  on public.accounting_documents(image_sha256);
create index if not exists accounting_document_lines_document_idx
  on public.accounting_document_lines(document_id, line_number);
create index if not exists inventory_movements_item_time_idx
  on public.inventory_movements(inventory_item_id, occurred_at desc);

alter table public.vendors enable row level security;
alter table public.accounting_documents enable row level security;
alter table public.accounting_document_lines enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.accounting_draft_entries enable row level security;

create policy "Authenticated users read vendors" on public.vendors
  for select to authenticated using (true);
create policy "Authenticated users read accounting documents" on public.accounting_documents
  for select to authenticated using (true);
create policy "Authenticated users read accounting document lines" on public.accounting_document_lines
  for select to authenticated using (true);
create policy "Authenticated users read inventory items" on public.inventory_items
  for select to authenticated using (true);
create policy "Authenticated users read inventory movements" on public.inventory_movements
  for select to authenticated using (true);
create policy "Authenticated users read accounting drafts" on public.accounting_draft_entries
  for select to authenticated using (true);

create policy "Managers maintain vendors" on public.vendors
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers review accounting documents" on public.accounting_documents
  for update to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers correct accounting lines" on public.accounting_document_lines
  for update to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers maintain inventory items" on public.inventory_items
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());

create or replace function public.confirm_accounting_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.accounting_documents;
  v_line public.accounting_document_lines;
  v_item_id uuid;
  v_line_no integer := 0;
  v_debit_total numeric(14,2) := 0;
  v_credit_total numeric(14,2) := 0;
  v_account_code text;
  v_account_name text;
begin
  if not public.is_work_manager() then
    raise exception 'Only an admin or manager can confirm accounting documents';
  end if;

  select * into v_document
  from public.accounting_documents
  where id = p_document_id
  for update;

  if not found then raise exception 'Document not found'; end if;
  if v_document.status <> 'pending' then raise exception 'Only pending documents can be confirmed'; end if;
  if v_document.duplicate_of is not null then raise exception 'Duplicate documents cannot be confirmed'; end if;
  if exists (
    select 1 from public.accounting_document_lines
    where document_id = p_document_id and item_type = 'unknown'
  ) then
    raise exception 'Classify all document lines before confirmation';
  end if;
  if v_document.total_amount is null then
    raise exception 'Document total is required';
  end if;
  if v_document.subtotal is not null
    and abs(
      (v_document.subtotal - coalesce(v_document.discount_amount, 0)
        + coalesce(v_document.vat_amount, 0)
        - coalesce(v_document.withholding_tax_amount, 0))
      - v_document.total_amount
    ) > 1 then
    raise exception 'Document totals do not reconcile';
  end if;

  delete from public.accounting_draft_entries where document_id = p_document_id;

  for v_line in
    select * from public.accounting_document_lines
    where document_id = p_document_id order by line_number
  loop
    v_line_no := v_line_no + 1;
    if v_line.item_type = 'stock' then
      insert into public.inventory_items(name, normalized_name, product_code, unit, item_kind)
      values (
        v_line.description,
        lower(regexp_replace(trim(v_line.description), '\s+', ' ', 'g')),
        v_line.product_code,
        v_line.unit,
        'material'
      )
      on conflict (normalized_name) do update set
        product_code = coalesce(excluded.product_code, public.inventory_items.product_code),
        unit = coalesce(excluded.unit, public.inventory_items.unit),
        updated_at = now()
      returning id into v_item_id;

      update public.accounting_document_lines
      set inventory_item_id = v_item_id, updated_at = now()
      where id = v_line.id;

      if coalesce(v_line.quantity, 0) <= 0 then
        raise exception 'Stock quantity must be greater than zero';
      end if;
      insert into public.inventory_movements(
        inventory_item_id, document_line_id, project_id, movement_type,
        quantity, unit_cost, occurred_at, notes, created_by
      ) values (
        v_item_id, v_line.id, coalesce(v_line.project_id, v_document.project_id),
        'receipt', v_line.quantity, v_line.unit_price,
        coalesce(v_document.document_date::timestamptz, now()),
        'รับเข้าจากเอกสาร ' || coalesce(v_document.document_number, v_document.id::text),
        auth.uid()
      ) on conflict do nothing;
      v_account_code := '1200'; v_account_name := 'สินค้าคงเหลือ';
    elsif v_line.item_type = 'direct_project' then
      v_account_code := '5100'; v_account_name := 'วัสดุใช้ในโครงการ';
    elsif v_line.item_type = 'tool_asset' then
      v_account_code := '1500'; v_account_name := 'เครื่องมือและอุปกรณ์';
    elsif v_line.item_type = 'service' then
      v_account_code := '5300'; v_account_name := 'ค่าบริการ';
    elsif v_line.item_type = 'labor' then
      v_account_code := '5400'; v_account_name := 'ค่าแรงงาน';
    else
      v_account_code := '5200'; v_account_name := 'ค่าใช้จ่ายดำเนินงาน';
    end if;

    insert into public.accounting_draft_entries(
      document_id, line_number, account_code, account_name, debit, credit,
      project_id, description
    ) values (
      p_document_id, v_line_no, v_account_code, v_account_name,
      coalesce(v_line.line_amount, 0), 0,
      coalesce(v_line.project_id, v_document.project_id), v_line.description
    );
    v_debit_total := v_debit_total + coalesce(v_line.line_amount, 0);
  end loop;

  if coalesce(v_document.vat_amount, 0) > 0 then
    v_line_no := v_line_no + 1;
    insert into public.accounting_draft_entries(
      document_id, line_number, account_code, account_name, debit, credit, project_id, description
    ) values (
      p_document_id, v_line_no, '1150', 'ภาษีซื้อ',
      v_document.vat_amount, 0, v_document.project_id, 'ภาษีมูลค่าเพิ่ม'
    );
    v_debit_total := v_debit_total + v_document.vat_amount;
  end if;

  v_line_no := v_line_no + 1;
  insert into public.accounting_draft_entries(
    document_id, line_number, account_code, account_name, debit, credit, project_id, description
  ) values (
    p_document_id, v_line_no, '2100', 'เจ้าหนี้การค้า',
    0, v_document.total_amount, v_document.project_id,
    coalesce(v_document.vendor_name, 'เจ้าหนี้ตามเอกสาร')
  );
  v_credit_total := v_document.total_amount;

  if coalesce(v_document.withholding_tax_amount, 0) > 0 then
    v_line_no := v_line_no + 1;
    insert into public.accounting_draft_entries(
      document_id, line_number, account_code, account_name, debit, credit, project_id, description
    ) values (
      p_document_id, v_line_no, '2150', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย',
      0, v_document.withholding_tax_amount, v_document.project_id, 'ภาษีหัก ณ ที่จ่าย'
    );
    v_credit_total := v_credit_total + v_document.withholding_tax_amount;
  end if;

  if abs(v_debit_total - v_credit_total) > 0.01 then
    raise exception 'Accounting draft is not balanced: debit %, credit %', v_debit_total, v_credit_total;
  end if;

  update public.accounting_documents
  set status = 'confirmed', posting_status = 'draft',
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_document_id;
end;
$$;

grant execute on function public.confirm_accounting_document(uuid) to authenticated;

create or replace view public.inventory_balances
with (security_invoker = true)
as
select
  item.id, item.name, item.product_code, item.unit, item.item_kind, item.status,
  coalesce(sum(
    case movement.movement_type
      when 'receipt' then movement.quantity
      when 'return' then movement.quantity
      when 'issue' then -movement.quantity
      else movement.quantity
    end
  ), 0)::numeric(14,3) as balance_quantity,
  coalesce(
    sum(case when movement.movement_type = 'receipt'
      then movement.quantity * coalesce(movement.unit_cost, 0) else 0 end)
    / nullif(sum(case when movement.movement_type = 'receipt'
      then movement.quantity else 0 end), 0),
    0
  )::numeric(14,2) as average_unit_cost,
  max(movement.occurred_at) as last_movement_at
from public.inventory_items item
left join public.inventory_movements movement on movement.inventory_item_id = item.id
group by item.id;

grant select on public.inventory_balances to authenticated;
