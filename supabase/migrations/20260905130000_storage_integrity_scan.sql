-- DOC-INGEST-009: report storage/database integrity drift without changing business data.
create table if not exists public.storage_integrity_scan_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running','completed','failed')),
  issue_count integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text
);

create table if not exists public.storage_integrity_issues (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  source_type text not null check (source_type in ('blob','attachment')),
  source_id uuid not null,
  company_id uuid,
  issue_code text not null check (issue_code in (
    'orphan_blob','missing_object','missing_thumbnail','dangling_blob_reference',
    'bucket_path_mismatch','tenant_namespace_mismatch','size_mismatch'
  )),
  storage_bucket text,
  storage_path text,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  last_scan_id uuid references public.storage_integrity_scan_runs(id) on delete set null
);

create index if not exists storage_integrity_issues_status_idx
  on public.storage_integrity_issues(status, last_seen_at desc);
create index if not exists storage_integrity_issues_company_idx
  on public.storage_integrity_issues(company_id, status, last_seen_at desc);

alter table public.storage_integrity_scan_runs enable row level security;
alter table public.storage_integrity_issues enable row level security;

drop policy if exists "Managers read storage integrity runs" on public.storage_integrity_scan_runs;
create policy "Managers read storage integrity runs" on public.storage_integrity_scan_runs
  for select to authenticated using (public.is_work_manager());
drop policy if exists "Managers read storage integrity issues" on public.storage_integrity_issues;
create policy "Managers read storage integrity issues" on public.storage_integrity_issues
  for select to authenticated using (public.is_work_manager());

