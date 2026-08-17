alter table public.drawing_ai_runs drop constraint if exists drawing_ai_runs_provider_check;
alter table public.drawing_ai_runs add constraint drawing_ai_runs_provider_check
  check (provider in ('gemini','openai','anthropic','wisdom','mistral','paddleocr'));

create table if not exists public.wisdom_ai_learning_domains (
  code text primary key,
  name_th text not null,
  category text not null,
  primary_metric text not null,
  guardrail text not null,
  status text not null default 'active' check (status in ('active','planned','disabled')),
  sort_order integer not null unique
);

insert into public.wisdom_ai_learning_domains
  (code, name_th, category, primary_metric, guardrail, status, sort_order)
values
  ('file_quality', 'คุณภาพไฟล์และการหมุนหน้า', 'intake', 'readable_page_rate', 'ห้ามอ่านต่อเมื่อไฟล์เสีย', 'active', 1),
  ('project_identity', 'ชื่อและรหัสโครงการจาก Title Block', 'document', 'project_match_accuracy', 'ต้องมีหลักฐานหน้าแบบ', 'active', 2),
  ('sheet_index', 'เลขหน้า ชื่อแบบ และประเภทแบบ', 'document', 'sheet_classification_accuracy', 'ห้ามเดาประเภทแบบ', 'active', 3),
  ('ocr_notes', 'OCR หมายเหตุและข้อกำหนด', 'document', 'text_field_accuracy', 'เก็บตำแหน่งอ้างอิง', 'active', 4),
  ('legend_symbols', 'Legend และสัญลักษณ์', 'drawing', 'symbol_f1', 'สัญลักษณ์ไม่รู้จักต้องส่งตรวจ', 'active', 5),
  ('scale_geometry', 'Scale มิติ ระยะ และพื้นที่', 'drawing', 'quantity_accuracy', 'ไม่มี Scale ห้ามเดาปริมาณ', 'active', 6),
  ('architectural', 'ถอดแบบสถาปัตย์', 'discipline', 'item_recall', 'ตรวจชนิดและวัสดุแยกกัน', 'active', 7),
  ('structural_civil', 'ถอดแบบโครงสร้างและโยธา', 'discipline', 'quantity_accuracy', 'มิติต้องอ้างอิงแบบ', 'active', 8),
  ('electrical', 'ระบบไฟฟ้าและสื่อสาร', 'discipline', 'item_recall', 'ตรวจวงจร สาย ท่อ และตู้', 'active', 9),
  ('plumbing', 'ระบบสุขาภิบาล', 'discipline', 'item_recall', 'ตรวจขนาดท่อและอุปกรณ์', 'active', 10),
  ('hvac', 'ระบบปรับอากาศและระบายอากาศ', 'discipline', 'item_recall', 'ตรวจ Capacity และ Duct', 'active', 11),
  ('fire_safety', 'Fire Alarm และ Fire Protection', 'discipline', 'item_recall', 'รายการความปลอดภัยต้องให้คนยืนยัน', 'active', 12),
  ('solar_energy', 'Solar และระบบพลังงาน', 'discipline', 'item_recall', 'ตรวจ DC/AC และกำลังระบบ', 'active', 13),
  ('boq_normalization', 'รหัส BOQ หน่วย และการตัดรายการซ้ำ', 'boq', 'unit_accuracy', 'ห้ามรวม Specification ต่างกัน', 'active', 14),
  ('material_assembly', 'Material Code และ Assembly', 'cost', 'mapping_accuracy', 'Mapping ต่ำต้องส่งตรวจ', 'planned', 15),
  ('price_procurement', 'ราคา Supplier จัดซื้อ และสต็อก', 'cost', 'price_match_accuracy', 'ต้องระบุวันที่และแหล่งราคา', 'planned', 16),
  ('labour_productivity', 'แรงงาน ชั่วโมง และ Productivity', 'operations', 'hours_forecast_accuracy', 'ไม่ใช้ชื่อบุคคลอนุมานค่าแรง', 'planned', 17),
  ('cost_quality_feedback', 'ต้นทุนจริง QA Revision และ Champion', 'learning', 'verified_weighted_score', 'เรียนเฉพาะ Ground Truth ที่ยืนยันแล้ว', 'active', 18)
on conflict (code) do update set
  name_th = excluded.name_th,
  category = excluded.category,
  primary_metric = excluded.primary_metric,
  guardrail = excluded.guardrail,
  status = excluded.status,
  sort_order = excluded.sort_order;

create table if not exists public.wisdom_ai_learning_examples (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.drawing_ai_jobs(id) on delete cascade,
  domain_code text not null references public.wisdom_ai_learning_domains(code) on delete restrict,
  expected_output jsonb not null,
  source text not null default 'human_ground_truth',
  verified_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (job_id, domain_code)
);

alter table public.wisdom_ai_learning_domains enable row level security;
alter table public.wisdom_ai_learning_examples enable row level security;
create policy "Authenticated users read Wisdom learning domains" on public.wisdom_ai_learning_domains
  for select to authenticated using (true);
create policy "Authenticated users read Wisdom learning examples" on public.wisdom_ai_learning_examples
  for select to authenticated using (true);

create or replace function public.capture_wisdom_learning_examples()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_type text;
  v_domain text;
begin
  select drawing_type into v_type from public.drawing_ai_jobs where id = new.job_id;
  foreach v_domain in array array[
    'project_identity','sheet_index','ocr_notes','legend_symbols','scale_geometry',
    'boq_normalization','cost_quality_feedback',
    case
      when v_type = 'architectural' then 'architectural'
      when v_type in ('structural','civil') then 'structural_civil'
      when v_type = 'electrical' then 'electrical'
      when v_type = 'plumbing' then 'plumbing'
      when v_type = 'hvac' then 'hvac'
      when v_type = 'fire_alarm' then 'fire_safety'
      when v_type = 'solar' then 'solar_energy'
      else 'file_quality'
    end
  ]
  loop
    insert into public.wisdom_ai_learning_examples
      (job_id, domain_code, expected_output, verified_by)
    values (new.job_id, v_domain, new.items, new.verified_by)
    on conflict (job_id, domain_code) do update set
      expected_output = excluded.expected_output,
      verified_by = excluded.verified_by,
      created_at = now();
  end loop;
  return new;
end;
$$;

drop trigger if exists capture_wisdom_learning_examples_trigger on public.drawing_ai_ground_truth;
create trigger capture_wisdom_learning_examples_trigger
after insert or update on public.drawing_ai_ground_truth
for each row execute function public.capture_wisdom_learning_examples();

create or replace view public.wisdom_ai_learning_coverage
with (security_invoker = true)
as
select
  d.code, d.name_th, d.category, d.primary_metric, d.guardrail, d.status, d.sort_order,
  count(e.id)::integer as verified_examples
from public.wisdom_ai_learning_domains d
left join public.wisdom_ai_learning_examples e on e.domain_code = d.code
group by d.code, d.name_th, d.category, d.primary_metric, d.guardrail, d.status, d.sort_order;
