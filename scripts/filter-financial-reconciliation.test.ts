import assert from 'node:assert/strict'
import { FILTER_FINANCIAL_FIELDS, reconcileFilterFinancialDocument } from '../src/utils/filterFinancialReconciliation.ts'

const completeConfidence = Object.fromEntries(FILTER_FINANCIAL_FIELDS.map(field => [field, 0.99]))
const base = { subtotal: 100, discountAmount: 10, vatRate: 7, vatAmount: 6.3, vatMode: 'exclusive' as const, withholdingTaxRate: 3, withholdingTaxAmount: 2.7, totalAmount: 93.6, debitTotal: 93.6, creditTotal: 93.6, fieldConfidence: completeConfidence }

assert.equal(reconcileFilterFinancialDocument(base).status, 'pass')
assert.equal(reconcileFilterFinancialDocument({ ...base, vatMode: 'inclusive', subtotal: 107, discountAmount: 0, vatAmount: 7, withholdingTaxRate: 0, withholdingTaxAmount: 0, totalAmount: 107 }).status, 'pass')
assert.equal(reconcileFilterFinancialDocument({ ...base, lines: [{ quantity: 3, unitPrice: 33.333, lineTotal: 100 }] }).status, 'pass')
assert.ok(reconcileFilterFinancialDocument({ ...base, totalAmount: 93.7 }).issues.some(issue => issue.code === 'net_total_mismatch'))
assert.ok(reconcileFilterFinancialDocument({ ...base, debitTotal: 93.6, creditTotal: 93.7 }).issues.some(issue => issue.code === 'debit_credit_mismatch'))
assert.ok(reconcileFilterFinancialDocument({ ...base, discountAmount: 0, totalAmount: 107 }).issues.some(issue => issue.code === 'withholding_tax_mismatch'))
assert.equal(reconcileFilterFinancialDocument({ ...base, fieldConfidence: { ...completeConfidence, vendor: 0.89 } }).status, 'needs_review')
assert.equal(reconcileFilterFinancialDocument({ ...base, fieldConfidence: undefined }).status, 'decision_required')
assert.throws(() => reconcileFilterFinancialDocument(base, { amountTolerance: -0.01 }), /AMOUNT_TOLERANCE_INVALID/)
assert.throws(() => reconcileFilterFinancialDocument(base, { confidenceThreshold: 1.1 }), /CONFIDENCE_THRESHOLD_INVALID/)
console.log('FILTER-003 financial reconciliation: VAT exclusive/inclusive, rounding, WHT, discount, debit-credit and confidence gates passed')
