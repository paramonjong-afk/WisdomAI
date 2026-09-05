import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const vendor = read('20260826044252_transfer_slip_vendor_payment_matching.sql')
const allocations = read('20260826220000_transfer_slip_money_allocations_v2.sql')
function between(sql, start, end) {
  const from = sql.indexOf(start)
  const to = sql.indexOf(end, from)
  assert.ok(from >= 0 && to > from, 'migration SQL boundaries must exist')
  return sql.slice(from, to)
}
const guard = between(vendor, 'create or replace function public.enforce_transfer_slip_vendor_match()', "notify pgrst, 'reload schema';")
const tableAndTrigger = between(allocations, 'create table if not exists public.transfer_slip_money_allocations (', 'create index if not exists transfer_slip_money_allocations_queue_idx')
const lineage = '00000000-0000-4000-8000-000000000001'
const company = '00000000-0000-4000-8000-000000000002'

for (const existingTable of [false, true]) {
  const db = new PGlite()
  try {
    await db.exec(`
      create table public.transfer_slip_money_lineages (id uuid primary key);
      create table public.companies (id uuid primary key);
      create table public.projects (id uuid primary key);
      create table public.project_sites (id uuid primary key);
      create table public.profiles (id uuid primary key);
      create table public.transfer_slip_vendor_matches (
        lineage_id uuid, allocation_key text, match_status text, vendor_id uuid
      );
    `)
    if (existingTable) {
      await db.exec(tableAndTrigger.slice(0, tableAndTrigger.indexOf('-- Install the earlier vendor-match guard')))
    }
    await db.exec(guard)
    if (!existingTable) {
      assert.equal((await db.query("select to_regclass('public.transfer_slip_money_allocations') as name")).rows[0].name, null)
    }
    await db.exec(tableAndTrigger)
    await db.exec(guard)
    await db.exec(tableAndTrigger)
    assert.equal((await db.query("select count(*)::int as count from pg_trigger where tgname = 'enforce_transfer_slip_vendor_match' and not tgisinternal")).rows[0].count, 1)
    await db.query('insert into public.transfer_slip_money_lineages values ($1)', [lineage])
    await db.query('insert into public.companies values ($1)', [company])
    const insert = (key, purpose, status) => db.query(`
      insert into public.transfer_slip_money_allocations
      (lineage_id, company_id, allocation_key, sequence, purpose_type, allocation_amount, status)
      values ($1, $2, $3, 1, $4, 100, $5)`, [lineage, company, key, purpose, status])
    for (const status of ['confirmed', 'routed', 'reconciled']) {
      await assert.rejects(insert(status, 'vendor_payment', status), /vendor_payment_match_required/)
    }
    await insert('proposed', 'vendor_payment', 'proposed')
    await assert.rejects(db.exec("update public.transfer_slip_money_allocations set status = 'confirmed' where allocation_key = 'proposed'"), /vendor_payment_match_required/)
    await db.query("insert into public.transfer_slip_vendor_matches values ($1, 'proposed', 'matched', $2)", [lineage, company])
    await db.exec("update public.transfer_slip_money_allocations set status = 'confirmed' where allocation_key = 'proposed'")
    await insert('non-vendor', 'payroll', 'confirmed')
    assert.equal((await db.query('select count(*)::int as count from public.transfer_slip_money_allocations')).rows[0].count, 2)
  } finally {
    await db.close()
  }
}
console.log('Vendor trigger replay passed: fresh/existing table, repeated install, blocked insert/update and matched/non-vendor success')
