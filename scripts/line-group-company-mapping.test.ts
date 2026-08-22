import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const migration=readFileSync('supabase/migrations/202608110028_platform_line_group_company_mapping.sql','utf8')
const repair=readFileSync('supabase/migrations/202608110029_fix_line_group_mapping_audit.sql','utf8')
const page=readFileSync('src/pages/LineMonitor/index.tsx','utf8')
const manager=readFileSync('src/pages/LineMonitor/PlatformLineGroupManager.tsx','utf8')

assert.match(migration,/if not public\.is_platform_admin\(\)/)
assert.match(migration,/create or replace function public\.assign_line_group_company/)
assert.match(migration,/update public\.health_monitor_settings set line_group_id=null/)
assert.match(migration,/update public\.workforce_rule_settings set line_group_id=null/)
assert.match(migration,/update public\.project_sites set line_group_id=null/)
assert.match(migration,/line_group_company_assigned/)
assert.match(repair,/app_activity_logs_event_type_check/)
assert.match(repair,/'line_group_company_assigned'/)
assert.match(repair,/update public\.line_groups[\s\S]*?insert into public\.app_activity_logs[\s\S]*?platform_company_bootstrap','off'/)
assert.match(page,/isPlatformAdmin as resolvePlatformAdmin/)
assert.match(page,/จัดการกลุ่ม LINE/)
assert.match(manager,/get_platform_line_group_assignments/)
assert.match(manager,/assign_line_group_company/)
assert.match(manager,/company\.company_name/)

console.log('Platform LINE Group company mapping checks passed')
