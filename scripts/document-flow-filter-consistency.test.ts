import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const gateway = readFileSync('src/services/documentFlowGateway.ts', 'utf8')
const center = readFileSync('src/pages/DocumentFlows/index.tsx', 'utf8')
const fixture = readFileSync('scripts/fixtures/documentFlowLocalFixture.ts', 'utf8')

assert.match(gateway, /T00:00:00\+07:00/)
assert.match(gateway, /loadQueuePage\(null, 2000, 'intake'/)
assert.match(gateway, /source_received_at_fallback|source_received_at/) 
assert.match(center, /activeGlobalFilterLabels/)
assert.doesNotMatch(center, /local_test_data|LOCAL TEST DATA/)
assert.match(fixture, /2026-08-22/)
assert.match(fixture, /2026-08-23/)
assert.match(fixture, /payment_verification/)
assert.match(fixture, /hr_bundle/)
assert.match(fixture, /'candidate'/)
assert.match(fixture, /'system'/)
assert.match(fixture, /'duplicate'/)
assert.match(fixture, /'low_confidence'/)
assert.match(center, /HR Confirmation/)
console.log('document flow filter/count consistency contracts passed')
