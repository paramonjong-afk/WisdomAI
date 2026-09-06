import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = file => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
const prior = read('20260905110300_assign_wage_pay_period_workflow_correction.sql')
const start = prior.indexOf('create or replace view public.employee_money_ledger_detail_v1')
const end = prior.indexOf('revoke all on public.employee_money_ledger_detail_v1', start)
assert.ok(start >= 0 && end > start)
const current = read('20260830101500_employee_money_single_approval_queue.sql')
const db = new PGlite()
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create table public.employee_money_ledger_entries (
      id text, company_id text, employee_profile_id text, source_name text,
      account_scope text, entry_type text, amount numeric, effective_on date,
      financial_transaction_id text, source_flow_item_id text, allocation_id text,
      evidence_date_status text, match_method text, entry_status text, reason text,
      created_at timestamptz, version integer, reviewed_by text, reviewed_at timestamptz
    );
    create table public.profiles (id text, full_name text);
    create table public.transfer_slip_money_allocations (
      id text, received_by_profile_id text, recipient_relationship text, pay_period_id text
    );
    create table public.employee_money_pay_period_assignments (
      ledger_entry_id text, pay_period_id text, assignment_method text, reason text
    );
    create table public.pay_periods (id text, name text, starts_on date, ends_on date, status text);
    create table public.financial_transactions (
      id text, transfer_at timestamptz, bank_reference text, sender_name text,
      recipient_name text, sender_bank_name text, recipient_bank_name text,
      sender_account_last4 text, recipient_account_last4 text
    );
    create table public.document_flow_items (
      id text, target_department text, candidate_departments text[], current_room text,
      state text, assignment_status text
    );
    insert into public.profiles values ('owner', 'Synthetic fixture');
    insert into public.employee_money_ledger_entries (id, employee_profile_id, allocation_id, version)
    values ('reviewed', 'owner', 'allocation', 3), ('fallback', 'owner', 'allocation', 2);
    insert into public.transfer_slip_money_allocations (id, pay_period_id) values ('allocation', 'original');
    insert into public.pay_periods (id, name) values ('original', 'Original period'), ('confirmed', 'Reviewed period');
    insert into public.employee_money_pay_period_assignments
    values ('reviewed', 'confirmed', 'manual', 'Reviewer correction');
  `)
  await db.exec(prior.slice(start, end))
  const columns = () => db.query("select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'employee_money_ledger_detail_v1' order by ordinal_position")
  const before = await columns()
  await db.exec(current)
  await db.exec(current)
  assert.deepEqual((await columns()).rows, before.rows, 'replacement must preserve column order and types')
  const rows = await db.query('select id, pay_period_id, pay_period_name, pay_period_assignment_method, pay_period_assignment_reason, version from public.employee_money_ledger_detail_v1 order by id')
  assert.deepEqual(rows.rows, [
    { id: 'fallback', pay_period_id: 'original', pay_period_name: 'Original period', pay_period_assignment_method: null, pay_period_assignment_reason: null, version: 2 },
    { id: 'reviewed', pay_period_id: 'confirmed', pay_period_name: 'Reviewed period', pay_period_assignment_method: 'manual', pay_period_assignment_reason: 'Reviewer correction', version: 3 },
  ])
  const options = await db.query("select reloptions from pg_class where oid = 'public.employee_money_ledger_detail_v1'::regclass")
  assert.ok(options.rows[0].reloptions.includes('security_invoker=true'))
  const grants = await db.query("select has_table_privilege('anon', 'public.employee_money_ledger_detail_v1', 'select') as anon, has_table_privilege('authenticated', 'public.employee_money_ledger_detail_v1', 'select') as authenticated")
  assert.deepEqual(grants.rows, [{ anon: false, authenticated: true }])
} finally {
  await db.close()
}
console.log('Ledger view replay passed: column compatibility, reviewed/fallback periods, version, security invoker, grants and repeat')
