import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202609170004_controller00_qa_dispatch.sql','utf8')
const edge = readFileSync('supabase/functions/automation-worker/index.ts','utf8')
const runner = readFileSync('scripts/local-automation-runner.ps1','utf8')
const orchestrator = readFileSync('scripts/controller00-runner.ps1','utf8')

assert.match(migration,/claim_system_work_item_qa_v1/)
assert.match(migration,/item\.status='review'/)
assert.match(migration,/item\.approval_status='approved'/)
assert.match(migration,/item\.work_kind='executable'/)
assert.match(migration,/item\.progress >= 95/)
assert.match(migration,/qa_tier,'standard'\) <> 'human'/)
assert.match(migration,/for update skip locked limit 1/)
assert.doesNotMatch(migration,/delete from|truncate table|drop table/i)
assert.match(edge,/body\.action === 'claim_qa'/)
assert.match(edge,/claim_system_work_item_qa_v1/)
assert.match(runner,/ValidateSet\('execution','qa'\)/)
assert.match(runner,/Never return review, ready, or waiting_qa from QA/)
assert.match(runner,/qa_terminal_decision_required/)
assert.match(orchestrator,/controller-00-execution-01/)
assert.match(orchestrator,/controller-00-qa-01/)
assert.match(orchestrator,/Wait-Process/)

console.log('Controller 00 execution, recovery and independent QA contracts passed')
