import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const migration = readFileSync('supabase/migrations/20260905130000_storage_integrity_scan.sql', 'utf8')

for (const marker of [
  'storage_integrity_scan_runs',
  'storage_integrity_issues',
  'run_storage_integrity_scan',
  "coalesce(auth.role(),'') <> 'service_role'",
  'orphan_blob',
  'dangling_blob_reference',
  'missing_thumbnail',
  'tenant_namespace_mismatch',
  'size_mismatch',
  'orphan_storage_object',
  'on conflict(fingerprint) do update',
  "status='resolved'",
  "grant execute on function public.run_storage_integrity_scan(integer) to service_role",
]) assert.ok(migration.includes(marker), `missing migration contract: ${marker}`)

assert.doesNotMatch(migration, /\b(drop\s+table|drop\s+column|delete\s+from|truncate\s+)/i, 'integrity scan must not delete or drop data')
assert.doesNotMatch(migration, /\b(update|insert)\s+storage\.objects|\bdelete\s+from\s+storage\.objects/i, 'storage scan must be read-only')
assert.match(migration, /finding_count < safe_limit[\s\S]*status='open'/, 'bounded scans must not resolve unseen issues')
assert.match(migration, /source_type in \('blob','attachment','storage_object'\)/)
assert.match(migration, /current_company_id\(\)/)
assert.match(migration, /trash_storage_path/)
console.log('storage integrity scan contract passed: read-only, bounded, idempotent, tenant-aware')
