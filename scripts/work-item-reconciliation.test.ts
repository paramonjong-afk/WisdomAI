import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../supabase/migrations/202608100007_reconcile_completed_system_work_items.sql', import.meta.url), 'utf8')
const ten006Migration = readFileSync(new URL('../supabase/migrations/202608100008_reconcile_ten006_work_item.sql', import.meta.url), 'utf8')
const sys004Completion = readFileSync(new URL('../supabase/migrations/202608150020_system_health_runtime_repairs_completion.sql', import.meta.url), 'utf8')

assert.match(migration, /where work_key = 'TEN-001'[\s\S]*status = 'ready'[\s\S]*production_status = 'awaiting_approval'[\s\S]*worker_id is null/)
assert.match(migration, /work_key in \('TEN-002', 'TEN-004', 'TEN-005', 'TEN-008'\)/)
assert.match(migration, /status = 'done', progress = 100/)
assert.doesNotMatch(migration, /delete\s+from/i)
assert.match(ten006Migration, /where work_key = 'TEN-006'[\s\S]*status = 'ready'[\s\S]*production_status = 'awaiting_approval'[\s\S]*worker_id is null/)
assert.match(ten006Migration, /status = 'done'[\s\S]*progress = 100/)
assert.doesNotMatch(ten006Migration, /delete\s+from/i)

assert.match(sys004Completion, /update public\.system_work_items[\s\S]*status = 'done'[\s\S]*progress = 100/)
assert.match(sys004Completion, /evidence = concat_ws\([\s\S]*nullif\(evidence, ''\)/)
assert.match(sys004Completion, /where work_key = 'SYS-004'[\s\S]*scope = 'platform'[\s\S]*status = 'doing' and progress = 90/)
assert.match(sys004Completion, /0 open central errors and 0 pending problem-register items/)
assert.doesNotMatch(sys004Completion, /insert\s+into\s+public\.system_work_items/i)
assert.doesNotMatch(sys004Completion, /delete\s+from/i)

console.log('work item reconciliation migration checks passed')
