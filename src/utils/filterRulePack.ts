export const FILTER_DOCUMENT_TYPES = ['quotation', 'purchase_order', 'goods_receipt', 'delivery_note', 'billing_note', 'invoice', 'receipt_tax_invoice', 'utility', 'error', 'reference'] as const
export type FilterDocumentType = typeof FILTER_DOCUMENT_TYPES[number]
export type FilterRoute = 'quotation_review' | 'purchase_review' | 'stock_review' | 'accounting_review' | 'error_review' | 'reference_only'
type EntityField = 'vendorId' | 'companyId' | 'projectId'

export type FilterDocument = { type: FilterDocumentType; typeConfidence: number; fields: Record<string, string | number | boolean | null | undefined>; fieldConfidence: Record<string, number | undefined>; pages: number[]; expectedPageCount: number; route: FilterRoute }
export type FilterRulePack = { id: 'FILTER-002'; version: string; effectiveAt: string; thresholds: { typeConfidence: number; criticalFieldConfidence: number }; rules: Record<FilterDocumentType, { requiredFields: string[]; requiredEntities: EntityField[]; allowedRoutes: FilterRoute[] }> }
export type FilterRuleResult = { rule: 'type_confidence' | 'required_field' | 'field_confidence' | 'page_completeness' | 'entity_binding' | 'allowed_route'; passed: boolean; reason: string; field?: string }
export type FilterEvaluation = { passed: boolean; packId: FilterRulePack['id']; packVersion: string; results: FilterRuleResult[] }
export type ThresholdAudit = { packId: FilterRulePack['id']; fromVersion: string; toVersion: string; actor: string; reason: string; changedAt: string; before: FilterRulePack['thresholds']; after: FilterRulePack['thresholds'] }

const commercial: EntityField[] = ['vendorId', 'companyId', 'projectId']
export const filterRulePackV1: FilterRulePack = {
  id: 'FILTER-002', version: '1.0.0', effectiveAt: '2026-08-16T00:00:00.000Z', thresholds: { typeConfidence: 0.95, criticalFieldConfidence: 0.9 },
  rules: {
    quotation: { requiredFields: ['documentNumber', 'documentDate', 'vendorId', 'companyId', 'projectId', 'total'], requiredEntities: [...commercial], allowedRoutes: ['quotation_review'] },
    purchase_order: { requiredFields: ['documentNumber', 'documentDate', 'vendorId', 'companyId', 'projectId', 'total'], requiredEntities: [...commercial], allowedRoutes: ['purchase_review'] },
    goods_receipt: { requiredFields: ['documentNumber', 'documentDate', 'vendorId', 'companyId', 'projectId', 'purchaseOrderNumber'], requiredEntities: [...commercial], allowedRoutes: ['stock_review'] },
    delivery_note: { requiredFields: ['documentNumber', 'documentDate', 'vendorId', 'companyId', 'projectId'], requiredEntities: [...commercial], allowedRoutes: ['stock_review'] },
    billing_note: { requiredFields: ['documentNumber', 'documentDate', 'vendorId', 'companyId', 'total'], requiredEntities: ['vendorId', 'companyId'], allowedRoutes: ['accounting_review'] },
    invoice: { requiredFields: ['documentNumber', 'documentDate', 'vendorId', 'companyId', 'total'], requiredEntities: ['vendorId', 'companyId'], allowedRoutes: ['accounting_review'] },
    receipt_tax_invoice: { requiredFields: ['documentNumber', 'documentDate', 'vendorId', 'companyId', 'taxId', 'total'], requiredEntities: ['vendorId', 'companyId'], allowedRoutes: ['accounting_review'] },
    utility: { requiredFields: ['documentNumber', 'documentDate', 'companyId', 'serviceAccount', 'total'], requiredEntities: ['companyId'], allowedRoutes: ['accounting_review'] },
    error: { requiredFields: ['errorCode', 'sourceIntakeId'], requiredEntities: ['companyId'], allowedRoutes: ['error_review'] },
    reference: { requiredFields: ['referenceType', 'sourceIntakeId'], requiredEntities: ['companyId'], allowedRoutes: ['reference_only'] },
  },
}

