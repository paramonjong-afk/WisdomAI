import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202609160001_work_control_core_p0.sql', 'utf8')
const worker = readFileSync('supabase/functions/automation-worker/index.ts', 'utf8')
const runner = readFileSync('scripts/local-automation-runner.ps1', 'utf8')
const schema = JSON.parse(readFileSync('scripts/automation-result.schema.json', 'utf8'))
const page = readFileSync('src/pages/WorkCommandCenter/index.tsx', 'utf8')
const flow = readFileSync('docs/WORK_CONTROL_CORE_FLOW.md', 'utf8')

assert.match(migration, /add column if not exists requirement_version integer not null default 1/)
assert.match(migration, /create table if not exists public\.system_work_checkpoints/)
assert.match(migration, /create table if not exists public\.system_work_problems/)
assert.match(migration, /unique\(work_key,requirement_version,problem_fingerprint\)/)
assert.match(migration, /no_new_information_retry_blocked/)
assert.match(migration, /control_state='worker_lost'/)
assert.match(migration, /i\.work_key<>'SYS-004'/)
assert.doesNotMatch(migration, /drop table|truncate table|delete from/i)

assert.match(worker, /claim_system_work_item_v2/)
assert.match(worker, /finish_system_work_item_v2/)
assert.match(worker, /no_new_information_retry_blocked/)
assert.match(worker, /new_information_required/)

assert.match(runner, /Use only this task packet first/)
assert.match(runner, /do not load full chat history/i)
assert.match(runner, /control_state=\$ControlState/)
assert.match(runner, /checkpoint=\$Checkpoint/)
assert.doesNotMatch(runner, /Max\(\[int\]\$item\.progress,50\)/)

for (const key of ['control_state','checkpoint','problem_category','new_information_hash','token_input','token_output']) {
  assert.ok(schema.required.includes(key), `${key} must be required in Worker output`)
}
assert.deepEqual(schema.properties.control_state.enum, ['queued','blocked','paused','waiting_permission','token_limit','waiting_qa','worker_lost','done'])

assert.match(page, /Requirement v\$\{selected\.requirement_version/)
assert.match(page, /Worker หยุดก่อน Token หมด/)
assert.match(page, /Checkpoint ล่าสุด/)
assert.ok(flow.startsWith('```mermaid'), 'Flow document must start with Mermaid')

console.log('Work Control Core P0 checkpoint, compact-context and anti-loop contracts passed')
