import assert from 'node:assert/strict'
import { isValidDocumentDate, isValidThaiTaxId, routeLocalFirst, summarizeRouterBenchmark, type BenchmarkSample } from '../src/utils/localFirstAiRouter.ts'

assert.equal(isValidThaiTaxId('0105551093211'), true)
assert.equal(isValidThaiTaxId('0105551093219'), false)
assert.equal(isValidDocumentDate('29/02/2567'), true)
assert.equal(isValidDocumentDate('31/02/2567'), false)
assert.equal(isValidDocumentDate('01/01/9999'), false)

const goodFields = { taxId: '0105551093211', date: '16/08/2569', subtotal: 100, vat: 7, total: 107, lineTotal: 100 }
const local = routeLocalFirst({ documentClass: 'printed_thai', localConfidence: 0.94, fields: goodFields, cloudConsent: false, budgetRemainingUsd: 0, estimatedCloudCostUsd: 0.02 })
assert.equal(local.destination, 'local_result')
assert.deepEqual(local.engines, ['opencv-imagemagick', 'paddleocr-pp-ocrv5-thai'])

const table = routeLocalFirst({ documentClass: 'table', localConfidence: 0.9, fields: goodFields, cloudConsent: true, budgetRemainingUsd: 1, estimatedCloudCostUsd: 0.02 })
assert.ok(table.engines.includes('pp-structure'))
const nativePdf = routeLocalFirst({ documentClass: 'pdf', pdfHasNativeText: true, localConfidence: 0.95, fields: goodFields, cloudConsent: true, budgetRemainingUsd: 1, estimatedCloudCostUsd: 0.02 })
assert.deepEqual(nativePdf.engines, ['pdfjs-native-text'])

const invalid = { ...goodFields, taxId: '0105551093219', vat: 8, total: 108 }
const cloud = routeLocalFirst({ documentClass: 'handwriting', localConfidence: 0.8, fields: invalid, cloudConsent: true, budgetRemainingUsd: 0.1, estimatedCloudCostUsd: 0.03 })
assert.equal(cloud.destination, 'cloud_fallback')
assert.match(cloud.reason, /RULE_VALIDATION_FAILED:tax_id,vat/)
assert.equal(cloud.estimatedCloudCostUsd, 0.03)
assert.equal(routeLocalFirst({ documentClass: 'handwriting', localConfidence: 0.4, fields: goodFields, cloudConsent: false, budgetRemainingUsd: 1, estimatedCloudCostUsd: 0.03 }).reason, 'CLOUD_CONSENT_REQUIRED')
assert.equal(routeLocalFirst({ documentClass: 'pdf', localConfidence: 0.4, fields: goodFields, cloudConsent: true, budgetRemainingUsd: 0.01, estimatedCloudCostUsd: 0.03 }).reason, 'CLOUD_BUDGET_EXCEEDED')
assert.equal(routeLocalFirst({ documentClass: 'pdf', localConfidence: Number.NaN, fields: goodFields, cloudConsent: true, budgetRemainingUsd: 1, estimatedCloudCostUsd: 0.03 }).destination, 'cloud_fallback')
assert.equal(routeLocalFirst({ documentClass: 'pdf', localConfidence: 0.4, fields: goodFields, cloudConsent: true, budgetRemainingUsd: 1, estimatedCloudCostUsd: Number.NaN }).reason, 'CLOUD_BUDGET_EXCEEDED')
assert.equal(routeLocalFirst({ documentClass: 'printed_thai', localConfidence: 0.95, fields: { ...goodFields, total: Number.NaN }, cloudConsent: false, budgetRemainingUsd: 0, estimatedCloudCostUsd: 0.03 }).validation.valid, false)

const samples: BenchmarkSample[] = [
  ['printed_thai', local, 6], ['handwriting', cloud, 4], ['table', table, 6], ['pdf', nativePdf, 6],
].map(([category, decision, matched]) => ({ category, decision, expectedFields: 6, matchedFields: matched }) as BenchmarkSample)
const benchmark = summarizeRouterBenchmark(samples, 1)
assert.deepEqual(benchmark.categories.map(item => item.category), ['printed_thai', 'handwriting', 'table', 'pdf'])
assert.equal(benchmark.cloudPages, 1)
assert.equal(benchmark.policyCompliant, true)
assert.equal(benchmark.estimatedCloudCostUsd, 0.03)

console.log('DOC-INGEST-012 local-first AI router benchmark: ok')
