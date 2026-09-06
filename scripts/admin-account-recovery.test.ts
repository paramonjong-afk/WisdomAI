import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const navigation = readFileSync(new URL('../src/utils/navigation.ts', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../src/layouts/Sidebar.tsx', import.meta.url), 'utf8')
const router = readFileSync(new URL('../src/router/index.tsx', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/AdminAccountRecovery/index.tsx', import.meta.url), 'utf8')
const edge = readFileSync(new URL('../supabase/functions/admin-account-recovery/index.ts', import.meta.url), 'utf8')
const flow = readFileSync(new URL('../docs/AUTH_PASSWORD_RESET_FLOW.md', import.meta.url), 'utf8')

assert.match(navigation, /กู้คืนบัญชีผู้ใช้.*\/admin-account-recovery.*roles:\['admin'\]/)
assert.match(sidebar, /'\/admin-account-recovery':<LockResetOutlinedIcon\/>/)
assert.match(router, /admin-account-recovery.*adminOnly/)
assert.match(page, /action: 'lookup'/)
assert.match(page, /!user \|\| !isBanned \|\| !hasReason/)
assert.match(page, /!user \|\| isBanned \|\| !hasReason/)
assert.match(edge, /actor\?\.role !== 'admin'/)
assert.match(edge, /resetPasswordForEmail\(target\.email/)
assert.doesNotMatch(edge, /generateLink/)
assert.match(edge, /USER_STILL_BANNED/)
assert.match(edge, /app_activity_logs/)
assert.match(edge, /severity: 'info'/)
assert.doesNotMatch(edge, /severity: 'critical'/)
assert.match(edge, /WISDOMAI_SITE_URL/)
assert.match(page, /context instanceof Response/)
assert.match(flow, /^```mermaid/)

console.log('admin account recovery contract: PASS')
