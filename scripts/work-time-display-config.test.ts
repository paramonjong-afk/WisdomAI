import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { defaultWorkTimeDisplaySettings, formatWorkTime } from '../src/utils/timeDisplay.ts'

const migration = readFileSync(new URL('../supabase/migrations/202608120002_work_time_display_config.sql', import.meta.url), 'utf8')
const setup = readFileSync(new URL('../src/pages/WorkforceSetup/index.tsx', import.meta.url), 'utf8')
const reports = readFileSync(new URL('../src/pages/Reports/index.tsx', import.meta.url), 'utf8')

assert.match(migration, /work_time_primary_unit[\s\S]*default 'days'/)
assert.match(migration, /work_time_day_decimals[\s\S]*between 0 and 3/)
assert.match(migration, /work_time_show_secondary_hours/)
assert.match(setup, /รูปแบบแสดงเวลาทำงาน/)
assert.match(reports, /formatWorkTime/)
assert.deepEqual(formatWorkTime(480, defaultWorkTimeDisplaySettings), { primary: '1.00 วัน', secondary: '8 ชม.' })
assert.deepEqual(formatWorkTime(240, defaultWorkTimeDisplaySettings), { primary: '0.50 วัน', secondary: '4 ชม.' })
console.log('work time display config regression passed')
