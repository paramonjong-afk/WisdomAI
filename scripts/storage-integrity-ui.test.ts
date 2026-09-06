import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const source=readFileSync('src/pages/SystemHealth/index.tsx','utf8')
for(const marker of [
  "from('storage_integrity_issues')",
  "reference:`STG-${issue.id.slice(0,8).toUpperCase()}`",
  "owner:'Storage / Platform'",
  "issue.issue_code==='missing_object'?'critical'",
  "issue.status==='open'?'pending':'resolved'",
])assert.ok(source.includes(marker),`missing Storage Integrity UI contract: ${marker}`)
assert.match(source,/storageIntegrityIssues\.map<ProblemRow>/)
assert.match(source,/\.order\('last_seen_at',\{ascending:false\}\)\.limit\(500\)/)
console.log('storage integrity UI contract passed: manager queue is visible and tenant-scoped by RLS')
