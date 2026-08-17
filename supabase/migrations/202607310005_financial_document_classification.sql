create table if not exists public.financial_document_type_catalog (
  code text primary key,
  name_th text not null,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.financial_document_type_catalog (code, name_th, description, sort_order) values
  ('transfer_slip', 'สลิปโอนเงิน', 'หลักฐานการโอนหรือชำระเงินผ่านธนาคาร', 10),
  ('receipt', 'ใบเสร็จรับเงิน', 'หลักฐานรับชำระเงิน', 20),
  ('tax_invoice_full', 'ใบกำกับภาษีเต็มรูป', 'ใบกำกับภาษีที่มีข้อมูลผู้ซื้อและผู้ขายครบถ้วน', 30),
  ('tax_invoice_abbreviated', 'ใบกำกับภาษีอย่างย่อ', 'ใบกำกับภาษีอย่างย่อหรือใบกำกับจากเครื่องบันทึกเงินสด', 40),
  ('quotation', 'ใบเสนอราคา', 'ข้อเสนอราคา ยังไม่ถือเป็นค่าใช้จ่ายที่ชำระแล้ว', 50),
  ('purchase_order', 'ใบสั่งซื้อ', 'เอกสารอนุมัติหรือสั่งซื้อสินค้าและบริการ', 60),
  ('invoice', 'ใบแจ้งหนี้', 'เอกสารเรียกเก็บเงิน', 70),
  ('billing_note', 'ใบวางบิล', 'เอกสารรวบรวมรายการเพื่อขอรับชำระ', 80),
  ('delivery_note', 'ใบส่งของ', 'หลักฐานส่งมอบสินค้า', 90),
  ('goods_receipt', 'ใบรับสินค้า', 'หลักฐานตรวจรับสินค้าหรือวัสดุ', 100),
  ('withholding_tax_certificate', 'หนังสือรับรองหัก ณ ที่จ่าย', 'เอกสารภาษีหัก ณ ที่จ่าย', 110),
  ('payroll', 'เอกสารเงินเดือน/ค่าจ้าง', 'สลิปเงินเดือน ค่าแรง หรือค่าจ้าง', 120),
  ('other', 'เอกสารการเงินอื่น', 'เอกสารเกี่ยวข้องกับการเงินที่ไม่อยู่ในชนิดที่กำหนด', 130),
  ('unreadable', 'อ่านชนิดเอกสารไม่ได้', 'ภาพไม่ชัดหรือข้อมูลไม่เพียงพอ', 140)
on conflict (code) do update set
  name_th = excluded.name_th,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table public.financial_document_type_catalog enable row level security;
create policy "Authenticated users read financial document types"
on public.financial_document_type_catalog for select to authenticated using (true);

alter table public.image_review_cases
  add column if not exists proposed_document_type text,
  add column if not exists confirmed_document_type text;

alter table public.wisdom_image_learning_samples
  add column if not exists document_type_match boolean;

update public.image_review_cases
set proposed_document_type = coalesce(
  nullif(proposed_output #>> '{accounting_document,document_type}', ''),
  case when (proposed_output #>> '{financial_document,is_transfer_slip}')::boolean is true
    then 'transfer_slip' end
)
where proposed_primary_purpose = 'financial_document'
  and proposed_document_type is null;

create or replace function public.confirm_image_review_case_v2(
  target_case_id uuid,
  decision text,
  primary_purpose text,
  secondary_purposes text[] default '{}',
  project_id uuid default null,
  responsible_id uuid default null,
  note text default null,
  corrected_output jsonb default null,
  document_type text default null
) returns public.image_review_cases
language plpgsql
security definer
set search_path = public
as $$
declare
  result_row public.image_review_cases;
  valid_document_type boolean;
begin
  if primary_purpose = 'financial_document' and decision in ('confirmed','corrected') then
    select exists (
      select 1 from public.financial_document_type_catalog
      where code = document_type and active
    ) into valid_document_type;
    if not valid_document_type then
      raise exception 'กรุณาระบุชนิดเอกสารการเงิน';
    end if;
  end if;

  select * into result_row from public.confirm_image_review_case(
    target_case_id, decision, primary_purpose, secondary_purposes,
    project_id, responsible_id, note, corrected_output
  );

  update public.image_review_cases set
    confirmed_document_type = case
      when decision in ('confirmed','corrected') and primary_purpose = 'financial_document'
        then document_type
      when decision in ('confirmed','corrected') then null
      else confirmed_document_type
    end,
    updated_at = now()
  where id = target_case_id
  returning * into result_row;

  if decision in ('confirmed','corrected') then
    update public.wisdom_image_learning_samples set
      document_type_match = case
        when primary_purpose <> 'financial_document' then null
        else result_row.proposed_document_type is not distinct from result_row.confirmed_document_type
      end,
      verified_label = verified_label || jsonb_build_object(
        'document_type', result_row.confirmed_document_type
      ),
      updated_at = now()
    where review_case_id = target_case_id;
  end if;

  return result_row;
end;
$$;

grant execute on function public.confirm_image_review_case_v2(
  uuid, text, text, text[], uuid, uuid, text, jsonb, text
) to authenticated;

drop view if exists public.wisdom_image_ai_scorecard;
create view public.wisdom_image_ai_scorecard
with (security_invoker = true)
as
select
  ai_provider,
  coalesce(ai_model, 'unknown') as ai_model,
  count(*)::integer as reviewed_samples,
  count(*) filter (where purpose_match)::integer as correct_purpose,
  round(avg(case when purpose_match then 1 else 0 end)::numeric, 4) as purpose_accuracy,
  count(*) filter (where project_match is not null)::integer as project_samples,
  round((avg(case when project_match then 1 else 0 end)
    filter (where project_match is not null))::numeric, 4) as project_accuracy,
  count(*) filter (where document_type_match is not null)::integer as document_type_samples,
  round((avg(case when document_type_match then 1 else 0 end)
    filter (where document_type_match is not null))::numeric, 4) as document_type_accuracy,
  round(avg(ai_confidence)::numeric, 4) as average_confidence,
  max(verified_at) as last_verified_at
from public.wisdom_image_learning_samples
where training_status <> 'excluded'
group by ai_provider, ai_model;

grant select on public.wisdom_image_ai_scorecard to authenticated;