create or replace function public.run_storage_integrity_scan(target_limit integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  scan_id uuid := gen_random_uuid();
  scan_started timestamptz := clock_timestamp();
  finding_count integer := 0;
  safe_limit integer := least(10000, greatest(1, coalesce(target_limit, 5000)));
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  insert into public.storage_integrity_scan_runs(id,status,started_at)
  values (scan_id,'running',scan_started);

  create temporary table scan_findings on commit drop as
  with candidates as (
    select
      'blob'::text as source_type,
      blob.id as source_id,
      blob.company_id,
      blob.storage_bucket,
      blob.storage_path,
      'orphan_blob'::text as issue_code,
      jsonb_build_object('lifecycle_state',blob.lifecycle_state,'size_bytes',blob.size_bytes) as details
    from public.line_attachment_blobs blob
    where blob.lifecycle_state = 'active'
      and not exists (select 1 from public.line_attachments ref where ref.blob_id = blob.id)
    union all
    select 'blob', blob.id, blob.company_id, blob.storage_bucket, blob.storage_path,
      'missing_object', jsonb_build_object('expected_bucket',blob.storage_bucket,'expected_path',blob.storage_path)
    from public.line_attachment_blobs blob
    where blob.lifecycle_state <> 'purged'
      and not exists (select 1 from storage.objects object_row
        where object_row.bucket_id = blob.storage_bucket and object_row.name = blob.storage_path)
    union all
    select 'blob', blob.id, blob.company_id, blob.storage_bucket, blob.storage_path,
      'size_mismatch', jsonb_build_object('declared_size',blob.size_bytes,'object_size',(object_row.metadata->>'size')::bigint)
    from public.line_attachment_blobs blob
    join storage.objects object_row on object_row.bucket_id = blob.storage_bucket and object_row.name = blob.storage_path
    where blob.size_bytes is not null and (object_row.metadata->>'size') ~ '^[0-9]+$'
      and (object_row.metadata->>'size')::bigint <> blob.size_bytes
    union all
    select 'blob', blob.id, blob.company_id, blob.storage_bucket, blob.storage_path,
      'missing_thumbnail', jsonb_build_object('thumbnail_path',blob.thumbnail_storage_path)
    from public.line_attachment_blobs blob
    where nullif(blob.thumbnail_storage_path,'') is not null
      and not exists (select 1 from storage.objects object_row
        where object_row.bucket_id = blob.storage_bucket and object_row.name = blob.thumbnail_storage_path)
    union all
    select 'blob', blob.id, blob.company_id, blob.storage_bucket, blob.storage_path,
      'tenant_namespace_mismatch', jsonb_build_object('company_id',blob.company_id,'path_prefix',split_part(blob.storage_path,'/',1))
    from public.line_attachment_blobs blob
    where split_part(blob.storage_path,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and split_part(blob.storage_path,'/',1)::uuid <> blob.company_id
    union all
    select 'attachment', attachment.id, attachment.company_id, attachment.storage_bucket, attachment.storage_path,
      'dangling_blob_reference', jsonb_build_object('blob_id',attachment.blob_id)
    from public.line_attachments attachment
    left join public.line_attachment_blobs blob on blob.id = attachment.blob_id
    where attachment.blob_id is not null and blob.id is null
    union all
    select 'attachment', attachment.id, attachment.company_id, attachment.storage_bucket, attachment.storage_path,
      'missing_object', jsonb_build_object('expected_bucket',attachment.storage_bucket,'expected_path',attachment.storage_path)
    from public.line_attachments attachment
    where not exists (select 1 from storage.objects object_row
      where object_row.bucket_id = attachment.storage_bucket and object_row.name = attachment.storage_path)
    union all
    select 'attachment', attachment.id, attachment.company_id, attachment.storage_bucket, attachment.storage_path,
      'tenant_namespace_mismatch', jsonb_build_object('company_id',attachment.company_id,'path_prefix',split_part(attachment.storage_path,'/',1))
    from public.line_attachments attachment
    where split_part(attachment.storage_path,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and split_part(attachment.storage_path,'/',1)::uuid <> attachment.company_id
  )
  select md5(source_type||':'||source_id::text||':'||issue_code||':'||coalesce(storage_bucket,'')||':'||coalesce(storage_path,'')) as fingerprint,
    source_type, source_id, company_id, issue_code, storage_bucket, storage_path, details
  from candidates
  limit safe_limit;

  insert into public.storage_integrity_issues(
    fingerprint,source_type,source_id,company_id,issue_code,storage_bucket,storage_path,details,status,last_seen_at,resolved_at,last_scan_id
  )
  select fingerprint,source_type,source_id,company_id,issue_code,storage_bucket,storage_path,details,'open',scan_started,null,scan_id
  from scan_findings
  on conflict(fingerprint) do update set
    source_type=excluded.source_type,
    source_id=excluded.source_id,
    company_id=excluded.company_id,
    issue_code=excluded.issue_code,
    storage_bucket=excluded.storage_bucket,
    storage_path=excluded.storage_path,
    details=excluded.details,
    status='open',
    last_seen_at=excluded.last_seen_at,
    resolved_at=null,
    last_scan_id=excluded.last_scan_id;

  get diagnostics finding_count = row_count;
  update public.storage_integrity_issues
  set status='resolved', resolved_at=scan_started
  where finding_count < safe_limit
    and status='open' and last_seen_at < scan_started and last_scan_id is distinct from scan_id;

  update public.storage_integrity_scan_runs
  set status='completed', issue_count=finding_count, finished_at=clock_timestamp()
  where id=scan_id;

  return jsonb_build_object('scan_id',scan_id,'status','completed','issue_count',finding_count,
    'truncated',finding_count >= safe_limit,'started_at',scan_started);
exception when others then
  update public.storage_integrity_scan_runs
  set status='failed', error_message=left(sqlerrm,500), finished_at=clock_timestamp()
  where id=scan_id;
  raise;
end;
$$;

revoke all on function public.run_storage_integrity_scan(integer) from public, anon, authenticated;
grant execute on function public.run_storage_integrity_scan(integer) to service_role;

update public.system_work_items
set status='review', progress=80, production_status='source_ready_not_deployed',
  evidence=left(coalesce(evidence||E'\n','')||'DOC-INGEST-009 source: idempotent read-only integrity scan reports orphan blobs, dangling attachment references, missing objects/thumbnails, tenant namespace mismatch and declared/object size mismatch. No delete/move/repair is performed. Migration not applied; runtime scan and fault-injection verification remain pending.',4000),
  current_step='Run service-role dry-run and fault-injection verification; then review before Production apply.',
  updated_at=now()
where work_key='DOC-INGEST-009';
