alter table public.image_review_cases
  add column if not exists wisdom_output jsonb not null default '{}'::jsonb,
  add column if not exists wisdom_confidence numeric(4,3),
  add column if not exists verified_field_count integer not null default 0,
  add column if not exists corrected_field_count integer not null default 0,
  add column if not exists missing_field_count integer not null default 0;

create table if not exists public.image_ai_observations (
  id uuid primary key default gen_random_uuid(),
  review_case_id uuid not null references public.image_review_cases(id) on delete cascade,
  provider text not null,
  model text not null,
  role text not null check (role in ('vision','ocr','classifier','ensemble')),
  result jsonb not null default '{}'::jsonb,
  confidence numeric(4,3),
  status text not null default 'completed' check (status in ('queued','processing','completed','failed','unavailable')),
  latency_ms integer,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_case_id, provider, model, role)
);

create table if not exists public.image_review_field_checks (
  id uuid primary key default gen_random_uuid(),
  review_case_id uuid not null references public.image_review_cases(id) on delete cascade,
  field_key text not null,
  field_label text not null,
  ai_value jsonb,
  verified_value jsonb,
  verdict text not null check (verdict in ('correct','corrected','unreadable','missing','not_applicable')),
  confidence numeric(4,3),
  verified_by uuid not null references public.profiles(id) on delete restrict,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_case_id, field_key)
);

create table if not exists public.wisdom_image_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  status text not null default 'draft' check (status in ('draft','training','testing','awaiting_approval','active','retired')),
  training_sample_count integer not null default 0,
  validation_sample_count integer not null default 0,
  test_sample_count integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  notes text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.online_training_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  license_name text not null,
  license_url text,
  allowed_use text not null,
  status text not null default 'pending_review' check (status in ('pending_review','approved','paused','rejected')),
  daily_limit integer not null default 0 check (daily_limit between 0 and 200),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.online_training_queue (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.online_training_sources(id) on delete cascade,
  source_url text not null,
  license_snapshot jsonb not null default '{}'::jsonb,
  content_hash text,
  status text not null default 'queued'
    check (status in ('queued','processing','quarantined','ready_for_review','approved','rejected','failed')),
  rejection_reason text,
  metadata jsonb not null default '{}'::jsonb,
  queued_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_url)
);

create index if not exists image_ai_observations_case_idx
  on public.image_ai_observations(review_case_id, provider);
create index if not exists image_review_field_checks_case_idx
  on public.image_review_field_checks(review_case_id, verdict);
create index if not exists online_training_queue_daily_idx
  on public.online_training_queue(queued_at desc, status);

alter table public.image_ai_observations enable row level security;
alter table public.image_review_field_checks enable row level security;
alter table public.wisdom_image_releases enable row level security;
alter table public.online_training_sources enable row level security;
alter table public.online_training_queue enable row level security;

create policy "Responsible users read image AI observations"
on public.image_ai_observations for select to authenticated using (
  exists (
    select 1 from public.image_review_cases review
    where review.id = review_case_id
      and (public.is_work_manager() or review.responsible_profile_id = auth.uid())
  )
);
create policy "Managers maintain image AI observations"
on public.image_ai_observations for all to authenticated
using (public.is_work_manager()) with check (public.is_work_manager());

create policy "Responsible users read image field checks"
on public.image_review_field_checks for select to authenticated using (
  exists (
    select 1 from public.image_review_cases review
    where review.id = review_case_id
      and (public.is_work_manager() or review.responsible_profile_id = auth.uid())
  )
);
create policy "Managers maintain image field checks"
on public.image_review_field_checks for all to authenticated
using (public.is_work_manager()) with check (public.is_work_manager());

create policy "Authenticated users read Wisdom releases"
on public.wisdom_image_releases for select to authenticated using (true);
create policy "Managers maintain Wisdom releases"
on public.wisdom_image_releases for all to authenticated
using (public.is_work_manager()) with check (public.is_work_manager());

create policy "Managers read online training sources"
on public.online_training_sources for select to authenticated using (public.is_work_manager());
create policy "Managers maintain online training sources"
on public.online_training_sources for all to authenticated
using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers read online training queue"
on public.online_training_queue for select to authenticated using (public.is_work_manager());
create policy "Managers maintain online training queue"
on public.online_training_queue for all to authenticated
using (public.is_work_manager()) with check (public.is_work_manager());

