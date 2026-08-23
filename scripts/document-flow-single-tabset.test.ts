import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const center = readFileSync('src/pages/DocumentFlows/index.tsx', 'utf8')
const intake = readFileSync('src/pages/IntakeRoom.tsx', 'utf8')

// The center owns the only two-view tabset.  Intake is a table panel and must
// never introduce another tablist when it is mounted below the center.
assert.equal((center.match(/<Tabs\b/g) ?? []).length, 1, 'Document Flow Center must render one Tabset')
assert.equal((center.match(/<Tab\b/g) ?? []).length, 2, 'Document Flow Center must expose exactly two view Tabs')
assert.equal((intake.match(/<Tabs\b/g) ?? []).length, 0, 'Intake panel must not render a nested Tabset')
assert.equal((intake.match(/<Tab\b/g) ?? []).length, 0, 'Intake panel must not render nested Tabs')
assert.ok(center.includes('คิวเอกสาร'), 'document view label must remain')
assert.ok(center.includes('ข้อความและบริบท'), 'context view label must remain')
assert.ok(center.includes('แผนกปลายทาง'), 'destination filtering must remain available as a control')
assert.ok(!center.includes('<Tabs value={destinationDepartment}'), 'destination departments must not be a second Tabset')

console.log('document flow single-tabset contracts: ok')
