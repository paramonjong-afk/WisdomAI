-- Employee personal records and identity-document registry.
-- Full identifiers must be encrypted by a trusted server before insertion.
-- Never store card laser codes, religion, biometric templates, or raw OCR JSON here.

create table if not exists public.employee_personal_data_stewards (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  permission_scope text[] not null default array['profile', 'document_review'],
  active boolean not null default true,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_personal_data_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
  or exists (
    select 1 from public.employee_personal_data_stewards
    where profile_id = auth.uid()
      and active
      and (expires_at is null or expires_at > now())
  );
$$;

revoke all on function public.is_personal_data_admin() from public;
grant execute on function public.is_personal_data_admin() to authenticated;

create table if not exists public.employee_private_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  title_th text,
  first_name_th text,
  middle_name_th text,
  last_name_th text,
  first_name_en text,
  middle_name_en text,
  last_name_en text,
  preferred_name text,
  date_of_birth date,
  nationality text,
  marital_status text check (
    marital_status is null or marital_status in (
      'single', 'married', 'divorced', 'widowed', 'separated', 'not_disclosed'
    )
  ),
  phone text,
  personal_email text,
  address_line text,
  subdistrict text,
  district text,
  province text,
  postal_code text,
  country_code text not null default 'TH',
  data_status text not null default 'incomplete' check (
    data_status in ('incomplete', 'pending_review', 'verified', 'needs_update', 'archived')
  ),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_identity_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  document_type text not null check (
    document_type in (
      'thai_national_id', 'driving_license', 'passport', 'work_permit',
      'house_registration', 'professional_license', 'education_certificate',
      'medical_certificate', 'bank_evidence', 'other'
    )
  ),
  issuing_country text not null default 'TH',
  issuing_authority text,
  document_class text,
  identifier_last4 text check (
    identifier_last4 is null or identifier_last4 ~ '^[A-Za-z0-9]{2,4}$'
  ),
  identifier_fingerprint text,
  encrypted_identifier bytea,
  issued_on date,
  expires_on date,
  storage_path text not null unique,
  mime_type text not null,
  file_size_bytes bigint check (
    file_size_bytes is null or file_size_bytes between 1 and 15728640
  ),
  file_sha256 text,
  source text not null default 'employee_upload' check (
    source in ('employee_upload', 'hr_upload', 'line_private', 'migration')
  ),
  extraction_status text not null default 'not_started' check (
    extraction_status in ('not_started', 'queued', 'processing', 'completed', 'failed')
  ),
  review_status text not null default 'pending' check (
    review_status in ('pending', 'verified', 'rejected', 'expired', 'superseded')
  ),
  superseded_by uuid references public.employee_identity_documents(id) on delete set null,
  retention_until date,
  deletion_requested_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on),
  check (superseded_by is null or review_status = 'superseded')
);

create unique index if not exists employee_identity_identifier_unique
  on public.employee_identity_documents(document_type, identifier_fingerprint)
  where identifier_fingerprint is not null and review_status <> 'rejected';
create index if not exists employee_identity_profile_idx
  on public.employee_identity_documents(profile_id, document_type, created_at desc);
create index if not exists employee_identity_expiry_idx
  on public.employee_identity_documents(expires_on)
  where expires_on is not null and review_status = 'verified';

