import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../supabase/functions/health-monitor/index.ts', import.meta.url), 'utf8')

assert.match(source, /\.eq\('status',\s*'failed'\)\.gte\('updated_at',\s*since\(24\s*\*\s*60\)\)/, 'failed notifications must be limited to the latest 24 hours')
assert.match(source, /scheduled_end_at,status/, 'attendance health must load the scheduled shift end')
assert.match(source, /stale_after_shift_minutes/, 'attendance health must use the company grace period')
assert.match(source, /scheduled_end_plus_grace/, 'scheduled shifts must become overdue only after the configured grace period')
assert.match(source, /legacy_18h_fallback/, 'legacy sessions without a schedule must retain a safe fallback threshold')
assert.match(source, /failed_by_company: countByCompany/, 'failed notifications must be grouped by company in metadata')
assert.match(source, /stale_by_company: countByCompany/, 'stale sessions must be grouped by company in metadata')
assert.match(source, /stale_sessions: staleSessions/, 'stale sessions must expose resolved details instead of opaque ids')
assert.match(source, /active_sessions_today: activeToday/, 'open sessions from the current Bangkok day must be reported as active work')
assert.match(source, /overdue_attendance_sessions: stale/, 'only sessions beyond the review threshold must be reported as overdue')
assert.match(source, /!\['pending','needs_review'\]\.includes\(row\.status\)/, 'review exceptions must not be counted as active work')
assert.match(source, /กำลังทำงานวันนี้/, 'health copy must identify active work separately from exceptions')
assert.doesNotMatch(source, /ลงเวลาค้าง/, 'active attendance must not use ambiguous stale-work copy')
assert.match(source, /employee_name: profile\?\.full_name/, 'stale session details must resolve the employee name')
assert.match(source, /project_name: project\?\.name/, 'stale session details must resolve the project name')
assert.match(source, /company_name: companies\.get/, 'stale session details must resolve the company name')
assert.doesNotMatch(source, /attendance_notifications'\)\.select\('id', \{ count: 'exact', head: true \}\)\.eq\('status', 'failed'\)/, 'health check must not count all historical failures')

console.log('health attendance warning tests passed')
