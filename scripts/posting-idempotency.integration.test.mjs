import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const assumeReady = process.argv.includes('--assume-ready')
const run = (command, args, options = {}) => {
  if (command === 'supabase' && !process.env.SUPABASE_CLI_BIN) {
    command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    args = ['--yes', 'supabase', ...args]
  }
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

if (!assumeReady) { run('supabase', ['start']); run('supabase', ['db', 'reset']) }
const env = run('supabase', ['status', '-o', 'env'])
const dbUrl = env.match(/^DB_URL=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
assert.match(dbUrl ?? '', /^postgres(?:ql)?:\/\//, 'Supabase status must expose DB_URL')
const sql = `
begin;
set local role postgres;
do $$ declare company_id uuid; begin
  select id into company_id from public.companies limit 1;
  if company_id is null then
    raise exception 'missing_company_seed';
  end if;
  set local role service_role;
  perform set_config('app.posting_harness_company',company_id::text,true);
end $$;
select public.reserve_posting_operation(current_setting('app.posting_harness_company')::uuid,'integration-posting-key','accounting');
select public.reserve_posting_operation(current_setting('app.posting_harness_company')::uuid,'integration-posting-key','accounting');
set local role postgres;
insert into public.posting_operation_events(operation_id,company_id,event_key,event_type,to_status,payload)
select id,company_id,'integration-posting:reserved','reserved','reserved','{"source":"harness"}'::jsonb
from public.posting_operations where company_id=current_setting('app.posting_harness_company')::uuid and idempotency_key='integration-posting-key';
set local role service_role;
do $$ declare c int; enabled boolean; privileged boolean; begin
  select relrowsecurity into enabled from pg_class where oid='public.posting_operations'::regclass;
  if not enabled then raise exception 'posting_operations_rls_disabled'; end if;
  select has_function_privilege('service_role','public.reserve_posting_operation(uuid,text,text,uuid,uuid)','execute') into privileged;
  if not privileged then raise exception 'service_role_execute_missing'; end if;
  select count(*) into c from public.posting_operations where company_id=current_setting('app.posting_harness_company')::uuid and idempotency_key='integration-posting-key';
  if c <> 1 then raise exception 'idempotency_duplicate:%',c; end if;
end $$;
set local role postgres;
do $$ declare c int; begin
  if (select count(*) from public.posting_operation_events where event_key='integration-posting:reserved') <> 1 then raise exception 'audit_event_missing'; end if;
end $$;
rollback;
`
run('psql', [`--dbname=${dbUrl}`, '-v', 'ON_ERROR_STOP=1', '-X', '-c', sql])
console.log('posting idempotency integration harness passed: atomic duplicate reservation, RLS and service-role grant')
