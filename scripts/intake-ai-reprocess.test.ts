import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const migration = readFileSync('supabase/migrations/20260823052638_intake_ai_reprocess_audit.sql', 'utf8')
const fn = readFileSync('supabase/functions/reprocess-transfer-slips/index.ts', 'utf8')
const flow = readFileSync('docs/INTAKE_CASE_FLOW.md', 'utf8')

for (const table of ['document_flow_reprocess_batches', 'document_flow_classification_history']) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`))
for (const event of ['reprocess_batch', 'classification_history', 'rule_version', 'model_version']) assert.match(fn + migration, new RegExp(event))
assert.match(fn, /awaiting_classification/)
assert.match(fn, /confidence >= 0\.9/)
assert.match(fn, /payment_verification/)
assert.match(fn, /document_flow_classification_history/)
assert.match(flow, /Intake AI Reprocess and Classification Audit/)
assert.match(flow, /flowchart LR/)
console.log('intake AI reprocess contracts passed')
