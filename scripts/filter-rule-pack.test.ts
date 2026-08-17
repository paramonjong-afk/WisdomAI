import assert from 'node:assert/strict'
import { FILTER_DOCUMENT_TYPES, evaluateFilterDocument, filterRulePackV1, reviseThresholds, type FilterDocument } from '../src/utils/filterRulePack.ts'

const routes = { quotation: 'quotation_review', purchase_order: 'purchase_review', goods_receipt: 'stock_review', delivery_note: 'stock_review', billing_note: 'accounting_review', invoice: 'accounting_review', receipt_tax_invoice: 'accounting_review', utility: 'accounting_review', error: 'error_review', reference: 'reference_only' } as const
for (const type of FILTER_DOCUMENT_TYPES) {
  const rule = filterRulePackV1.rules[type]
  const fields = Object.fromEntries([...new Set([...rule.requiredFields, ...rule.requiredEntities])].map(field => [field, `${field}-value`]))
  const fieldConfidence = Object.fromEntries(rule.requiredFields.map(field => [field, 0.9]))
  const valid: FilterDocument = { type, typeConfidence: 0.95, fields, fieldConfidence, pages: [1, 2], expectedPageCount: 2, route: routes[type] }
  const pass = evaluateFilterDocument(valid)
  assert.equal(pass.passed, true, `${type} pass fixture failed`)
  assert.ok(pass.results.every(result => result.rule && result.reason))
  const invalid: FilterDocument = { ...valid, fields: { ...fields, [rule.requiredFields[0]]: '' }, pages: [1, 3], route: 'reference_only' }
  const fail = evaluateFilterDocument(invalid)
  assert.equal(fail.passed, false, `${type} fail fixture unexpectedly passed`)
  assert.ok(fail.results.some(result => !result.passed && result.rule === 'required_field' && result.reason.includes(rule.requiredFields[0])))
  assert.ok(fail.results.some(result => !result.passed && result.rule === 'page_completeness'))
  if (type !== 'reference') assert.ok(fail.results.some(result => !result.passed && result.rule === 'allowed_route'))
}
const revised = reviseThresholds(filterRulePackV1, { version: '1.1.0', thresholds: { typeConfidence: 0.96, criticalFieldConfidence: 0.92 }, actor: 'qa@example.test', reason: 'validated production sample', changedAt: '2026-08-16T08:00:00.000Z' })
assert.deepEqual(revised.audit.before, { typeConfidence: 0.95, criticalFieldConfidence: 0.9 })
assert.deepEqual(revised.audit.after, { typeConfidence: 0.96, criticalFieldConfidence: 0.92 })
assert.equal(revised.audit.fromVersion, '1.0.0')
assert.equal(revised.audit.toVersion, '1.1.0')
assert.equal(filterRulePackV1.thresholds.criticalFieldConfidence, 0.9)
const thresholdProbe: FilterDocument = { type: 'reference', typeConfidence: 0.95, fields: { referenceType: 'contract', sourceIntakeId: 'I-1', companyId: 'C-1' }, fieldConfidence: { referenceType: 0.91, sourceIntakeId: 0.91 }, pages: [1], expectedPageCount: 1, route: 'reference_only' }
assert.equal(evaluateFilterDocument(thresholdProbe).passed, true)
assert.equal(evaluateFilterDocument(thresholdProbe, revised.pack).passed, false)
assert.throws(() => reviseThresholds(filterRulePackV1, { version: '1.0.0', thresholds: filterRulePackV1.thresholds, actor: 'qa', reason: 'same', changedAt: '2026-08-16T08:00:00.000Z' }), /VERSION_MUST_CHANGE/)
console.log('FILTER-002 versioned rule-pack fixtures: 10 document types pass/fail/audit ok')
