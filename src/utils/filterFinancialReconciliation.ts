export const FILTER_FINANCIAL_FIELDS = [
  'vendor', 'taxId', 'documentDate', 'documentNumber', 'lineItems', 'quantity',
  'unit', 'unitPrice', 'discount', 'vat', 'withholdingTax', 'netTotal',
] as const

export type FilterFinancialField = typeof FILTER_FINANCIAL_FIELDS[number]
export type FilterVatMode = 'exclusive' | 'inclusive' | 'none'

export type FilterFieldConfidence = Partial<Record<FilterFinancialField, number | null>>

export type FilterFinancialLine = {
  quantity: number
  unitPrice: number
  lineTotal?: number | null
}

export type FilterFinancialDocument = {
  subtotal: number
  discountAmount?: number | null
  vatRate?: number | null
  vatAmount?: number | null
  vatMode: FilterVatMode
  withholdingTaxRate?: number | null
  withholdingTaxAmount?: number | null
  totalAmount: number
  debitTotal?: number | null
  creditTotal?: number | null
  lines?: FilterFinancialLine[]
  fieldConfidence?: FilterFieldConfidence
}

export type FilterReconciliationOptions = {
  amountTolerance?: number
  confidenceThreshold?: number
}

export type FilterReconciliationIssueCode =
  | 'invalid_amount'
  | 'field_confidence_low'
  | 'line_total_mismatch'
  | 'subtotal_mismatch'
  | 'vat_mismatch'
  | 'withholding_tax_mismatch'
  | 'net_total_mismatch'
  | 'debit_credit_mismatch'
  | 'decision_required'

export type FilterReconciliationIssue = {
  code: FilterReconciliationIssueCode
  message: string
  difference?: number
  field?: FilterFinancialField
}

