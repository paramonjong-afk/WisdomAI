import fs from 'node:fs'
import assert from 'node:assert/strict'
import { calculateSummaryDailyUnits } from '../src/utils/payrollSummary.ts'

const migration=fs.readFileSync('supabase/migrations/202608120006_wage_day_override_audit.sql','utf8')
const reports=fs.readFileSync('src/pages/Reports/index.tsx','utf8')

for(const marker of [
  'unique (company_id, profile_id, work_date)',
  "target_day_units not in (0, 0.5, 1)",
  'public.is_company_manager(target_company_id)',
  'member.company_id = target_company_id',
  'employee_wage_day_override_audits',
  'old_day_units',
  'new_day_units',
])if(!migration.includes(marker))throw new Error(`Missing migration guard: ${marker}`)

for(const marker of [
  'ปรับผลคิดวัน',
  'ระบบเดิม',
  'บันทึกพร้อม Audit',
  'admin_set_employee_wage_day_override',
  "eq('company_id',companyId)",
])if(!reports.includes(marker))throw new Error(`Missing Reports behavior: ${marker}`)

assert.match(reports,/calculateSummaryDailyUnits\(id,list,wageDayOverrides,standardMinutes\)/)
const profileId='employee-1'
const sessions=[
  {clock_in_at:'2026-08-21T01:00:00Z',clock_out_at:'2026-08-21T09:00:00Z',status:'approved',worked_minutes:480,excluded_minutes:0},
  {clock_in_at:'2026-08-22T01:20:00Z',clock_out_at:'2026-08-22T10:00:00Z',status:'approved',worked_minutes:460,excluded_minutes:0},
]
// Admin corrected clock evidence must replace stale worked_minutes in Summary.
assert.equal(calculateSummaryDailyUnits(profileId,sessions,[],480),2)
const shortSessions=[sessions[0],{...sessions[1],clock_out_at:'2026-08-22T09:00:00Z'}]
assert.equal(calculateSummaryDailyUnits(profileId,shortSessions,[],480),1.5)
assert.equal(calculateSummaryDailyUnits(profileId,shortSessions,[{profile_id:profileId,work_date:'2026-08-22',day_units:1}],480),2)

console.log('wage day override regression passed')
