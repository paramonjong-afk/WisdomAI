import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const assumeReady = process.argv.includes('--assume-ready')
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}
const runSupabase = (args) => process.platform === 'win32'
  ? run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'supabase.cmd', ...args])
  : run('supabase', args)

if (!assumeReady) {
  runSupabase(['start'])
  runSupabase(['db', 'reset'])
}

const envOutput = runSupabase(['status', '-o', 'env'])
const rawDbUrl = envOutput.match(/^DB_URL=(.*)$/m)?.[1]?.trim()
const dbUrl = rawDbUrl?.replace(/^['"]|['"]$/g, '')
assert.ok(dbUrl && /^postgres(?:ql)?:\/\//.test(dbUrl), 'supabase status must expose a PostgreSQL DB_URL')
run('pg_isready', [`--dbname=${dbUrl}`])

const sql = String.raw`
begin;
set local statement_timeout = '30s';

do $$
declare
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  user_c uuid := gen_random_uuid();
begin
  -- Local auth users are fixture-only and the transaction is rolled back below.
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values
    (user_a,'authenticated','authenticated','rls-a@example.invalid','',now(),'{}','{}',now(),now()),
    (user_b,'authenticated','authenticated','rls-b@example.invalid','',now(),'{}','{}',now(),now()),
    (user_c,'authenticated','authenticated','rls-c@example.invalid','',now(),'{}','{}',now(),now());
  insert into public.profiles(id,full_name,email,role)
  values
    (user_a,'RLS Harness A','rls-a@example.invalid','admin'),
    (user_b,'RLS Harness B','rls-b@example.invalid','admin'),
    (user_c,'RLS Harness C','rls-c@example.invalid','employee');
  create temporary table rls_harness_context(user_a uuid,user_b uuid,user_c uuid) on commit drop;
  insert into rls_harness_context values(user_a,user_b,user_c);
end $$;

do $$
declare
  company_a uuid := gen_random_uuid();
  company_b uuid := gen_random_uuid();
  user_a uuid;
  user_b uuid;
  user_c uuid;
  message_a uuid := gen_random_uuid();
  message_b uuid := gen_random_uuid();
  attachment_a uuid := gen_random_uuid();
  attachment_b uuid := gen_random_uuid();
  blob_a uuid := gen_random_uuid();
  blob_b uuid := gen_random_uuid();
begin
  select c.user_a, c.user_b, c.user_c into user_a, user_b, user_c from rls_harness_context c;
  insert into public.companies(id,name,slug) values
    (company_a,'RLS Harness A','rls-harness-a'),(company_b,'RLS Harness B','rls-harness-b');
  -- Bootstrap memberships through the same platform-admin gate used by the
  -- application; do not bypass the trigger with a disabled constraint.
  set local role service_role;
  perform set_config('request.jwt.claim.sub',user_a::text,true);
  perform set_config('request.jwt.claims',json_build_object('role','service_role','sub',user_a::text)::text,true);
  perform set_config('app.platform_company_bootstrap','on',true);
  insert into public.company_members(company_id,profile_id,company_role)
  values (company_a,user_a,'company_admin');
  perform set_config('request.jwt.claim.sub',user_b::text,true);
  perform set_config('request.jwt.claims',json_build_object('role','service_role','sub',user_b::text)::text,true);
  insert into public.company_members(company_id,profile_id,company_role)
  values (company_b,user_b,'company_admin');
  -- Membership management must be performed by the existing company admin;
  -- an employee must not be able to add their own membership through a fixture.
  perform set_config('request.jwt.claim.sub',user_a::text,true);
  perform set_config('request.jwt.claims',json_build_object('role','service_role','sub',user_a::text)::text,true);
  insert into public.company_members(company_id,profile_id,company_role)
    values (company_a,user_c,'employee');
  insert into public.user_company_preferences(profile_id,active_company_id)
    values (user_a,company_a),(user_b,company_b),(user_c,company_a);
  -- Service-role fixture writes are intentionally context-free; assertions
  -- below reintroduce each authenticated JWT explicitly.
  perform set_config('request.jwt.claim.sub',user_c::text,true);
  perform set_config('request.jwt.claims',json_build_object('role','service_role','sub',user_c::text)::text,true);
  insert into public.line_messages(id,webhook_event_id,line_message_id,message_type,occurred_at,raw_event,company_id)
  values
    (message_a,'rls-harness-event-a','rls-harness-message-a','image',now(),'{}',company_a),
    (message_b,'rls-harness-event-b','rls-harness-message-b','image',now(),'{}',company_b);
  insert into public.line_attachment_blobs(id,company_id,content_sha256,storage_bucket,storage_path,content_type,size_bytes)
  values
    (blob_a,company_a,repeat('a',64),'line-attachments',company_a::text||'/blobs/a.jpg','image/jpeg',1),
    (blob_b,company_b,repeat('b',64),'line-attachments',company_b::text||'/blobs/b.jpg','image/jpeg',1);
  insert into public.line_attachments(id,message_id,storage_bucket,storage_path,content_type,size_bytes,company_id,blob_id)
  values
    (attachment_a,message_a,'line-attachments',company_a::text||'/blobs/a.jpg','image/jpeg',1,company_a,blob_a),
    (attachment_b,message_b,'line-attachments',company_b::text||'/blobs/b.jpg','image/jpeg',1,company_b,blob_b);
  -- Storage preview access is intentionally coupled to the Document Flow
  -- ledger and its department permission, not only to the attachment row.
  insert into public.document_flow_department_members(company_id,profile_id,department)
  values
    (company_a,user_a,'accounting'),
    (company_b,user_b,'accounting'),
    (company_a,user_c,'hr');
  insert into public.document_flow_items(
    company_id,intake_id,source_message_id,current_flow,current_room,state,
    document_type,route_target,target_department,candidate_departments,sensitivity
  ) values
    (company_a,gen_random_uuid(),message_a,'intake','intake_waiting_room','received','transfer_slip','payment_verification','accounting',array['accounting'],'general'),
    (company_b,gen_random_uuid(),message_b,'intake','intake_waiting_room','received','transfer_slip','payment_verification','accounting',array['accounting'],'general');
  insert into storage.objects(id,bucket_id,name,metadata)
  values
    (gen_random_uuid(),'line-attachments',company_a::text||'/blobs/a.jpg','{}'),
    (gen_random_uuid(),'line-attachments',company_b::text||'/blobs/b.jpg','{}');
  create temporary table rls_harness_rows(company_a uuid,company_b uuid,user_a uuid,user_b uuid,user_c uuid) on commit drop;
  insert into rls_harness_rows values(company_a,company_b,user_a,user_b,user_c);
  -- RLS assertions run as database roles, so grant only this transaction's
  -- temporary context table; no persistent grant or Production privilege is changed.
  grant select on rls_harness_rows to authenticated, anon;
end $$;

-- JWT context C: an active member of company A in HR cannot preview an
-- accounting-only source file. Attachment metadata remains company-scoped;
-- the original Storage bytes are the department-gated evidence boundary.
do $$
declare r record; c integer;
begin
  select * into r from rls_harness_rows;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',r.user_c::text,true);
  perform set_config('request.jwt.claims',json_build_object('role','authenticated','sub',r.user_c::text)::text,true);
  select count(*) into c from public.line_attachments where company_id=r.company_a;
  if c <> 1 then raise exception 'same-company attachment metadata read expected 1, got %',c; end if;
  select count(*) into c from storage.objects where bucket_id='line-attachments' and name like r.company_a::text||'/%';
  if c <> 0 then raise exception 'same-company wrong-department Storage read expected 0, got %',c; end if;
end $$;

-- JWT context A: own-company metadata, blob and Storage object are visible.
do $$
declare r record; c integer;
begin
  select * into r from rls_harness_rows;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',r.user_a::text,true);
  perform set_config('request.jwt.claims',json_build_object('role','authenticated','sub',r.user_a::text)::text,true);
  select count(*) into c from public.line_messages where company_id=r.company_a;
  if c <> 1 then raise exception 'own-company message read expected 1, got %',c; end if;
  select count(*) into c from public.line_messages where company_id=r.company_b;
  if c <> 0 then raise exception 'cross-company message read expected 0, got %',c; end if;
  select count(*) into c from public.line_attachments where company_id=r.company_a;
  if c <> 1 then raise exception 'own-company attachment read expected 1, got %',c; end if;
  select count(*) into c from public.line_attachment_blobs where company_id=r.company_a;
  if c <> 1 then raise exception 'own-company blob read expected 1, got %',c; end if;
  select count(*) into c from storage.objects where bucket_id='line-attachments' and name like r.company_a::text||'/%';
  if c <> 1 then raise exception 'own-company Storage read expected 1, got %',c; end if;
  select count(*) into c from storage.objects where bucket_id='line-attachments' and name like r.company_b::text||'/%';
  if c <> 0 then raise exception 'cross-company Storage read expected 0, got %',c; end if;
end $$;

-- JWT context B: reciprocal isolation is enforced.
do $$
declare r record; c integer;
begin
  select * into r from rls_harness_rows;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',r.user_b::text,true);
  perform set_config('request.jwt.claims',json_build_object('role','authenticated','sub',r.user_b::text)::text,true);
  select count(*) into c from public.line_messages where company_id=r.company_b;
  if c <> 1 then raise exception 'company B own read expected 1, got %',c; end if;
  select count(*) into c from public.line_messages where company_id=r.company_a;
  if c <> 0 then raise exception 'company B cross read expected 0, got %',c; end if;
end $$;

-- Anonymous reads are denied, authenticated writes are denied, service-role writes work.
do $$
declare r record; denied boolean := false; service_count integer;
begin
  select * into r from rls_harness_rows;
  set local role anon;
  perform set_config('request.jwt.claims',json_build_object('role','anon')::text,true);
  begin
    if (select count(*) from public.line_messages) <> 0 then raise exception 'anonymous metadata read was allowed'; end if;
  exception when insufficient_privilege then
    -- No SELECT grant is also an expected secure outcome. Unexpected errors
    -- are not swallowed and will still fail the harness.
    null;
  end;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',r.user_a::text,true);
  perform set_config('request.jwt.claims',json_build_object('role','authenticated','sub',r.user_a::text)::text,true);
  begin
    insert into public.line_attachment_blobs(company_id,content_sha256,storage_path)
    values (r.company_a,repeat('c',64),r.company_a::text||'/forbidden.jpg');
  exception when others then denied := true;
  end;
  if not denied then raise exception 'authenticated blob write was allowed'; end if;
  set local role service_role;
  insert into public.line_attachment_blobs(company_id,content_sha256,storage_path)
  values (r.company_a,repeat('d',64),r.company_a::text||'/service.jpg');
  select count(*) into service_count from public.line_attachment_blobs where storage_path=r.company_a::text||'/service.jpg';
  if service_count <> 1 then raise exception 'service-role blob write did not persist'; end if;
end $$;

rollback;
`

const dir = mkdtempSync(join(tmpdir(), 'doc005-rls-'))
const sqlPath = join(dir, 'tenant-isolation.sql')
writeFileSync(sqlPath, sql, 'utf8')
try {
  run('psql', [`--dbname=${dbUrl}`, '-X', '-v', 'ON_ERROR_STOP=1', '-f', sqlPath])
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('line attachment RLS integration harness passed: own allow, cross-company deny, same-company wrong-department Storage deny, anonymous deny, service-role write')
