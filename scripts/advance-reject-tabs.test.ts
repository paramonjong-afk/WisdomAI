import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/AdvanceSettlements/index.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/20260829173946_employee_advance_reject_restore.sql', 'utf8')

for (const required of [
  'ต้องจัดการ (${actionableRows.length})',
  'บัญชีพักช่างรายวัน (${employeeMoneyRows.length})',
  'พร้อมปิดยอด / ปิดแล้ว (${readyToCloseRows.length})',
  'Reject / ต้องแก้ไข (${rejectedRows.length})',
  "rows.filter((row) => row.status !== 'rejected')",
  'Reject ไม่นับยอด',
  'ยอดใช้งานจริงจะลดลง',
  'นำกลับมาตรวจ',
  'onRowClick={setSelectedEmployeeMoney}',
  'กรองตามผู้รับผิดชอบปัจจุบัน',
  'แผนกปัจจุบัน',
  'ขั้นตอนถัดไป',
  'target_department,candidate_departments,assignment_status',
]) assert.ok(page.includes(required), `advance reject UI should include ${required}`)

for (const required of [
  'reject_employee_advance_case',
  'restore_employee_advance_case',
  "status='rejected'",
  'advance_final_requires_adjustment',
  'advance_reject_active_children',
  'reject_exclude_from_totals',
  'restore_to_review',
  'auth.uid()',
  'revoke all on function',
]) assert.ok(migration.toLowerCase().includes(required.toLowerCase()), `reject migration should include ${required}`)

assert.doesNotMatch(migration, /delete\s+from\s+public\.employee_advance_cases/i, 'reject must never delete the source case')
assert.match(page, /selected\?\.status === 'closed'/, 'closed cases must block reject and require Adjustment')

console.log('advance reject tabs contract tests passed')
