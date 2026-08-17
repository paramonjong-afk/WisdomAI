create table if not exists public.employee_intakes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  channel text not null check (channel in ('telegram','line','web_chat')),
  external_chat_id text,
  external_user_id text,
  purpose text check (purpose is null or purpose in ('new_employee','update_employee','archive_only')),
  status text not null default 'awaiting_purpose' check (status in (
    'awaiting_purpose','collecting_documents','extracting','information_required',
    'pending_review','approved','rejected','cancelled','failed'
  )),
  candidate_name text,
  extracted_data jsonb not null default '{}'::jsonb,
  missing_fields text[] not null default '{}',
  document_count integer not null default 0 check (document_count >= 0),
  source_started_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_intake_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  intake_id uuid not null references public.employee_intakes(id) on delete cascade,
  source_channel text not null check (source_channel in ('telegram','line','web_chat')),
  external_file_id text,
  document_type text not null default 'unknown' check (document_type in (
    'unknown','thai_national_id','house_registration','education_certificate',
    'bank_evidence','portrait','other'
  )),
  storage_bucket text not null default 'employee-intake-documents',
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 15728640),
  content_sha256 text,
  extracted_fields jsonb not null default '{}'::jsonb,
  extraction_status text not null default 'pending' check (extraction_status in ('pending','processing','completed','failed','skipped_duplicate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_channel, external_file_id)
);

create index if not exists employee_intakes_company_status_idx
  on public.employee_intakes(company_id,status,updated_at desc);
create index if not exists employee_intakes_channel_session_idx
  on public.employee_intakes(company_id,channel,external_chat_id,external_user_id,updated_at desc);
create index if not exists employee_intake_documents_intake_idx
  on public.employee_intake_documents(company_id,intake_id,created_at);

alter table public.employee_intakes enable row level security;
alter table public.employee_intake_documents enable row level security;

drop policy if exists "Tenant managers read employee intakes" on public.employee_intakes;
create policy "Tenant managers read employee intakes" on public.employee_intakes
for select to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
);
drop policy if exists "Tenant managers manage employee intakes" on public.employee_intakes;
create policy "Tenant managers manage employee intakes" on public.employee_intakes
for all to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
) with check (
  public.is_platform_admin() or public.is_company_manager(company_id)
);

drop policy if exists "Tenant managers read employee intake documents" on public.employee_intake_documents;
create policy "Tenant managers read employee intake documents" on public.employee_intake_documents
for select to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
);
drop policy if exists "Tenant managers manage employee intake documents" on public.employee_intake_documents;
create policy "Tenant managers manage employee intake documents" on public.employee_intake_documents
for all to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
) with check (
  public.is_platform_admin() or public.is_company_manager(company_id)
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('employee-intake-documents','employee-intake-documents',false,15728640,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Tenant managers read employee intake storage" on storage.objects;
create policy "Tenant managers read employee intake storage" on storage.objects
for select to authenticated using (
  bucket_id='employee-intake-documents' and (
    public.is_platform_admin() or public.is_company_manager(((storage.foldername(name))[1])::uuid)
  )
);
drop policy if exists "Tenant managers write employee intake storage" on storage.objects;
create policy "Tenant managers write employee intake storage" on storage.objects
for insert to authenticated with check (
  bucket_id='employee-intake-documents' and (
    public.is_platform_admin() or public.is_company_manager(((storage.foldername(name))[1])::uuid)
  )
);
drop policy if exists "Tenant managers update employee intake storage" on storage.objects;
create policy "Tenant managers update employee intake storage" on storage.objects
for update to authenticated using (
  bucket_id='employee-intake-documents' and (
    public.is_platform_admin() or public.is_company_manager(((storage.foldername(name))[1])::uuid)
  )
) with check (
  bucket_id='employee-intake-documents' and (
    public.is_platform_admin() or public.is_company_manager(((storage.foldername(name))[1])::uuid)
  )
);

comment on table public.employee_intakes is 'Tenant-scoped candidate intake shared by Telegram, LINE, and Web Chat. It does not create an auth/profile account until approved.';
comment on column public.employee_intakes.extracted_data is 'Approved candidate fields only. Never store a full national ID, card laser code, or raw OCR payload.';
