import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../supabase/migrations/202607210000_profiles_foundation.sql', import.meta.url), 'utf8')
const db = new PGlite()
try {
  await db.exec('create schema auth; create table auth.users (id uuid primary key);')
  await db.exec(sql)
  const state = () => db.query("select relname, relrowsecurity, obj_description(oid) as comment from pg_class where oid in ('public.profiles'::regclass, 'public.projects'::regclass) order by relname")
  assert.ok((await state()).rows.every(row => row.relrowsecurity))
  await db.exec("comment on table public.profiles is 'Existing profile comment'; comment on table public.projects is 'Existing project comment'; alter table public.projects disable row level security;")
  const before = await state()
  await db.exec(sql)
  assert.deepEqual((await state()).rows, before.rows, 'existing table settings must be untouched')
  assert.equal((await db.query('select count(*)::int as count from public.profiles')).rows[0].count, 0)
} finally {
  await db.close()
}
console.log('Foundation replay passed: fresh RLS and existing-table no-op')