create or replace function public.save_image_review_field_checks(
  target_case_id uuid,
  checks jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  saved_count integer := 0;
  review_row public.image_review_cases;
begin
  select * into review_row from public.image_review_cases where id = target_case_id;
  if review_row.id is null then raise exception 'ไม่พบรายการตรวจสอบ'; end if;
  if not public.is_work_manager() and review_row.responsible_profile_id is distinct from auth.uid() then
    raise exception 'ไม่มีสิทธิ์ตรวจสอบรายการนี้';
  end if;

  for item in select value from jsonb_array_elements(coalesce(checks, '[]'::jsonb))
  loop
    if item->>'verdict' not in ('correct','corrected','unreadable','missing','not_applicable') then
      raise exception 'ผลตรวจรายช่องไม่ถูกต้อง';
    end if;
    insert into public.image_review_field_checks (
      review_case_id, field_key, field_label, ai_value, verified_value,
      verdict, confidence, verified_by, verified_at
    ) values (
      target_case_id, item->>'field_key', item->>'field_label',
      item->'ai_value', item->'verified_value', item->>'verdict',
      nullif(item->>'confidence','')::numeric, auth.uid(), now()
    )
    on conflict (review_case_id, field_key) do update set
      field_label = excluded.field_label,
      ai_value = excluded.ai_value,
      verified_value = excluded.verified_value,
      verdict = excluded.verdict,
      confidence = excluded.confidence,
      verified_by = auth.uid(),
      verified_at = now(),
      updated_at = now();
    saved_count := saved_count + 1;
  end loop;

  update public.image_review_cases set
    verified_field_count = (select count(*) from public.image_review_field_checks where review_case_id = target_case_id and verdict = 'correct'),
    corrected_field_count = (select count(*) from public.image_review_field_checks where review_case_id = target_case_id and verdict = 'corrected'),
    missing_field_count = (select count(*) from public.image_review_field_checks where review_case_id = target_case_id and verdict in ('unreadable','missing')),
    updated_at = now()
  where id = target_case_id;

  return saved_count;
end;
$$;
grant execute on function public.save_image_review_field_checks(uuid, jsonb) to authenticated;

create or replace function public.enqueue_online_training_item(
  target_source_id uuid,
  target_url text,
  target_metadata jsonb default '{}'::jsonb
) returns public.online_training_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row public.online_training_sources;
  queued_today integer;
  result_row public.online_training_queue;
begin
  if not public.is_work_manager() then raise exception 'ไม่มีสิทธิ์เพิ่มข้อมูลออนไลน์'; end if;
  select * into source_row from public.online_training_sources where id = target_source_id;
  if source_row.status <> 'approved' then raise exception 'แหล่งข้อมูลยังไม่ได้รับอนุมัติ'; end if;
  select count(*) into queued_today from public.online_training_queue
  where queued_at >= date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  if queued_today >= 200 then raise exception 'ครบขีดจำกัด 200 รายการต่อวันแล้ว'; end if;
  if (select count(*) from public.online_training_queue
      where source_id = target_source_id
        and queued_at >= date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok')
      >= source_row.daily_limit then
    raise exception 'ครบขีดจำกัดรายวันของแหล่งข้อมูลนี้แล้ว';
  end if;

  insert into public.online_training_queue (
    source_id, source_url, license_snapshot, metadata
  ) values (
    source_row.id, target_url,
    jsonb_build_object('license_name', source_row.license_name, 'license_url', source_row.license_url, 'allowed_use', source_row.allowed_use),
    coalesce(target_metadata, '{}'::jsonb)
  )
  on conflict (source_url) do update set updated_at = now()
  returning * into result_row;
  return result_row;
end;
$$;
grant execute on function public.enqueue_online_training_item(uuid, text, jsonb) to authenticated;

create or replace view public.wisdom_image_progress
with (security_invoker = true)
as
select
  count(*)::integer as total_received,
  count(*) filter (where review_status in ('pending','needs_information','forwarded'))::integer as awaiting_review,
  count(*) filter (where review_status in ('confirmed','corrected'))::integer as confirmed,
  count(*) filter (where review_status = 'corrected')::integer as corrected,
  count(*) filter (where review_status = 'dismissed')::integer as dismissed,
  coalesce(sum(verified_field_count),0)::integer as correct_fields,
  coalesce(sum(corrected_field_count),0)::integer as corrected_fields,
  coalesce(sum(missing_field_count),0)::integer as missing_fields,
  round(avg(wisdom_confidence)::numeric,4) as average_wisdom_confidence,
  max(updated_at) as last_activity_at
from public.image_review_cases;
grant select on public.wisdom_image_progress to authenticated;

insert into public.image_ai_observations (
  review_case_id, provider, model, role, result, confidence, status
)
select id, ai_provider, coalesce(ai_model, 'unknown'), 'vision', proposed_output,
  ai_confidence, 'completed'
from public.image_review_cases
on conflict (review_case_id, provider, model, role) do nothing;

update public.image_review_cases set
  wisdom_output = proposed_output,
  wisdom_confidence = ai_confidence
where wisdom_output = '{}'::jsonb;
