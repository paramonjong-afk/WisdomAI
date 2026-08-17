import fs from 'node:fs'
import assert from 'node:assert/strict'
import { calculateHolidayWage } from '../src/utils/holidayWage.ts'

const normal=calculateHolidayWage({isHoliday:true,employmentType:'daily',workedMinutes:480,standardMinutes:480,dailyRate:600,multiplier:null})
assert.equal(normal.dayUnits,1)
assert.equal(normal.holidayPay,600)
assert.equal(normal.needsHolidayReview,true)

const doubled=calculateHolidayWage({isHoliday:true,employmentType:'daily',workedMinutes:480,standardMinutes:480,dailyRate:600,multiplier:2})
assert.equal(doubled.holidayPay,1200)
assert.equal(doubled.needsHolidayReview,false)

const half=calculateHolidayWage({isHoliday:true,employmentType:'daily',workedMinutes:240,standardMinutes:480,dailyRate:600,multiplier:1})
assert.equal(half.holidayPay,300)

const holidayOt=calculateHolidayWage({isHoliday:true,employmentType:'daily',workedMinutes:480,standardMinutes:480,dailyRate:600,multiplier:1,holidayOvertimeMinutes:60})
assert.equal(holidayOt.holidayOvertimePay,225)

const migration=fs.readFileSync('supabase/migrations/202608120007_holiday_wage_override_audit.sql','utf8')
const reports=fs.readFileSync('src/pages/Reports/index.tsx','utf8')
for(const marker of ['employee_holiday_wage_override_audits','wage_multiplier in (1,1.5,2,3)','Locked pay period cannot be changed','public.is_company_manager','target_holiday_type']) assert.ok(migration.includes(marker),marker)
for(const marker of ['รอตรวจอัตราวันหยุด','ค่าทำงานวันหยุด','OT วันหยุด','admin_set_employee_holiday_wage_override','weeklyHoliday','site_id']) assert.ok(reports.includes(marker),marker)
console.log('holiday wage regression passed')
