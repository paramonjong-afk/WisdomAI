import { strict as assert } from 'node:assert'

type Fixture = { id: string; beforeType: string; confidence: number; detectedType: string; hasSource: boolean }
const fixtures: Fixture[] = [
  { id: 'fixture-slip-001', beforeType: 'other', confidence: 0.96, detectedType: 'transfer_slip', hasSource: true },
  { id: 'fixture-payroll-002', beforeType: 'other', confidence: 0.93, detectedType: 'payroll', hasSource: true },
  { id: 'fixture-low-003', beforeType: 'other', confidence: 0.71, detectedType: 'transfer_slip', hasSource: true },
  { id: 'fixture-missing-004', beforeType: 'other', confidence: 0, detectedType: 'unreadable', hasSource: false },
  { id: 'fixture-held-005', beforeType: 'other', confidence: 0.88, detectedType: 'receipt', hasSource: true },
]

const results = fixtures.map((item) => {
  const accepted = item.hasSource && item.confidence >= 0.9 && item.detectedType !== 'unreadable'
  return {
    ...item,
    outcome: accepted ? 'classified' : item.hasSource ? 'held' : 'failed',
    destination: accepted && item.detectedType === 'transfer_slip' ? 'accounting' : accepted ? 'filter' : 'intake_manual_review',
    audit: accepted ? ['reprocess_batch', 'ai_reclassified', ...(item.detectedType === 'transfer_slip' ? ['route_corrected'] : [])] : ['reprocess_batch'],
  }
})

assert.equal(results.length, 5)
assert.equal(results.filter((item) => item.outcome === 'classified').length, 2)
assert.equal(results.filter((item) => item.destination === 'accounting').length, 1)
assert.equal(results.filter((item) => item.outcome === 'held').length, 2)
assert.equal(results.filter((item) => item.outcome === 'failed').length, 1)
assert.deepEqual(results.find((item) => item.id === 'fixture-slip-001')?.audit, ['reprocess_batch', 'ai_reclassified', 'route_corrected'])
console.log('local Intake reprocess fixture: before=5 classified=2 accounting=1 held=2 failed=1')
