import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const monitor = readFileSync(new URL('../supabase/functions/health-monitor/index.ts', import.meta.url), 'utf8')
const telemetry = readFileSync(new URL('../src/lib/telemetry.ts', import.meta.url), 'utf8')
const healthPage = readFileSync(new URL('../src/pages/SystemHealth/index.tsx', import.meta.url), 'utf8')
const chatPage = readFileSync(new URL('../src/pages/Chat/index.tsx', import.meta.url), 'utf8')

assert.match(monitor, /row\.event_type === 'performance_metric'\) return 'performance'/, 'performance must use only its dedicated health route')
assert.match(monitor, /check\('client_errors', 'ข้อผิดพลาดฝั่งระบบบน Browser'/, 'system-side browser failures need a separate check')
assert.match(monitor, /const systemRows=rows\.filter\(row=>clientResponsibility\(row\)==='system'\)/, 'system check must exclude user-side events')
assert.match(monitor, /check\('user_side_events', 'เหตุการณ์ฝั่งผู้ใช้'/, 'user-side evidence needs a separate visible check')
assert.match(monitor, /status:'healthy',[\s\S]*?affects_system_health:false/, 'user-side evidence must not degrade central health')
assert.match(monitor, /events:userRows\.slice\(0,20\)\.map\(clientEvidence\)/, 'user-side check must retain bounded detailed evidence')
assert.match(telemetry, /responsibility_scope: 'user', event_category: 'user_action'/, 'new user-side telemetry must be explicitly tagged')
assert.match(telemetry, /responsibility_scope: 'system', event_category: 'application_error'/, 'new application errors must be explicitly tagged')
assert.match(chatPage, /message: 'chat_attachment_membership_missing',[\s\S]*?reason: 'membership_missing'/, 'known user membership refusal must carry a user-side reason')
assert.match(healthPage, /ข้อมูลฝั่งผู้ใช้ · ไม่กระทบระบบกลาง/, 'admin UI must clearly explain the user-side lane')
assert.match(healthPage, /หลักฐานรายเหตุการณ์/, 'admin UI must display detailed per-event evidence')

console.log('health client responsibility tests passed')
