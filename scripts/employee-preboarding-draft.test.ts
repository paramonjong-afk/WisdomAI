import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260825203000_employee_intake_preboarding_draft.sql', 'utf8')
const telegram = readFileSync('supabase/functions/telegram-admin/index.ts', 'utf8')
const reviewer = readFileSync('supabase/functions/review-employee-intake/index.ts', 'utf8')
const gateway = readFileSync('src/services/documentFlowGateway.ts', 'utf8')
const intakeRoom = readFileSync('src/pages/IntakeRoom.tsx', 'utf8')

assert.match(migration, /create_employee_preboarding_from_intake/)
assert.match(migration, /employment_type in \('unknown','daily','monthly','temporary','contractor'\)/)
assert.match(migration, /employee_intake_candidate_name_required/)
assert.match(migration, /employee_intake_document_required/)
assert.match(migration, /employee_status,created_by[\s\S]*'preboarding'/)
assert.match(migration, /sync_employee_intake_person_documents/)
assert.match(migration, /employee_preboarding_created/)
assert.match(migration, /cardinality\(missing_fields\)>0 then 'information_required'/)
assert.match(migration, /if intake\.status<>'pending_review' or cardinality\(intake\.missing_fields\)>0/)
assert.match(migration, /status='approved'/)
assert.match(migration, /revoke all on function public\.create_employee_preboarding_from_intake[\s\S]*grant execute[\s\S]*to service_role/)

assert.match(telegram, /employee_intake:preboard:/)
assert.match(telegram, /create_employee_preboarding_from_intake/)
assert.match(telegram, /สร้างประวัติเบื้องต้น/)
assert.match(reviewer, /action\?: 'create_preboarding'/)
assert.match(reviewer, /linked_document_count/)
assert.match(gateway, /employeeIntakePreview[\s\S]*order\('created_at'\)/)
assert.doesNotMatch(gateway, /employeeIntakePreview[\s\S]{0,300}limit\(1\)/)
assert.match(intakeRoom, /result\.data\.map\(async \(file, index\)/)
assert.match(intakeRoom, /actionMenuRow\.source === 'employee_intake' \|\| actionMenuRow\.review_case_id/)
assert.match(intakeRoom, /ยังไม่เปิด Login\/ลงเวลา\/ค่าแรง/)

console.log('employee preboarding draft checks passed')
