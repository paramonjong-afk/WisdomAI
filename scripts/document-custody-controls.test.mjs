import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260908090000_document_original_custody_controls.sql'), 'utf8');
const recoveryFunction = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/document-original-recovery/index.ts'), 'utf8');
const systemHealthPage = fs.readFileSync(path.join(process.cwd(), 'src/pages/SystemHealth/index.tsx'), 'utf8');
assert.match(migration, /create table if not exists public\.document_original_recovery_grants/);
assert.match(migration, /check \(expires_at <= coalesce\(approved_at, created_at\) \+ interval '15 minutes'\)/);
assert.match(migration, /request_document_original_recovery/);
assert.match(migration, /decide_document_original_recovery/);
assert.match(migration, /consume_document_original_recovery/);
assert.match(migration, /document_original_recovery_audit/);
assert.match(migration, /drop policy if exists "Authenticated users can read line attachments"/);
assert.match(migration, /drop policy if exists "tenant_isolation_line_attachments"/);
assert.match(migration, /company_id = public\.current_company_id\(\)/);
assert.match(migration, /backfill_document_custody_metadata/);
assert.match(migration, /missing_integrity_metadata/);
assert.match(migration, /retention_class in \('financial','temporary','work_evidence'\)/);
assert.match(migration, /get diagnostics affected = row_count/);
assert.match(migration, /status=target_decision/);
assert.match(migration, /for update/);
assert.match(migration, /target_decision='revoked' and status in \('pending','approved'\)/);
assert.doesNotMatch(migration, /delete from public\.line_attachments/i);
assert.doesNotMatch(migration, /truncate\s+public\.line_/i);
assert.doesNotMatch(migration, /drop table\s+public\.line_/i);
assert.match(recoveryFunction, /auth\.getUser\(bearer\)/);
assert.match(recoveryFunction, /crypto\.subtle\.digest\('SHA-256'/);
assert.match(recoveryFunction, /createSignedUrl\(grant\.storage_path, seconds\)/);
assert.match(recoveryFunction, /consume_document_original_recovery/);
assert.match(recoveryFunction, /if \(mismatchAuditError\).*AUDIT_WRITE_FAILED/);
assert.match(recoveryFunction, /if \(verifiedAuditError\).*AUDIT_WRITE_FAILED/);
assert.doesNotMatch(recoveryFunction, /signed_url[\s\S]{0,160}(insert|upsert)/i);
assert.match(systemHealthPage, /request_document_original_recovery/);
assert.match(systemHealthPage, /decide_document_original_recovery/);
assert.match(systemHealthPage, /functions\.invoke\('document-original-recovery'/);
assert.match(systemHealthPage, /อนุมัติและกู้ต้นฉบับ/);

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table public.profiles(id uuid primary key);
  create table public.companies(id uuid primary key);
  create table public.company_members(
    company_id uuid not null,
    profile_id uuid not null,
    active boolean not null default true,
    ends_on date,
    company_role text not null
  );
  create table public.line_messages(id uuid primary key);
  create table public.line_attachments(
    id uuid primary key,
    message_id uuid not null references public.line_messages(id),
    company_id uuid not null references public.companies(id),
    storage_bucket text not null,
    storage_path text not null,
    content_type text,
    content_sha256 text,
    blob_id uuid,
    retention_class text not null,
    retain_until date,
    created_at timestamptz not null default now()
  );
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select '00000000-0000-0000-0000-000000000002'::uuid $$;
  create or replace function public.current_company_id() returns uuid language sql stable as
    $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
  create or replace function public.is_platform_admin() returns boolean language sql stable as $$ select true $$;
  create or replace function public.is_company_manager(uuid) returns boolean language sql stable as $$ select true $$;
  alter table public.line_attachments enable row level security;
  create policy "Authenticated users can read line attachments" on public.line_attachments for select to authenticated using (true);
  create policy "tenant_isolation_line_attachments" on public.line_attachments for all to authenticated
    using (company_id=public.current_company_id()) with check (company_id=public.current_company_id());
`);
await db.exec(migration);

const policies = await db.query(`select policyname,cmd from pg_policies where schemaname='public' and tablename='line_attachments' order by policyname`);
assert.deepEqual(policies.rows, [{ policyname: 'Document operations read line attachments in their company', cmd: 'SELECT' }]);

await db.exec(`
  insert into public.companies values ('00000000-0000-0000-0000-000000000001');
  insert into public.profiles values ('00000000-0000-0000-0000-000000000002');
  insert into public.company_members(company_id,profile_id,company_role)
  values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','company_admin');
  insert into public.line_messages values
    ('00000000-0000-0000-0000-000000000011'),
    ('00000000-0000-0000-0000-000000000012'),
    ('00000000-0000-0000-0000-000000000013');
  insert into public.line_attachments(id,message_id,company_id,storage_bucket,storage_path,content_type,content_sha256,blob_id,retention_class,created_at)
  values
    ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','line-attachments','one','image/png',repeat('a',64),'00000000-0000-0000-0000-000000000031','financial','2026-09-01'),
    ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','line-attachments','two',null,null,null,'temporary','2026-09-02'),
    ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','line-attachments','three','image/png',repeat('b',64),'00000000-0000-0000-0000-000000000033','audit','2026-09-03');
`);
const firstBackfill = await db.query(`select * from public.backfill_document_custody_metadata(10)`);
assert.deepEqual(firstBackfill.rows, [{ updated_count: 2, exception_count: 1 }]);
const secondBackfill = await db.query(`select * from public.backfill_document_custody_metadata(10)`);
assert.deepEqual(secondBackfill.rows, [{ updated_count: 0, exception_count: 0 }]);
const retention = await db.query(`select id,retain_until from public.line_attachments order by id`);
assert.equal(retention.rows[0].retain_until.toISOString().slice(0,10), '2033-12-31');
assert.equal(retention.rows[1].retain_until.toISOString().slice(0,10), '2028-09-02');
assert.equal(retention.rows[2].retain_until, null);

const firstRequest = await db.query(`select (public.request_document_original_recovery('00000000-0000-0000-0000-000000000021','Quarterly recovery verification')).id id`);
const repeatedRequest = await db.query(`select (public.request_document_original_recovery('00000000-0000-0000-0000-000000000021','Quarterly recovery verification')).id id`);
assert.equal(firstRequest.rows[0].id, repeatedRequest.rows[0].id);
const grantId = firstRequest.rows[0].id;
await db.query(`select public.decide_document_original_recovery($1,'approved')`, [grantId]);
await db.query(`select public.decide_document_original_recovery($1,'approved')`, [grantId]);
const consumed = await db.query(`select * from public.consume_document_original_recovery($1)`, [grantId]);
assert.equal(consumed.rows.length, 1);
await assert.rejects(db.query(`select * from public.consume_document_original_recovery($1)`, [grantId]), /recovery_grant_not_approved_or_expired/);
const concurrentRequests = await Promise.all([
  db.query(`select (public.request_document_original_recovery('00000000-0000-0000-0000-000000000023','Concurrent recovery verification')).id id`),
  db.query(`select (public.request_document_original_recovery('00000000-0000-0000-0000-000000000023','Concurrent recovery verification')).id id`),
]);
assert.equal(concurrentRequests[0].rows[0].id, concurrentRequests[1].rows[0].id);
const revokedGrant = concurrentRequests[0].rows[0].id;
await db.query(`select public.decide_document_original_recovery($1,'approved')`, [revokedGrant]);
await db.query(`select public.decide_document_original_recovery($1,'revoked')`, [revokedGrant]);
await assert.rejects(db.query(`select * from public.consume_document_original_recovery($1)`, [revokedGrant]), /recovery_grant_not_approved_or_expired/);
const audit = await db.query(`select event_key,count(*)::int count from public.document_original_recovery_audit group by event_key order by event_key`);
assert.deepEqual(audit.rows, [
  { event_key: 'approved', count: 2 },
  { event_key: 'consumed', count: 1 },
  { event_key: 'requested', count: 2 },
  { event_key: 'revoked', count: 1 },
]);
await db.close();
console.log('document-custody-controls: PASS');
