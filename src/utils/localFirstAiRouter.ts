export type DocumentClass = 'printed_thai' | 'handwriting' | 'table' | 'pdf'

export type LocalAiEngine =
  | 'pdfjs-native-text'
  | 'poppler-render'
  | 'opencv-imagemagick'
  | 'paddleocr-pp-ocrv5-thai'
  | 'pp-structure'

export type ExtractedAccountingFields = {
  taxId?: string
  date?: string
  subtotal?: number
  vat?: number
  total?: number
  lineTotal?: number
}

export type LocalAiRouterInput = {
  documentClass: DocumentClass
  localConfidence: number
  fields: ExtractedAccountingFields
  pdfHasNativeText?: boolean
  cloudConsent: boolean
  budgetRemainingUsd: number
  estimatedCloudCostUsd: number
  cloudConfidenceThreshold?: number
}

export type ValidationResult = {
  valid: boolean
  failures: Array<'tax_id' | 'date' | 'vat' | 'accounting_equation'>
}

export type LocalAiRouteDecision = {
  engines: LocalAiEngine[]
  validation: ValidationResult
  effectiveConfidence: number
  destination: 'local_result' | 'cloud_fallback' | 'human_review'
  reason: string
  estimatedCloudCostUsd: number
}

const moneyEqual = (left: number, right: number) =>
  Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 0.02

export function isValidThaiTaxId(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (!/^\d{13}$/.test(digits)) return false
  const sum = digits.slice(0, 12).split('').reduce((total, digit, index) => total + Number(digit) * (13 - index), 0)
  return (11 - (sum % 11)) % 10 === Number(digits[12])
}

export function isValidDocumentDate(value: string): boolean {
  const match = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (!match) return false
  const [, dayText, monthText, sourceYear] = match
  const day = Number(dayText)
  const month = Number(monthText)
  const year = Number(sourceYear) > 2400 ? Number(sourceYear) - 543 : Number(sourceYear)
  if (year < 1900 || year > 2200) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function validateAccountingFields(fields: ExtractedAccountingFields): ValidationResult {
  const failures: ValidationResult['failures'] = []
  if (fields.taxId && !isValidThaiTaxId(fields.taxId)) failures.push('tax_id')
  if (fields.date && !isValidDocumentDate(fields.date)) failures.push('date')
  const amounts = [fields.subtotal, fields.vat, fields.total, fields.lineTotal].filter(
    (value): value is number => value !== undefined,
  )
  const hasInvalidAmount = amounts.some(value => !Number.isFinite(value) || value < 0)
  if (hasInvalidAmount) failures.push('accounting_equation')
  if (fields.subtotal !== undefined && fields.vat !== undefined && !moneyEqual(fields.vat, fields.subtotal * 0.07)) failures.push('vat')
  if (fields.subtotal !== undefined && fields.vat !== undefined && fields.total !== undefined && !moneyEqual(fields.total, fields.subtotal + fields.vat)) failures.push('accounting_equation')
  if (fields.lineTotal !== undefined && fields.subtotal !== undefined && !moneyEqual(fields.lineTotal, fields.subtotal)) failures.push('accounting_equation')
  return { valid: failures.length === 0, failures: [...new Set(failures)] }
}

function selectLocalEngines(input: LocalAiRouterInput): LocalAiEngine[] {
  if (input.documentClass === 'pdf' && input.pdfHasNativeText) return ['pdfjs-native-text']
  const engines: LocalAiEngine[] = ['opencv-imagemagick']
  if (input.documentClass === 'pdf') engines.push('poppler-render')
  engines.push('paddleocr-pp-ocrv5-thai')
  if (input.documentClass === 'table') engines.push('pp-structure')
  return engines
}

export function routeLocalFirst(input: LocalAiRouterInput): LocalAiRouteDecision {
  const configuredThreshold = input.cloudConfidenceThreshold ?? 0.82
  const threshold = Number.isFinite(configuredThreshold) ? Math.max(0, Math.min(1, configuredThreshold)) : 0.82
  const validation = validateAccountingFields(input.fields)
  const localConfidence = Number.isFinite(input.localConfidence) ? input.localConfidence : 0
  const effectiveConfidence = Math.max(0, Math.min(1, localConfidence - validation.failures.length * 0.08))
  const lowConfidence = effectiveConfidence < threshold
  const budgetAllowsCloud = Number.isFinite(input.estimatedCloudCostUsd)
    && Number.isFinite(input.budgetRemainingUsd)
    && input.estimatedCloudCostUsd >= 0
    && input.budgetRemainingUsd >= 0
    && input.estimatedCloudCostUsd <= input.budgetRemainingUsd

  if (!lowConfidence) return { engines: selectLocalEngines(input), validation, effectiveConfidence, destination: 'local_result', reason: 'LOCAL_CONFIDENCE_ABOVE_THRESHOLD', estimatedCloudCostUsd: 0 }
  if (!input.cloudConsent) return { engines: selectLocalEngines(input), validation, effectiveConfidence, destination: 'human_review', reason: 'CLOUD_CONSENT_REQUIRED', estimatedCloudCostUsd: 0 }
  if (!budgetAllowsCloud) return { engines: selectLocalEngines(input), validation, effectiveConfidence, destination: 'human_review', reason: 'CLOUD_BUDGET_EXCEEDED', estimatedCloudCostUsd: 0 }
  return { engines: selectLocalEngines(input), validation, effectiveConfidence, destination: 'cloud_fallback', reason: validation.valid ? 'LOW_LOCAL_CONFIDENCE' : `RULE_VALIDATION_FAILED:${validation.failures.join(',')}`, estimatedCloudCostUsd: input.estimatedCloudCostUsd }
}

export type BenchmarkSample = { category: DocumentClass; expectedFields: number; matchedFields: number; decision: LocalAiRouteDecision }

export function summarizeRouterBenchmark(samples: BenchmarkSample[], cloudUsageLimit: number) {
  const categories = (['printed_thai', 'handwriting', 'table', 'pdf'] as const).map(category => {
    const group = samples.filter(sample => sample.category === category)
    const expected = group.reduce((sum, sample) => sum + sample.expectedFields, 0)
    const matched = group.reduce((sum, sample) => sum + sample.matchedFields, 0)
    return { category, samples: group.length, fieldAccuracy: expected ? matched / expected : 0 }
  })
  const cloudPages = samples.filter(sample => sample.decision.destination === 'cloud_fallback').length
  return { categories, cloudPages, cloudUsageLimit, policyCompliant: cloudPages <= cloudUsageLimit, estimatedCloudCostUsd: samples.reduce((sum, sample) => sum + sample.decision.estimatedCloudCostUsd, 0) }
}
