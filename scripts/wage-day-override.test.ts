import fs from 'node:fs'

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

console.log('wage day override regression passed')
