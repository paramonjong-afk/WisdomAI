import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('supabase/functions/health-monitor/index.ts', 'utf8')

assert.match(source, /\.eq\('status', 'review'\)[\s\S]*?\.eq\('approval_status', 'pending'\)[\s\S]*?\.ilike\('production_status', '%awaiting_approval%'/)
assert.match(source, /const awaitingApproval = item\.status === 'review' && item\.approval_status === 'pending'/)
assert.match(source, /const replyMarkup = awaitingApproval \? \{ inline_keyboard: \[\[/)
assert.match(source, /callback_data: `work:approve:\$\{item\.work_key\}`/)
assert.match(source, /callback_data: `work:reject:\$\{item\.work_key\}`/)
assert.match(source, /recordAdminNotification\('work_escalation_alert', null, text, item\.company_id \?\? null, replyMarkup\)/)
assert.match(source, /const capped = !awaitingApproval && item\.attempt_count >= maxAttempts/)

console.log('health work escalation action tests passed')