const present = (value: FilterDocument['fields'][string]) => value !== null && value !== undefined && value !== ''
export function evaluateFilterDocument(document: FilterDocument, pack: FilterRulePack = filterRulePackV1): FilterEvaluation {
  const config = pack.rules[document.type]
  const results: FilterRuleResult[] = []
  const typePassed = document.typeConfidence >= pack.thresholds.typeConfidence
  results.push({ rule: 'type_confidence', passed: typePassed, reason: typePassed ? `type confidence ${document.typeConfidence} ผ่านเกณฑ์ ${pack.thresholds.typeConfidence}` : `type confidence ${document.typeConfidence} ต่ำกว่าเกณฑ์ ${pack.thresholds.typeConfidence}` })
  for (const field of config.requiredFields) {
    const exists = present(document.fields[field])
    results.push({ rule: 'required_field', field, passed: exists, reason: exists ? `มีช่องบังคับ ${field}` : `ขาดช่องบังคับ ${field}` })
    if (exists) {
      const confidence = document.fieldConfidence[field] ?? 0
      const passed = confidence >= pack.thresholds.criticalFieldConfidence
      results.push({ rule: 'field_confidence', field, passed, reason: passed ? `${field} confidence ${confidence} ผ่านเกณฑ์ ${pack.thresholds.criticalFieldConfidence}` : `${field} confidence ${confidence} ต่ำกว่าเกณฑ์ ${pack.thresholds.criticalFieldConfidence}` })
    }
  }
  const complete = document.expectedPageCount > 0 && document.pages.length === document.expectedPageCount && document.pages.every((page, index) => page === index + 1)
  results.push({ rule: 'page_completeness', passed: complete, reason: complete ? `หน้าครบ 1-${document.expectedPageCount}` : `หน้าไม่ครบหรือเรียงผิด: พบ [${document.pages.join(',')}] คาด 1-${document.expectedPageCount}` })
  for (const entity of config.requiredEntities) {
    const passed = present(document.fields[entity])
    results.push({ rule: 'entity_binding', field: entity, passed, reason: passed ? `ผูก ${entity} แล้ว` : `ยังไม่ผูก ${entity}` })
  }
  const allowed = config.allowedRoutes.includes(document.route)
  results.push({ rule: 'allowed_route', passed: allowed, reason: allowed ? `อนุญาตเส้นทาง ${document.route}` : `ไม่อนุญาตเส้นทาง ${document.route}; ใช้ได้: ${config.allowedRoutes.join(', ')}` })
  return { passed: results.every(result => result.passed), packId: pack.id, packVersion: pack.version, results }
}

export function reviseThresholds(pack: FilterRulePack, change: { version: string; thresholds: FilterRulePack['thresholds']; actor: string; reason: string; changedAt: string }): { pack: FilterRulePack; audit: ThresholdAudit } {
  if (!change.actor.trim() || !change.reason.trim()) throw new Error('THRESHOLD_AUDIT_CONTEXT_REQUIRED')
  if (change.version === pack.version) throw new Error('RULE_PACK_VERSION_MUST_CHANGE')
  for (const value of Object.values(change.thresholds)) if (value < 0 || value > 1) throw new Error('THRESHOLD_OUT_OF_RANGE')
  const next = { ...pack, version: change.version, effectiveAt: change.changedAt, thresholds: { ...change.thresholds } }
  return { pack: next, audit: { packId: pack.id, fromVersion: pack.version, toVersion: next.version, actor: change.actor, reason: change.reason, changedAt: change.changedAt, before: { ...pack.thresholds }, after: { ...next.thresholds } } }
}
