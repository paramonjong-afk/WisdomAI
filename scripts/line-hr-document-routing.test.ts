import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lineEmployeeIntakeBundleKey } from '../supabase/functions/_shared/line-employee-intake.ts'

const source = readFileSync('supabase/functions/line-webhook/index.ts', 'utf8')
const telegram = readFileSync('supabase/functions/telegram-admin/index.ts', 'utf8')
const migration = readFileSync('supabase/migrations/20260825194500_line_hr_document_intake_routing.sql', 'utf8')

const base = { companyId: 'company-1', groupId: 'group-1', userId: 'user-1' }
const first = lineEmployeeIntakeBundleKey({ ...base, occurredAt: Date.parse('2026-08-25T00:23:24Z') })
const second = lineEmployeeIntakeBundleKey({ ...base, occurredAt: Date.parse('2026-08-25T00:23:50Z') })
const otherSender = lineEmployeeIntakeBundleKey({ ...base, userId: 'user-2', occurredAt: Date.parse('2026-08-25T00:23:50Z') })
const later = lineEmployeeIntakeBundleKey({ ...base, occurredAt: Date.parse('2026-08-25T00:34:00Z') })

assert.equal(first, second, 'adjacent front/back images must share one bundle')
assert.notEqual(first, otherSender, 'different senders must never share an employee bundle')
assert.notEqual(first, later, 'a later document set must create a new review bundle')
assert.match(source, /employee_document/)
assert.match(source, /routeEmployeeDocumentToIntake/)
assert.match(source, /hr_restricted/)
assert.match(source, /line_employee_document_duplicate_ignored/)
assert.match(source, /Never return a full national ID, full bank account number/)
assert.match(telegram, /driving_license/)
assert.match(telegram, /line_message_id.*externalIds/s)
assert.match(telegram, /line_employee_documents_reprocess_idempotent/)
assert.match(migration, /source_bundle_key/)
assert.match(migration, /image_purpose_catalog[\s\S]*hr_document/)
assert.match(migration, /intake_hr_document_review/)
assert.match(migration, /hr_admin_review_required/)
assert.match(migration, /employee_workforce_audit_logs|document_flow_events/)

console.log('LINE HR document routing checks passed')
