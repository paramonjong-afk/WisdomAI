import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/202609160003_reconcile_work_queue_after_control_v2.sql','utf8')
const flow = readFileSync('docs/WORK_CONTROL_CORE_FLOW.md','utf8')

assert.match(sql,/CTRL-QUEUE-RECONCILE-20260916-V2/)
assert.match(sql,/item\.status<>'done' and item\.worker_id is null/)
assert.match(sql,/intent\.status='pending'/)
assert.match(sql,/work_key='SYS-004'.*status='doing'.*monitoring_active/s)
assert.match(sql,/work_key='WCC-CONTINUOUS-DISPATCH-P1-001'.*status='blocked'/s)
assert.match(sql,/no history deleted/)
assert.doesNotMatch(sql,/delete\s+from|truncate\s+table|drop\s+table/i)
assert.match(flow,/v2\.1/)

console.log('Work queue reconcile V2 guarded closure and sentinel contracts passed')
