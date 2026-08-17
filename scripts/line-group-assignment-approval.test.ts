import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const migration=readFileSync('supabase/migrations/202608110034_line_group_assignment_approval.sql','utf8')
const ambiguityFix=readFileSync('supabase/migrations/202608150013_line_assignment_rpc_ambiguity_fix.sql','utf8')
const approvalAmbiguityFix=readFileSync('supabase/migrations/202608150014_line_assignment_approval_rpc_ambiguity_fix.sql','utf8')
const platformAdminCheckFix=readFileSync('supabase/migrations/202608150015_line_assignment_platform_admin_check_fix.sql','utf8')
const lineWebhook=readFileSync('supabase/functions/line-webhook/index.ts','utf8')
const telegram=readFileSync('supabase/functions/telegram-admin/index.ts','utf8')
const manager=readFileSync('src/pages/LineMonitor/PlatformLineGroupManager.tsx','utf8')

assert.match(migration,/create table if not exists public\.line_group_assignment_requests/)
assert.match(migration,/create table if not exists public\.line_group_assignment_options/)
assert.match(migration,/if auth\.role\(\) <> 'service_role'/)
assert.match(migration,/if not actor_is_platform_admin/)
assert.match(migration,/status='assigned',assigned_company_id=option_row\.company_id/)
assert.match(migration,/line_group_company_assignment_approved/)
assert.match(ambiguityFix,/create or replace function public\.register_unassigned_line_group/)
assert.match(ambiguityFix,/on conflict on constraint line_group_assignment_options_request_id_company_id_key/)
assert.doesNotMatch(ambiguityFix,/on conflict\(request_id,company_id\)/)
assert.match(ambiguityFix,/grant execute on function public\.register_unassigned_line_group\(text,text,text,text\) to service_role/)
assert.match(approvalAmbiguityFix,/create or replace function public\.approve_line_group_assignment/)
assert.match(approvalAmbiguityFix,/on conflict on constraint line_groups_line_group_id_key/)
assert.doesNotMatch(approvalAmbiguityFix,/on conflict\(line_group_id\)/)
assert.match(approvalAmbiguityFix,/assignment_request\.id=request_row\.id/)
assert.match(platformAdminCheckFix,/actor_is_platform_admin:=public\.is_platform_admin\(\)/)
assert.match(platformAdminCheckFix,/profile\.role='admin'/)
assert.doesNotMatch(platformAdminCheckFix,/profile\.platform_role/)
assert.match(platformAdminCheckFix,/if actor_profile_id<>auth\.uid\(\) then raise exception 'actor_mismatch'/)
assert.match(lineWebhook,/quarantineUnassignedLineGroup/)
assert.match(lineWebhook,/register_unassigned_line_group/)
assert.match(lineWebhook,/send_line_group_assignment_request/)
const tenantResolution=lineWebhook.slice(
  lineWebhook.indexOf('async function resolveEventCompanyId'),
  lineWebhook.indexOf('async function receiveIngestion'),
)
assert.match(tenantResolution,/if \(groupId\)[\s\S]*if \(group\?\.company_id\) return group\.company_id[\s\S]*return null/)
assert.ok(
  tenantResolution.indexOf('return null',tenantResolution.indexOf('if (groupId)'))
    < tenantResolution.indexOf('if (event.source.userId)'),
  'unknown groups must return before sender-based tenant fallback',
)
assert.match(telegram,/resolvePlatformAdmin/)
assert.match(telegram,/notification_status:'sending'/)
assert.match(telegram,/callback_data:`line_group_assign:\$\{option\.id\}`/)
assert.match(telegram,/approve_line_group_assignment/)
assert.match(telegram,/No active Platform Admin Telegram chat or LINE fallback/)
assert.match(manager,/line_group_assignment_requests/)
assert.match(manager,/line_group_assignment_options/)
assert.match(manager,/approve_line_group_assignment/)
assert.match(manager,/กลุ่มใหม่รอเลือกบริษัท/)
assert.match(manager,/ช่องทางสำรองบนเว็บเมื่อ Telegram แจ้งไม่สำเร็จ/)

console.log('LINE Group assignment approval checks passed')
