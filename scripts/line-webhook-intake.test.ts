import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describeLineWebhookEvent, safeWebhookEventList } from '../supabase/functions/_shared/line-webhook-intake.ts'

const bodyHash='a'.repeat(64)
const events=safeWebhookEventList({events:[
  {type:'join',webhookEventId:'join-001',source:{type:'group',groupId:'G-new'}},
  {type:'message',webhookEventId:'message-001',deliveryContext:{isRedelivery:true},source:{type:'group',groupId:'G-new'},message:{type:'text'}},
]})
assert.ok(events)
assert.equal(events.length,2)
assert.deepEqual(describeLineWebhookEvent(events[0],bodyHash,0),{
  fingerprint:'event:join-001',webhookEventId:'join-001',sourceType:'group',lineGroupId:'G-new',
  eventType:'join',messageType:null,isRedelivery:false,
})
assert.deepEqual(describeLineWebhookEvent(events[1],bodyHash,1),{
  fingerprint:'event:message-001',webhookEventId:'message-001',sourceType:'group',lineGroupId:'G-new',
  eventType:'message',messageType:'text',isRedelivery:true,
})
assert.equal(safeWebhookEventList({destination:'bot'}),null)
assert.deepEqual(safeWebhookEventList({events:[]}),[])
assert.equal(describeLineWebhookEvent({type:'join',source:{type:'room',roomId:'R-new'}},bodyHash,3).fingerprint,`event:${bodyHash}:3`)

const migration=readFileSync('supabase/migrations/202608150012_line_webhook_intake_audit.sql','utf8')
const webhook=readFileSync('supabase/functions/line-webhook/index.ts','utf8')
const monitor=readFileSync('src/pages/LineMonitor/PlatformLineGroupManager.tsx','utf8')
assert.match(migration,/create table if not exists public\.line_webhook_intake_events/i)
assert.match(migration,/enable row level security/i)
assert.match(migration,/public\.is_platform_admin\(\)/)
assert.match(migration,/service_role_required/)
assert.doesNotMatch(migration,/raw_body|raw_payload|signature_value|access_token/i)
assert.match(webhook,/recordWebhookIntake/)
assert.match(webhook,/signature_rejected/)
assert.match(webhook,/quarantined/)
assert.match(monitor,/line_webhook_intake_events/)
assert.match(monitor,/เส้นทางรับ Webhook ล่าสุด/)
console.log('LINE webhook intake functional checks passed')
