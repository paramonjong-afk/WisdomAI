import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const files = [
  '202608090018_link_confirmed_telegram_admin.sql',
  '202608090019_correct_confirmed_telegram_admin_id.sql',
]

for (const file of files) {
  const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
  for (const scenario of ['pristine', 'auth-only', 'profile-only', 'both']) {
    const db = new PGlite()
    try {
      await db.exec(`
        create schema auth;
        create table auth.users (id uuid primary key);
        create table public.profiles (id uuid primary key, full_name text);
        create table public.companies (id uuid primary key, name text, active boolean);
        create table public.company_members (
          company_id uuid, profile_id uuid, active boolean,
          ends_on date, company_role text
        );
        insert into public.companies values
          ('00000000-0000-4000-8000-000000000001', 'WisdomAI Construction', true);
      `)
      if (scenario === 'auth-only' || scenario === 'both') {
        await db.exec("insert into auth.users values ('00000000-0000-4000-8000-000000000002')")
      }
      if (scenario === 'profile-only' || scenario === 'both') {
        await db.exec("insert into public.profiles values ('00000000-0000-4000-8000-000000000002', 'Synthetic unrelated fixture')")
      }
      if (scenario === 'pristine') {
        await db.exec(sql)
        await db.exec(sql)
        const { rows } = await db.query('select count(*)::int as count from public.profiles')
        assert.equal(rows[0].count, 0, 'fresh replay must not fabricate profiles')
        const tables = await db.query("select to_regclass('public.telegram_admin_accounts') as accounts")
        assert.equal(tables.rows[0].accounts, null, 'fresh replay must not create an admin link')
      } else {
        await assert.rejects(db.exec(sql), /Expected exactly one/, 'populated databases must retain identity validation')
        await db.exec('rollback')
      }
    } finally {
      await db.close()
    }
  }
}
console.log('Legacy identity replay: 8 PostgreSQL scenarios passed, including pristine repeat and populated fail-closed checks')