export type FilterReconciliationResult = {
  status: 'pass' | 'needs_review' | 'decision_required'
  passed: boolean
  tolerance: number
  confidenceThreshold: number
  calculated: {
    lineSubtotal: number | null
    taxableBase: number | null
    vatAmount: number | null
    withholdingTaxAmount: number | null
    netTotal: number | null
    debitTotal: number | null
    creditTotal: number | null
  }
  issues: FilterReconciliationIssue[]
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const money = (value: number) => `฿${round2(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const difference = (expected: number, actual: number) => round2(actual - expected)
const within = (expected: number, actual: number, tolerance: number) => Math.abs(expected - actual) <= tolerance
const validNumber = (value: number | null | undefined) => value !== null && value !== undefined && Number.isFinite(value)

const mismatch = (code: FilterReconciliationIssueCode, label: string, expected: number, actual: number): FilterReconciliationIssue => {
  const delta = difference(expected, actual)
  return { code, message: `${label}ไม่ตรง: คาดว่า ${money(expected)} แต่พบ ${money(actual)} (ส่วนต่าง ${money(delta)})`, difference: delta }
}

export function reconcileFilterFinancialDocument(
  document: FilterFinancialDocument,
  options: FilterReconciliationOptions = {},
): FilterReconciliationResult {
  const tolerance = options.amountTolerance ?? 0.01
  const confidenceThreshold = options.confidenceThreshold ?? 0.9
  const issues: FilterReconciliationIssue[] = []
  const amounts = [document.subtotal, document.discountAmount ?? 0, document.vatRate ?? 0, document.vatAmount ?? 0, document.withholdingTaxRate ?? 0, document.withholdingTaxAmount ?? 0, document.totalAmount]
  if (tolerance < 0 || !Number.isFinite(tolerance)) throw new Error('AMOUNT_TOLERANCE_INVALID')
  if (confidenceThreshold < 0 || confidenceThreshold > 1 || !Number.isFinite(confidenceThreshold)) throw new Error('CONFIDENCE_THRESHOLD_INVALID')
  if (amounts.some(value => !Number.isFinite(value) || value < 0)) issues.push({ code: 'invalid_amount', message: 'พบจำนวนเงินหรืออัตราภาษีไม่ถูกต้อง' })

  for (const [field, confidence] of Object.entries(document.fieldConfidence ?? {})) {
    if (!FILTER_FINANCIAL_FIELDS.includes(field as FilterFinancialField)) continue
    if (confidence !== null && confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      issues.push({ code: 'field_confidence_low', field: field as FilterFinancialField, message: `${field} มีค่า confidence ไม่อยู่ในช่วง 0-1` })
    } else if (confidence !== null && confidence !== undefined && confidence < confidenceThreshold) {
      issues.push({ code: 'field_confidence_low', field: field as FilterFinancialField, message: `${field} confidence ${(confidence * 100).toFixed(0)}% ต่ำกว่าเกณฑ์ ${(confidenceThreshold * 100).toFixed(0)}%` })
    }
  }

  const lineSubtotal = document.lines?.length
    ? round2(document.lines.reduce((sum, line) => {
      const expected = round2(line.quantity * line.unitPrice)
      if (validNumber(line.lineTotal) && !within(expected, line.lineTotal as number, tolerance)) issues.push(mismatch('line_total_mismatch', 'ยอดรายการ', expected, line.lineTotal as number))
      return sum + expected
    }, 0))
    : null
  if (lineSubtotal !== null && !within(lineSubtotal, document.subtotal, tolerance)) issues.push(mismatch('subtotal_mismatch', 'ยอดก่อนภาษี', lineSubtotal, document.subtotal))

  const discount = round2(document.discountAmount ?? 0)
  const base = document.vatMode === 'inclusive'
    ? round2(Math.max(0, document.subtotal - discount) / (1 + (document.vatRate ?? 0) / 100))
    : round2(Math.max(0, document.subtotal - discount))
  const calculatedVat = document.vatMode === 'none'
    ? 0
    : document.vatMode === 'inclusive'
      ? round2(Math.max(0, document.subtotal - discount) - base)
      : round2(base * (document.vatRate ?? 0) / 100)
  const calculatedWht = document.withholdingTaxRate == null
    ? (document.withholdingTaxAmount == null ? 0 : round2(document.withholdingTaxAmount))
    : round2(base * document.withholdingTaxRate / 100)
  const calculatedNet = round2(base + calculatedVat - calculatedWht)

  if (document.vatAmount != null && !within(calculatedVat, document.vatAmount, tolerance)) issues.push(mismatch('vat_mismatch', 'VAT', calculatedVat, document.vatAmount))
  if (document.withholdingTaxAmount != null && !within(calculatedWht, document.withholdingTaxAmount, tolerance)) issues.push(mismatch('withholding_tax_mismatch', 'หัก ณ ที่จ่าย', calculatedWht, document.withholdingTaxAmount))
  if (!within(calculatedNet, document.totalAmount, tolerance)) issues.push(mismatch('net_total_mismatch', 'ยอดสุทธิ', calculatedNet, document.totalAmount))

  const debitTotal = document.debitTotal == null ? null : round2(document.debitTotal)
  const creditTotal = document.creditTotal == null ? null : round2(document.creditTotal)
  if ((debitTotal == null) !== (creditTotal == null)) issues.push({ code: 'decision_required', message: 'ยังไม่มีข้อมูลเดบิตและเครดิตครบทั้งสองฝั่งเพื่อกระทบยอด' })
  else if (debitTotal != null && creditTotal != null && !within(debitTotal, creditTotal, tolerance)) issues.push(mismatch('debit_credit_mismatch', 'เดบิต/เครดิต', debitTotal, creditTotal))

  const hasDecisionGate = document.fieldConfidence == null || Object.values(document.fieldConfidence).some(value => value == null)
  if (hasDecisionGate) issues.push({ code: 'decision_required', message: 'ยังไม่มี confidence ครบทุกช่องที่ส่งมา ระบบไม่เดาค่าที่ไม่พบและต้องให้ผู้มีอำนาจตัดสินใจ' })
  const blocking = issues.some(issue => issue.code !== 'decision_required')
  return {
    status: blocking ? 'needs_review' : issues.some(issue => issue.code === 'decision_required') ? 'decision_required' : 'pass',
    passed: !blocking && !issues.some(issue => issue.code === 'decision_required'),
    tolerance,
    confidenceThreshold,
    calculated: { lineSubtotal, taxableBase: base, vatAmount: calculatedVat, withholdingTaxAmount: calculatedWht, netTotal: calculatedNet, debitTotal, creditTotal },
    issues,
  }
}
