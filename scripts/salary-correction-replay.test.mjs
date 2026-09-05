import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../supabase/migrations/20260905110100_confirm_salary_payroll_evidence.sql', import.meta.url), 'utf8')
const tables = ['auth.users', 'public.profiles', 'public.document_flow_items', 'public.transfer_slip_money_allocations']
for (const populated of [null, ...tables]) {
  const db = new PGlite()
  try {
    await db.exec(`
      create schema auth;
      create table auth.users (id uuid);
      create table public.profiles (id uuid);
      create table public.document_flow_items (id uuid);
      create table public.transfer_slip_money_allocations (id uuid);
      create table public.document_flow_events (id uuid);
    `)
    if (populated) {
      await db.exec(`insert into ${populated} values ('00000000-0000-4000-8000-000000000001')`)
      await assert.rejects(db.exec(sql), /confirmed_salary_allocation_not_found/)
    } else {
      await db.exec(sql)
      await db.exec(sql)
    }
    for (const table of [...tables, 'public.document_flow_events']) {
      const { rows } = await db.query(`select count(*)::int as count from ${table}`)
      assert.equal(rows[0].count, table === populated ? 1 : 0, 'replay must not fabricate or remove evidence')
    }
  } finally {
    await db.close()
  }
}
console.log('Salary correction replay: 5 PostgreSQL scenarios passed; pristine repeat and existing-data rejection preserved')
