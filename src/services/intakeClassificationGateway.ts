export type IntakeModule = 'accounting' | 'hr_attendance' | 'payroll' | 'advance_finance' | 'project_site' | 'intake_review'

export type IntakeClassificationInput = {
  id: string
  rawText?: string | null
  ocrText?: string | null
  sourceChannel?: string | null
  sourceRoom?: string | null
  senderName?: string | null
  documentType?: string | null
  existingIds?: string[]
  duplicateOf?: string | null
  isSystemSummary?: boolean
  childModules?: IntakeModule[]
}

export type IntakeClassification = {
  category: IntakeModule
  destination: IntakeModule
  confidence: number
  evidence: string[]
  missing_fields: string[]
  conflict_flags: string[]
  reason: string
  rule_version: string
  model_version: string
  policy: 'auto_route' | 'route_with_review' | 'intake_review' | 'duplicate_hold' | 'system_context'
  linked_parent_id: string | null
}

const RULE_VERSION = 'intake-rules-v1.0'
const MODEL_VERSION = 'local-structured-classifier-v1.0'
const textOf = (input: IntakeClassificationInput) => [input.rawText, input.ocrText, input.documentType, input.sourceRoom, input.senderName].filter(Boolean).join(' ').toLowerCase()
const has = (text: string, terms: string[]) => terms.some((term) => text.includes(term))

export function classifyIntake(input: IntakeClassificationInput): IntakeClassification {
  const text = textOf(input)
  if (input.isSystemSummary || has(text, ['สรุปรายวัน', 'system confirmation', 'system summary'])) return { category: 'hr_attendance', destination: 'hr_attendance', confidence: .99, evidence: ['system_summary'], missing_fields: [], conflict_flags: [], reason: 'เก็บเป็นบริบท ไม่สร้าง Job ซ้ำ', rule_version: RULE_VERSION, model_version: MODEL_VERSION, policy: 'system_context', linked_parent_id: input.duplicateOf ?? null }
  if (input.duplicateOf) return { category: 'intake_review', destination: 'intake_review', confidence: .99, evidence: ['duplicate_of_existing_id'], missing_fields: [], conflict_flags: [], reason: 'เชื่อมรายการเดิม ไม่สร้างงานใหม่', rule_version: RULE_VERSION, model_version: MODEL_VERSION, policy: 'duplicate_hold', linked_parent_id: input.duplicateOf }
  const evidence: string[] = []
  let category: IntakeModule = 'intake_review'
  if (has(text, ['ลงเวลา', 'เข้างาน', 'ออกงาน', 'clock_in', 'clock_out', 'attendance'])) { category = 'hr_attendance'; evidence.push('attendance_keyword') }
  else if (has(text, ['ค่าแรง', 'เงินเดือน', 'payroll', 'wage', 'สลิปเงินเดือน'])) { category = 'payroll'; evidence.push('payroll_keyword') }
  else if (has(text, ['เบิกล่วงหน้า', 'เงินสำรอง', 'ทดลองจ่าย', 'advance'])) { category = 'advance_finance'; evidence.push('advance_keyword') }
  else if (has(text, ['โครงการ', 'ไซต์งาน', 'หน้างาน', 'ช่าง', 'site'])) { category = 'project_site'; evidence.push('project_site_keyword') }
  else if (has(text, ['สลิปโอน', 'ใบเสร็จ', 'ใบกำกับ', 'invoice', 'receipt', 'เช็ค', 'ธนาคาร', 'ยอดเงิน'])) { category = 'accounting'; evidence.push('financial_keyword') }
  const conflict_flags = (input.childModules && input.childModules.length > 1) || (category !== 'intake_review' && has(text, ['และส่ง hr', 'และส่งบัญชี', 'หลายแผนก'])) ? ['multiple_module_signal'] : []
  const missing_fields = category === 'hr_attendance' && !has(text, ['เข้า', 'ออก', 'clock_in', 'clock_out']) ? ['attendance_direction'] : []
  const confidence = category === 'intake_review' ? .55 : missing_fields.length || conflict_flags.length ? .78 : .94
  const policy = category === 'intake_review' || missing_fields.length || conflict_flags.length ? 'intake_review' : confidence >= .9 ? 'auto_route' : 'route_with_review'
  return { category, destination: policy === 'intake_review' ? 'intake_review' : category, confidence, evidence, missing_fields, conflict_flags, reason: policy === 'intake_review' ? 'ข้อมูลไม่ครบ/มีสัญญาณขัดแย้ง ต้องให้ Intake ตรวจ' : `กฎ ${evidence.join(', ')} จัดเข้าคิว ${category}`, rule_version: RULE_VERSION, model_version: MODEL_VERSION, policy, linked_parent_id: null }
}

export function reconcileClassificationCounts(results: IntakeClassification[]) {
  return results.reduce<Record<IntakeModule | 'duplicate' | 'system_context' | 'failed', number>>((counts, result) => { counts[result.policy === 'duplicate_hold' ? 'duplicate' : result.policy === 'system_context' ? 'system_context' : result.destination] += 1; return counts }, { accounting: 0, hr_attendance: 0, payroll: 0, advance_finance: 0, project_site: 0, intake_review: 0, duplicate: 0, system_context: 0, failed: 0 })
}
