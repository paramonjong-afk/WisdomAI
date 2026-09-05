import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260829101053_reconcile_salary_from_employee_advances.sql', 'utf8')
const backfill = readFileSync('supabase/migrations/20260829101758_backfill_salary_advance_reconciliation.sql', 'utf8')
const advancePage = readFileSync('src/pages/AdvanceSettlements/index.tsx', 'utf8')
const advanceGateway = readFileSync('src/services/advanceReportGateway.ts', 'utf8')

for (const contract of [
  'reconcile_confirmed_salary_employee_advance',
  "new.purpose_type <> 'payroll'",
  '"field":"payroll_kind","value":"salary"',
  "status = 'cancelled'",
  'advance_cancelled_after_salary_confirmation',
  'to_jsonb(advance_before)',
  'to_jsonb(advance_after)',
  'on conflict(event_key) do nothing',
]) {
  if (!migration.includes(contract)) throw new Error(`Missing salary/advance reconciliation contract: ${contract}`)
}

if (!advancePage.includes(".neq('status', 'cancelled')")) {
  throw new Error('Active Advance Settlements page must exclude cancelled cases')
}
if (!advanceGateway.includes("else query = query.neq('status', 'cancelled')")) {
  throw new Error('Default advance report must exclude cancelled cases while preserving explicit history lookup')
}
if (!backfill.includes("set status = 'cancelled'") || !backfill.includes('salary-reclassification-cancel-advance:')) {
  throw new Error('Historical salary backfill must cancel the stale advance and append an idempotent audit')
}

console.log('salary advance reconciliation contract: PASS')
