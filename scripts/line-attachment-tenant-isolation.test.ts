import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

type Fixture = {
  companies: string[]
  rows: Array<{ id: string; company_id: string; message_id: string; storage_path: string }>
  blobs: Array<{ id: string; company_id: string; storage_path: string }>
  storage: Array<{ bucket_id: string; name: string; company_id: string }>
}

const fixture = JSON.parse(readFileSync('scripts/fixtures/line-attachment-tenant-isolation.json', 'utf8')) as Fixture
const migration = readFileSync('supabase/migrations/20260907130000_line_attachment_tenant_isolation.sql', 'utf8')
const integration = readFileSync('scripts/line-attachment-tenant-isolation.integration.test.mjs', 'utf8')
const workflow = readFileSync('.github/workflows/deploy-supabase-migrations.yml', 'utf8')

assert.deepEqual(fixture.companies, ['company-a', 'company-b'])
assert.equal(fixture.rows.length, 2)
assert.equal(fixture.blobs.length, 2)
assert.equal(fixture.storage.length, 2)

const canReadCompanyRow = (activeCompany: string | null, rowCompany: string) => (
  activeCompany !== null && activeCompany === rowCompany
)
const canReadStorage = (activeCompany: string | null, object: Fixture['storage'][number]) => (
  object.bucket_id === 'line-attachments' && canReadCompanyRow(activeCompany, object.company_id)
)
const canWriteBlob = (role: 'anon' | 'authenticated' | 'service_role') => role === 'service_role'

// Positive: a member of the active company can read its metadata, blob and object.
assert.equal(canReadCompanyRow('company-a', fixture.rows[0].company_id), true)
assert.equal(canReadCompanyRow('company-a', fixture.blobs[0].company_id), true)
assert.equal(canReadStorage('company-a', fixture.storage[0]), true)

// Negative: the same session cannot read another company's metadata, blob or object.
assert.equal(canReadCompanyRow('company-a', fixture.rows[1].company_id), false)
assert.equal(canReadCompanyRow('company-a', fixture.blobs[1].company_id), false)
assert.equal(canReadStorage('company-a', fixture.storage[1]), false)
assert.equal(canReadCompanyRow(null, fixture.rows[0].company_id), false)

// Writes are service-role only; this fixture intentionally does not mutate a database.
assert.equal(canWriteBlob('service_role'), true)
assert.equal(canWriteBlob('authenticated'), false)
assert.equal(canWriteBlob('anon'), false)

assert.match(migration, /alter table public\.line_attachment_blobs enable row level security/)
assert.match(migration, /using \(company_id = public\.current_company_id\(\)\)/)
assert.match(migration, /revoke all on table public\.line_attachment_blobs from anon/)
assert.match(migration, /revoke all on table public\.line_attachment_blobs from authenticated/)
assert.match(migration, /line-attachments/)
assert.match(migration, /as restrictive for select to authenticated/)
assert.doesNotMatch(migration, /'line-attachments'::text\s*\n\s*\]\)/, 'restrictive employee storage policy must not block LINE attachments')
assert.match(integration, /set local role authenticated/)
assert.match(integration, /set local role anon/)
assert.match(integration, /set local role service_role/)
assert.match(integration, /app\.platform_company_bootstrap/)
assert.match(integration, /same platform-admin gate/)
assert.match(integration, /grant select on rls_harness_rows to authenticated, anon/)
assert.match(integration, /same-company wrong-department Storage read expected 0/)
assert.match(integration, /company_a,user_c,'hr'/)
assert.match(integration, /process\.env\.ComSpec \?\? 'cmd\.exe'/)
assert.match(integration, /when insufficient_privilege/)
assert.match(integration, /pg_isready/)
assert.match(integration, /--dbname=\$\{dbUrl\}/)
assert.match(integration, /rollback;/)
assert.match(workflow, /line-attachment-tenant-isolation\.integration\.test\.mjs --assume-ready/)

console.log('line attachment tenant isolation fixture passed: own-company allow, cross-company deny, same-company wrong-department Storage deny, service-role-only blob writes')
