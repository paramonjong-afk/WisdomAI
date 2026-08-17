import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('supabase/functions/health-monitor/index.ts', 'utf8')
const schema = readFileSync('supabase/migrations/202608030004_health_monitor.sql', 'utf8')

assert.match(schema, /notification_type in \([^)]*'configuration'/)
assert.match(source, /const manualStatusReportMarker = '\[work_status_manual\]'/)
assert.match(source, /\.eq\('notification_type', 'configuration'\)[\s\S]*?\.like\('message', `\$\{manualStatusReportMarker\}%`\)/)
assert.match(source, /destination: `telegram:\$\{chat\.telegram_chat_id\}`/)
assert.match(source, /company_id\.is\.null,company_id\.eq\.\$\{chat\.company_id\}/)
assert.doesNotMatch(source, /recordAdminNotification\('work_status_manual'/)
assert.match(source, /telegram_admin_chats/)
assert.match(source, /deactivateTelegramChat/)
assert.match(source, /bot was kicked\|chat not found\|bot was blocked\|forbidden/i)
assert.match(source, /callback_data: `work:approve:\$\{item\.work_key\}`/)
assert.doesNotMatch(source, /sendLinePush|LINE_CHANNEL_ACCESS_TOKEN/)

console.log('health status report deduplication tests passed')
