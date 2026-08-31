import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260831072537_borrowed_fund_obligations.sql', 'utf8')
const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')
const service = readFileSync('src/services/transferSlipMoneyLineage.ts', 'utf8')

assert.match(migration, /'borrowed_funds'/)
assert.match(migration, /create table if not exists public\.borrowed_fund_obligations/)
assert.match(migration, /principal_amount numeric\(14,2\).*repaid_amount/s)
assert.match(migration, /status in \('outstanding','partially_repaid','repaid','cancelled'\)/)
assert.match(migration, /enable row level security/)
assert.match(migration, /revoke all on table public\.borrowed_fund_obligations from public, anon/)
assert.match(migration, /company_role='accounting_hr'/)
assert.match(migration, /workflow_permission_denied/)
assert.match(migration, /event_key=target_event_key/)
assert.match(migration, /borrowed_fund_obligation_recorded/)
assert.match(page, /เงินยืมจากบุคคล\/กรรมการ → ตั้งต้น\/เติมกองผู้รับ/)
assert.match(page, /record_borrowed_fund_obligation_v1/)
assert.ok(page.indexOf("saveBase('draft', `${eventKey}:advance-classification-draft`)") < page.indexOf('record_borrowed_fund_obligation_v1'), 'obligation must follow the lineage draft')
assert.ok(page.indexOf('record_borrowed_fund_obligation_v1') < page.indexOf("saveBase('confirm', eventKey)"), 'obligation must be recorded before final confirmation')
assert.match(service, /borrowed_funds.*loanLenderName/s)
assert.match(service, /กำหนดคืนเงินยืม/)

console.log('borrowed fund obligation contract passed')
