import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const intake = readFileSync('src/pages/IntakeRoom.tsx', 'utf8')
const center = readFileSync('src/pages/DocumentFlows/index.tsx', 'utf8')

assert.ok(!intake.includes('แยกสลิปย้อนหลัง'), 'IntakeRoom must not expose the historical transfer-slip backfill button')
assert.ok(!intake.includes('reprocess-transfer-slips'), 'IntakeRoom must not call the historical transfer-slip backfill function')
assert.ok(!intake.includes('backfillLoading'), 'IntakeRoom must not keep dead backfill state')
assert.ok(!intake.includes('HistoryOutlined'), 'IntakeRoom must not render the backfill icon anymore')
assert.ok(center.includes('IntakeRoomPanel'), 'DocumentFlow center must still mount the Intake panel')

console.log('document flow backfill removal contracts: ok')
