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

const reconciliation = readFileSync(new URL('../supabase/migrations/202608150016_work_item_completion_reconciliation.sql', import.meta.url), 'utf8')
for (const scenario of ['pristine', 'auth-only', 'profile-only', 'invalid-target', 'tenant-target', 'review-target']) {
  const db = new PGlite()
  try {
    await db.exec(`
      create schema auth;
      create table auth.users (id int);
      create table public.profiles (id int);
      create table public.system_work_items (
        work_key text, scope text, status text, progress int, detail text,
        current_step text, production_status text, evidence text,
        worker_id text, heartbeat_at timestamptz, lease_expires_at timestamptz,
        updated_at timestamptz
      );
      insert into public.system_work_items (work_key, scope, status, progress, evidence)
      values ('unrelated-fixture', 'platform', 'review', 99, 'unchanged');
    `)
    if (scenario === 'auth-only') await db.exec('insert into auth.users values (1)')
    if (scenario === 'profile-only') await db.exec('insert into public.profiles values (1)')
    if (scenario.endsWith('-target')) {
      await db.query(`insert into public.system_work_items (work_key, scope, status, progress, evidence)
        values ('LINE-GROUP-APPROVAL-001', $1, 'review', $2, 'prior evidence')`,
      [scenario === 'tenant-target' ? 'company' : 'platform', scenario === 'invalid-target' ? 98 : 99])
    }
    if (scenario === 'pristine' || scenario === 'review-target') {
      await db.exec(reconciliation)
      const first = await db.query('select * from public.system_work_items order by work_key')
      await db.exec(reconciliation)
      assert.deepEqual((await db.query('select * from public.system_work_items order by work_key')).rows, first.rows)
      const target = first.rows.find(row => row.work_key === 'LINE-GROUP-APPROVAL-001')
      if (scenario === 'pristine') assert.equal(target, undefined, 'must not fabricate historical UAT evidence')
      else {
        assert.equal(target.status, 'done')
        assert.equal(target.progress, 100)
        assert.equal(target.production_status, 'deployed_assignment_uat_passed')
        assert.ok(target.evidence.startsWith('prior evidence\n'))
      }
    } else {
      await assert.rejects(db.exec(reconciliation), /completion reconciliation failed/)
    }
    const unrelated = await db.query("select status, progress, evidence from public.system_work_items where work_key = 'unrelated-fixture'")
    assert.deepEqual(unrelated.rows, [{ status: 'review', progress: 99, evidence: 'unchanged' }])
  } finally {
    await db.close()
  }
}
console.log('Legacy reconciliation replay: 6 PostgreSQL scenarios passed')
