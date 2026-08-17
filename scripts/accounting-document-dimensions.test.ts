import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const migration=readFileSync('supabase/migrations/202608150022_accounting_document_multidimensional_classification.sql','utf8')
const webhook=readFileSync('supabase/functions/line-webhook/index.ts','utf8')
const review=readFileSync('src/pages/ImageReview/index.tsx','utf8')

for(const dimension of ['flow_direction','lifecycle_stage','counterparty_type','expense_categories','cost_center_code','wbs_code','payment_status','matching_status','risk_level','risk_flags','extraction_dimensions']){
  assert.match(migration,new RegExp(dimension))
  assert.match(webhook,new RegExp(dimension))
}
assert.match(migration,/accounting_document_dimension_audit/)
assert.match(migration,/using gin\(expense_categories\)/)
assert.match(webhook,/Never infer paid status from an invoice alone/)
assert.match(webhook,/source:'ai_extraction'/)
assert.match(review,/accounting_document\.matching_status/)
assert.match(review,/accounting_document\.risk_flags/)
console.log('accounting document multidimensional classification tests passed')
