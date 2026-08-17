-- DOC-INGEST-008 retention lifecycle, ordered after physical blob migration.
alter table public.line_attachment_blobs
  add column if not exists lifecycle_state text not null default 'active' check (lifecycle_state in ('active','trash','purged')),
  add column if not exists trash_storage_path text,
  add column if not exists trashed_at timestamptz,
  add column if not exists purge_after timestamptz,
  add column if not exists legal_hold boolean not null default false,
  add column if not exists purged_at timestamptz;

create table if not exists public.storage_retention_audit (
  id uuid primary key default gen_random_uuid(), blob_id uuid not null references public.line_attachment_blobs(id) on delete restrict,
  action text not null check (action in ('trash','restore','purge')), operation_key text not null unique,
  bytes_reclaimed bigint not null default 0, storage_path text, created_at timestamptz not null default now()
);
alter table public.storage_retention_audit enable row level security;

create or replace function public.storage_retention_candidates(target_action text, target_limit integer default 25, target_blob_id uuid default null)
returns table(id uuid,storage_bucket text,storage_path text,trash_storage_path text,size_bytes bigint,lifecycle_state text)
language sql security definer set search_path=public,pg_temp as $$
  select blob.id,blob.storage_bucket,blob.storage_path,blob.trash_storage_path,blob.size_bytes,blob.lifecycle_state
  from public.line_attachment_blobs blob
  where not blob.legal_hold and (
    (target_action in ('dry_run','trash') and blob.lifecycle_state='active'
      and not exists(select 1 from public.line_attachments ref where ref.blob_id=blob.id))
    or (target_action='restore' and blob.lifecycle_state='trash' and blob.purge_after>now() and blob.id=target_blob_id)
    or (target_action='purge' and blob.lifecycle_state='trash' and blob.purge_after<=now()
      and not exists(select 1 from public.line_attachments ref where ref.blob_id=blob.id))
  ) order by coalesce(blob.trashed_at,blob.created_at),blob.id limit least(100,greatest(1,target_limit));
$$;

create or replace function public.record_storage_retention_action(target_blob_id uuid,target_action text,target_trash_path text,target_bytes bigint default 0)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare changed_count integer; op_key text;
begin
  if target_action='trash' then
    update public.line_attachment_blobs set lifecycle_state='trash',trash_storage_path=target_trash_path,trashed_at=now(),purge_after=now()+interval '7 days'
    where id=target_blob_id and lifecycle_state='active' and not legal_hold
      and not exists(select 1 from public.line_attachments ref where ref.blob_id=target_blob_id);
  elsif target_action='restore' then
    update public.line_attachment_blobs set lifecycle_state='active',trash_storage_path=null,trashed_at=null,purge_after=null
    where id=target_blob_id and lifecycle_state='trash' and purge_after>now() and not legal_hold;
  elsif target_action='purge' then
    update public.line_attachment_blobs set lifecycle_state='purged',purged_at=now()
    where id=target_blob_id and lifecycle_state='trash' and purge_after<=now() and not legal_hold
      and not exists(select 1 from public.line_attachments ref where ref.blob_id=target_blob_id);
  else raise exception 'invalid_retention_action'; end if;
  get diagnostics changed_count=row_count;
  if changed_count>0 then
    op_key:=target_blob_id::text||':'||target_action||':'||txid_current()::text;
    insert into public.storage_retention_audit(blob_id,action,operation_key,bytes_reclaimed,storage_path)
    values(target_blob_id,target_action,op_key,case when target_action='purge' then greatest(0,target_bytes) else 0 end,target_trash_path)
    on conflict(operation_key) do nothing; end if;
  return changed_count>0;
end $$;

revoke all on function public.storage_retention_candidates(text,integer,uuid) from public,anon,authenticated;
revoke all on function public.record_storage_retention_action(uuid,text,text,bigint) from public,anon,authenticated;

update public.system_work_items set status='review',progress=90,production_status='source_ready_not_deployed',
  evidence=left(coalesce(evidence||E'\n','')||'DOC-INGEST-008 source: storage-retention-worker + lifecycle RPCs; reference/hold guards, 7-day trash restore, purge, dry-run, batch<=100, idempotent audit and bytes reclaimed; automated contract test added. Migration not applied and no data deleted.',4000),
  current_step='Review and deploy migration/function in a controlled environment; run non-destructive dry-run before enabling purge.',updated_at=now()
where work_key='DOC-INGEST-008';
