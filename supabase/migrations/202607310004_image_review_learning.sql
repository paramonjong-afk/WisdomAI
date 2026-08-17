create table if not exists public.image_purpose_catalog (
  code text primary key,
  name_th text not null,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.image_purpose_catalog (code, name_th, description, sort_order) values
  ('progress_report', 'รายงานงาน/ความคืบหน้า', 'รายงานสถานะหรือความคืบหน้าของงาน', 10),
  ('issue_report', 'แจ้งปัญหา/ความเสี่ยง', 'ปัญหา ความเสียหาย ความเสี่ยง หรือความปลอดภัย', 20),
  ('work_quantity', 'แจ้งปริมาณงานที่ทำ', 'ปริมาณงานพร้อมหน่วยและพื้นที่', 30),
  ('work_evidence', 'ภาพประกอบการทำงาน', 'ภาพหลักฐานหรือภาพประกอบการปฏิบัติงาน', 40),
  ('material_receipt', 'แจ้งวัสดุรับเข้า', 'วัสดุหรืออุปกรณ์ที่รับเข้าไซต์หรือสต๊อก', 50),
  ('material_issue', 'แจ้งวัสดุเบิก/จ่ายออก', 'วัสดุหรืออุปกรณ์ที่เบิกหรือนำไปใช้', 60),
  ('financial_document', 'เอกสารการเงิน/บัญชี', 'สลิป ใบเสร็จ ใบส่งของ หรือเอกสารบัญชี', 70),
  ('other', 'อื่น ๆ', 'รูปที่ยังไม่เข้าหมวดหรือมีข้อมูลไม่เพียงพอ', 80)
on conflict (code) do update set
  name_th = excluded.name_th,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists public.image_review_cases (
  id uuid primary key default gen_random_uuid(),
  source_message_id uuid not null unique references public.line_messages(id) on delete cascade,
  attachment_id uuid references public.line_attachments(id) on delete set null,
  work_summary_id uuid references public.work_summary_items(id) on delete set null,
  proposed_project_id uuid references public.projects(id) on delete set null,
  proposed_primary_purpose text not null default 'other',
  proposed_secondary_purposes text[] not null default '{}',
  proposed_output jsonb not null default '{}'::jsonb,
  ai_provider text not null default 'rules',
  ai_model text,
  ai_confidence numeric(4,3),
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  confirmed_project_id uuid references public.projects(id) on delete set null,
  confirmed_primary_purpose text,
  confirmed_secondary_purposes text[] not null default '{}',
  confirmed_output jsonb,
  review_status text not null default 'pending'
    check (review_status in ('pending','confirmed','corrected','dismissed','needs_information','forwarded')),
  review_note text,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists image_review_cases_status_idx
  on public.image_review_cases(review_status, created_at desc);
create index if not exists image_review_cases_responsible_idx
  on public.image_review_cases(responsible_profile_id, review_status);

create table if not exists public.wisdom_image_learning_samples (
  id uuid primary key default gen_random_uuid(),
  review_case_id uuid not null unique references public.image_review_cases(id) on delete cascade,
  source_message_id uuid not null references public.line_messages(id) on delete cascade,
  attachment_id uuid references public.line_attachments(id) on delete set null,
  ai_provider text not null,
  ai_model text,
  ai_confidence numeric(4,3),
  prediction jsonb not null,
  verified_label jsonb not null,
  purpose_match boolean not null,
  project_match boolean,
  training_status text not null default 'ready'
    check (training_status in ('ready','included','excluded')),
  verified_by uuid not null references public.profiles(id) on delete restrict,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wisdom_image_learning_provider_idx
  on public.wisdom_image_learning_samples(ai_provider, ai_model, verified_at desc);

alter table public.image_purpose_catalog enable row level security;
alter table public.image_review_cases enable row level security;
alter table public.wisdom_image_learning_samples enable row level security;

create policy "Authenticated users read image purposes" on public.image_purpose_catalog
for select to authenticated using (true);

create policy "Responsible users read image reviews" on public.image_review_cases
for select to authenticated using (
  public.is_work_manager() or responsible_profile_id = auth.uid()
);

create policy "Managers read Wisdom image learning" on public.wisdom_image_learning_samples
for select to authenticated using (public.is_work_manager());

create or replace function public.confirm_image_review_case(
  target_case_id uuid,
  decision text,
  primary_purpose text,
  secondary_purposes text[] default '{}',
  project_id uuid default null,
  responsible_id uuid default null,
  note text default null,
  corrected_output jsonb default null
) returns public.image_review_cases
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row public.image_review_cases;
  result_row public.image_review_cases;
  label jsonb;
begin
  select * into before_row
  from public.image_review_cases
  where id = target_case_id
  for update;

  if before_row.id is null then raise exception 'ไม่พบรายการรูปที่ต้องตรวจสอบ'; end if;
  if not public.is_work_manager() and before_row.responsible_profile_id is distinct from auth.uid() then
    raise exception 'ไม่มีสิทธิ์ยืนยันรูปนี้';
  end if;
  if decision not in ('confirmed','corrected','dismissed','needs_information','forwarded') then
    raise exception 'สถานะการยืนยันไม่ถูกต้อง';
  end if;
  if decision in ('confirmed','corrected') and coalesce(trim(primary_purpose), '') = '' then
    raise exception 'กรุณาระบุวัตถุประสงค์หลัก';
  end if;

  update public.image_review_cases set
    confirmed_project_id = project_id,
    confirmed_primary_purpose = case when decision in ('confirmed','corrected') then primary_purpose else confirmed_primary_purpose end,
    confirmed_secondary_purposes = case when decision in ('confirmed','corrected') then coalesce(secondary_purposes, '{}') else confirmed_secondary_purposes end,
    confirmed_output = coalesce(corrected_output, proposed_output),
    responsible_profile_id = coalesce(responsible_id, responsible_profile_id),
    review_status = decision,
    review_note = nullif(trim(note), ''),
    confirmed_by = case when decision in ('confirmed','corrected','dismissed') then auth.uid() else confirmed_by end,
    confirmed_at = case when decision in ('confirmed','corrected','dismissed') then now() else confirmed_at end,
    updated_at = now()
  where id = target_case_id
  returning * into result_row;

  if result_row.work_summary_id is not null and decision in ('confirmed','corrected','dismissed') then
    update public.work_summary_items as summary set
      status = case when decision = 'dismissed' then 'dismissed' else 'confirmed' end,
      project_id = coalesce($5, summary.project_id),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
    where id = result_row.work_summary_id;
  end if;

  if decision in ('confirmed','corrected') then
    label := jsonb_build_object(
      'primary_purpose', result_row.confirmed_primary_purpose,
      'secondary_purposes', result_row.confirmed_secondary_purposes,
      'project_id', result_row.confirmed_project_id,
      'output', result_row.confirmed_output
    );
    insert into public.wisdom_image_learning_samples (
      review_case_id, source_message_id, attachment_id,
      ai_provider, ai_model, ai_confidence, prediction, verified_label,
      purpose_match, project_match, training_status, verified_by, verified_at
    ) values (
      result_row.id, result_row.source_message_id, result_row.attachment_id,
      result_row.ai_provider, result_row.ai_model, result_row.ai_confidence,
      result_row.proposed_output, label,
      result_row.proposed_primary_purpose = result_row.confirmed_primary_purpose,
      case
        when result_row.proposed_project_id is null and result_row.confirmed_project_id is null then true
        when result_row.proposed_project_id is null or result_row.confirmed_project_id is null then false
        else result_row.proposed_project_id = result_row.confirmed_project_id
      end,
      'ready', auth.uid(), now()
    )
    on conflict (review_case_id) do update set
      ai_provider = excluded.ai_provider,
      ai_model = excluded.ai_model,
      ai_confidence = excluded.ai_confidence,
      prediction = excluded.prediction,
      verified_label = excluded.verified_label,
      purpose_match = excluded.purpose_match,
      project_match = excluded.project_match,
      training_status = 'ready',
      verified_by = auth.uid(),
      verified_at = now(),
      updated_at = now();
  end if;

  return result_row;
end;
$$;

grant execute on function public.confirm_image_review_case(
  uuid, text, text, text[], uuid, uuid, text, jsonb
) to authenticated;

create or replace view public.wisdom_image_ai_scorecard
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
  round(avg(ai_confidence)::numeric, 4) as average_confidence,
  max(verified_at) as last_verified_at
from public.wisdom_image_learning_samples
where training_status <> 'excluded'
group by ai_provider, ai_model;

grant select on public.wisdom_image_ai_scorecard to authenticated;

insert into public.image_review_cases (
  source_message_id, attachment_id, work_summary_id, proposed_project_id,
  proposed_primary_purpose, proposed_output, ai_provider, ai_model, ai_confidence,
  review_status, confirmed_project_id, confirmed_primary_purpose, confirmed_output,
  confirmed_by, confirmed_at
)
select
  summary.source_message_id,
  attachment.id,
  summary.id,
  summary.project_id,
  case summary.category
    when 'completed' then 'progress_report'
    when 'in_progress' then 'progress_report'
    when 'planned' then 'progress_report'
    when 'issue' then 'issue_report'
    when 'risk' then 'issue_report'
    when 'safety' then 'issue_report'
    when 'material' then 'other'
    else 'other'
  end,
  jsonb_build_object(
    'category', summary.category,
    'summary_text', summary.summary_text,
    'assignee_text', summary.assignee_text,
    'urgency', summary.urgency
  ),
  summary.analysis_provider,
  summary.analysis_model,
  summary.analysis_confidence,
  case summary.status when 'confirmed' then 'confirmed' when 'dismissed' then 'dismissed' else 'pending' end,
  case when summary.status = 'confirmed' then summary.project_id else null end,
  case when summary.status = 'confirmed' then
    case summary.category
      when 'completed' then 'progress_report'
      when 'in_progress' then 'progress_report'
      when 'planned' then 'progress_report'
      when 'issue' then 'issue_report'
      when 'risk' then 'issue_report'
      when 'safety' then 'issue_report'
      else 'other'
    end
  else null end,
  case when summary.status = 'confirmed' then jsonb_build_object(
    'category', summary.category,
    'summary_text', summary.summary_text,
    'assignee_text', summary.assignee_text,
    'urgency', summary.urgency
  ) else null end,
  summary.reviewed_by,
  summary.reviewed_at
from public.work_summary_items summary
join public.line_messages message on message.id = summary.source_message_id and message.message_type = 'image'
left join lateral (
  select item.id from public.line_attachments item
  where item.message_id = summary.source_message_id
  order by item.created_at
  limit 1
) attachment on true
on conflict (source_message_id) do nothing;