-- OCR output is deliberately limited to approved fields. It does not contain
-- a full identity number, card laser code, religion, portrait, or raw payload.
create table if not exists public.employee_document_extractions (
  document_id uuid primary key references public.employee_identity_documents(id) on delete cascade,
  extracted_title text,
  extracted_first_name text,
  extracted_middle_name text,
  extracted_last_name text,
  extracted_first_name_en text,
  extracted_last_name_en text,
  extracted_date_of_birth date,
  extracted_nationality text,
  extracted_address text,
  extracted_document_class text,
  extracted_issued_on date,
  extracted_expires_on date,
  extracted_identifier_last4 text,
  field_confidence jsonb not null default '{}'::jsonb,
  provider text,
  model text,
  overall_confidence numeric(4,3) check (
    overall_confidence is null or overall_confidence between 0 and 1
  ),
  error_message text,
  extracted_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  relationship text not null,
  phone text not null,
  alternate_phone text,
  is_primary boolean not null default false,
  consent_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employee_primary_emergency_contact
  on public.employee_emergency_contacts(profile_id)
  where is_primary;

create table if not exists public.employee_personal_data_authorizations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null,
  legal_basis text not null check (
    legal_basis in (
      'contract', 'legal_obligation', 'legitimate_interest',
      'vital_interest', 'consent'
    )
  ),
  data_categories text[] not null default '{}',
  notice_version text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  withdrawn_at timestamptz,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_personal_data_access_logs (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  document_id uuid references public.employee_identity_documents(id) on delete set null,
  action text not null check (
    action in (
      'view_profile', 'view_document', 'download_document', 'upload_document',
      'run_extraction', 'confirm_extraction', 'update_profile', 'verify_document',
      'reject_document', 'request_deletion', 'delete_document', 'export_data'
    )
  ),
  purpose text not null,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists employee_personal_access_profile_idx
  on public.employee_personal_data_access_logs(profile_id, created_at desc);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-private-documents',
  'employee-private-documents',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.employee_private_profiles enable row level security;
alter table public.employee_personal_data_stewards enable row level security;
alter table public.employee_identity_documents enable row level security;
alter table public.employee_document_extractions enable row level security;
alter table public.employee_emergency_contacts enable row level security;
alter table public.employee_personal_data_authorizations enable row level security;
alter table public.employee_personal_data_access_logs enable row level security;

create policy "Admins manage personal data stewards"
  on public.employee_personal_data_stewards for all to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
create policy "Stewards read own assignment"
  on public.employee_personal_data_stewards for select to authenticated
  using (profile_id = auth.uid());

create policy "Employees read own private profile"
  on public.employee_private_profiles for select to authenticated
  using (profile_id = auth.uid() or public.is_personal_data_admin());
create policy "Personal data admins manage private profiles"
  on public.employee_private_profiles for all to authenticated
  using (public.is_personal_data_admin())
  with check (public.is_personal_data_admin());

create policy "Employees read own document metadata"
  on public.employee_identity_documents for select to authenticated
  using (profile_id = auth.uid() or public.is_personal_data_admin());
create policy "Employees register own pending documents"
  on public.employee_identity_documents for insert to authenticated
  with check (
    profile_id = auth.uid()
    and review_status = 'pending'
    and source in ('employee_upload', 'line_private')
  );
create policy "Personal data admins manage identity documents"
  on public.employee_identity_documents for all to authenticated
  using (public.is_personal_data_admin())
  with check (public.is_personal_data_admin());

create policy "Employees read extraction results for own documents"
  on public.employee_document_extractions for select to authenticated
  using (
    exists (
      select 1 from public.employee_identity_documents document
      where document.id = document_id
        and (document.profile_id = auth.uid() or public.is_personal_data_admin())
    )
  );
create policy "Personal data admins manage document extractions"
  on public.employee_document_extractions for all to authenticated
  using (public.is_personal_data_admin())
  with check (public.is_personal_data_admin());

create policy "Employees manage own emergency contacts"
  on public.employee_emergency_contacts for all to authenticated
  using (profile_id = auth.uid() or public.is_personal_data_admin())
  with check (profile_id = auth.uid() or public.is_personal_data_admin());

create policy "Employees read own authorization records"
  on public.employee_personal_data_authorizations for select to authenticated
  using (profile_id = auth.uid() or public.is_personal_data_admin());
create policy "Personal data admins manage authorization records"
  on public.employee_personal_data_authorizations for all to authenticated
  using (public.is_personal_data_admin())
  with check (public.is_personal_data_admin());

create policy "Employees read own personal data access history"
  on public.employee_personal_data_access_logs for select to authenticated
  using (profile_id = auth.uid() or public.is_personal_data_admin());
create policy "Authenticated record scoped personal data access"
  on public.employee_personal_data_access_logs for insert to authenticated
  with check (
    actor_profile_id = auth.uid()
    and (profile_id = auth.uid() or public.is_personal_data_admin())
  );

create policy "Employees upload own private documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'employee-private-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "Employees or personal data admins read private documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'employee-private-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_personal_data_admin()
    )
  );
create policy "Personal data admins update private documents"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'employee-private-documents'
    and public.is_personal_data_admin()
  )
  with check (
    bucket_id = 'employee-private-documents'
    and public.is_personal_data_admin()
  );
create policy "Personal data admins delete private documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'employee-private-documents'
    and public.is_personal_data_admin()
  );
