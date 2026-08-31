export type MoneyFundingSource = 'company_account' | 'reserve_fund' | 'employee_advance' | 'personal_reimbursement' | 'borrowed_funds' | 'unknown'
export type PayrollKind = '' | 'salary' | 'daily_wage' | 'contract_labor' | 'other'
export type MoneyPurpose =
  | 'payroll'
  | 'advance_transfer'
  | 'materials'
  | 'project_expense'
  | 'general_expense'
  | 'onward_transfer'
  | 'vendor_payment'
  | 'subcontractor'
  | 'travel'
  | 'bank_fee'
  | 'tax'
  | 'refund_return'
  | 'inter_account'
  | 'cash_withdrawal'
  | 'unknown'

export type MoneyAllocationDraft = {
  key: string
  purposeType: MoneyPurpose
  amount: string
  costCategoryId: string
  accountCode: string
  accountName: string
  projectId: string
  siteId: string
  payeeName: string
  responsibleName: string
  description: string
  confidence: string
  payrollKind: PayrollKind
  employeeProfileId: string
  receivedByProfileId: string
  payPeriodId: string
  recipientRelationship: 'self' | 'received_for_other' | 'team_lead' | 'unknown'
  vendorId: string
  vendorName: string
  vendorTaxId: string
  vendorBankName: string
  vendorAccountLast4: string
  vendorMatchStatus: 'matched' | 'candidate' | 'ambiguous' | 'needs_review' | 'not_applicable'
  vendorMatchConfidence: string
  vendorMatchReason: string
}

export type MoneyLineageHop = {
  fromParty: string
  toParty: string
  amount: string
  transferredAt: string
  note: string
}

export type MoneyLineageDraft = {
  parentLineageId: string
  fundingSourceType: MoneyFundingSource
  fundingSourceReference: string
  loanLenderName: string
  loanDueDate: string
  loanTerms: string
  fundHolderName: string
  payerName: string
  finalBeneficiaryName: string
  purposeType: MoneyPurpose
  projectId: string
  siteId: string
  responsibleName: string
  startingAmount: string
  paidAmount: string
  returnedAmount: string
  remainingAmount: string
  note: string
  hops: MoneyLineageHop[]
  allocations: MoneyAllocationDraft[]
}

const allocationKey = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `allocation-${Date.now()}-${Math.random().toString(36).slice(2)}`

export const emptyMoneyAllocation = (amount: number | null = null, payeeName = ''): MoneyAllocationDraft => ({
  key: allocationKey(), purposeType: 'unknown', amount: amount == null ? '' : String(amount), costCategoryId: '', accountCode: '', accountName: '', projectId: '', siteId: '',
  payeeName, responsibleName: '', description: '', confidence: '', payrollKind: '', employeeProfileId: '', receivedByProfileId: '', payPeriodId: '', recipientRelationship: 'self', vendorId: '', vendorName: '', vendorTaxId: '',
  vendorBankName: '', vendorAccountLast4: '', vendorMatchStatus: 'needs_review', vendorMatchConfidence: '', vendorMatchReason: '',
})

export const emptyMoneyLineage = (senderName = '', recipientName = '', amount: number | null = null, transferredAt = ''): MoneyLineageDraft => ({
  parentLineageId: '',
  fundingSourceType: 'unknown', fundingSourceReference: '', loanLenderName: '', loanDueDate: '', loanTerms: '', fundHolderName: '', payerName: senderName,
  finalBeneficiaryName: recipientName, purposeType: 'unknown', projectId: '', siteId: '', responsibleName: '',
  startingAmount: '', paidAmount: amount == null ? '' : String(amount), returnedAmount: '0', remainingAmount: amount == null ? '' : '0', note: '',
  hops: [{ fromParty: senderName, toParty: recipientName, amount: amount == null ? '' : String(amount), transferredAt, note: '' }],
  allocations: [emptyMoneyAllocation(amount, recipientName)],
})

export const moneyFundingSourceNeedsHolder = (source: MoneyFundingSource) =>
  source === 'reserve_fund' || source === 'employee_advance'

export const moneyPurposeNeedsExpenseAccount = (purpose: MoneyPurpose) =>
  ['payroll', 'materials', 'project_expense', 'general_expense', 'vendor_payment', 'subcontractor', 'travel', 'bank_fee', 'tax'].includes(purpose)

export const applyMoneyFundingSource = (draft: MoneyLineageDraft, source: MoneyFundingSource): MoneyLineageDraft => ({
  ...draft,
  fundingSourceType: source,
  fundHolderName: moneyFundingSourceNeedsHolder(source) && !draft.fundHolderName.trim()
    ? draft.payerName.trim()
    : draft.fundHolderName,
})

export const moneyPurposeRoute = (purpose: MoneyPurpose, payrollKind: PayrollKind = '') => {
  if (purpose === 'payroll') {
    if (payrollKind === 'salary') return { label: 'เงินเดือน', route: 'บัญชี → HR/เงินเดือน', departments: ['hr'] }
    if (payrollKind === 'daily_wage') return { label: 'ค่าแรงรายวัน', route: 'บัญชี → HR/ค่าแรงรายวัน', departments: ['hr'] }
    if (payrollKind === 'contract_labor') return { label: 'ค่าจ้างเหมาแรงงาน', route: 'บัญชี → HR/ค่าจ้างเหมา', departments: ['hr'] }
    return { label: 'เงินเดือน/ค่าแรง', route: 'บัญชี → HR/Payroll', departments: ['hr'] }
  }
  if (purpose === 'advance_transfer') return { label: 'ตั้งต้น/เติมกองเงินผู้ถือเงิน', route: 'บัญชี → กองเงินผู้ถือเงิน', departments: [] }
  if (purpose === 'onward_transfer') return { label: 'ส่งต่อเงินสำรองจ่าย', route: 'ผู้ถือเงิน → ผู้ถือเงิน', departments: [] }
  if (purpose === 'materials') return { label: 'ค่าวัสดุ', route: 'บัญชี → ต้นทุนโครงการ', departments: ['project'] }
  if (purpose === 'project_expense') return { label: 'ค่าใช้จ่ายโครงการ', route: 'บัญชี → โครงการ', departments: ['project'] }
  if (purpose === 'subcontractor') return { label: 'ผู้รับเหมา/ผู้รับเหมาช่วง', route: 'บัญชี → โครงการ', departments: ['project'] }
  if (purpose === 'travel') return { label: 'เดินทาง/หน้างาน', route: 'บัญชี → โครงการ', departments: ['project'] }
  if (purpose === 'vendor_payment') return { label: 'จ่ายผู้ขาย', route: 'บัญชี → บันทึกบัญชี', departments: [] }
  if (purpose === 'bank_fee') return { label: 'ค่าธรรมเนียมธนาคาร', route: 'บัญชี → บันทึกบัญชี', departments: [] }
  if (purpose === 'tax') return { label: 'ภาษี', route: 'บัญชี → บันทึกบัญชี', departments: [] }
  if (purpose === 'refund_return') return { label: 'เงินคืน/คืนเงินสำรอง', route: 'บัญชี → ตรวจรับเงินคืน', departments: [] }
  if (purpose === 'inter_account') return { label: 'โอนระหว่างบัญชี', route: 'บัญชี → กระทบยอดบัญชี', departments: [] }
  if (purpose === 'cash_withdrawal') return { label: 'ถอนเงินสด', route: 'บัญชี → ตรวจผู้ถือเงิน', departments: [] }
  if (purpose === 'general_expense') return { label: 'ค่าใช้จ่ายทั่วไป', route: 'บัญชี → บันทึกบัญชี', departments: [] }
  return { label: 'รอจำแนก', route: 'บัญชี → รอข้อมูลเพิ่ม', departments: [] }
}

const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value)

export const validateMoneyLineage = (draft: MoneyLineageDraft, transferAmount: number | null) => {
  const missing: string[] = []
  const errors: string[] = []
  const paid = numberOrNull(draft.paidAmount)
  const starting = numberOrNull(draft.startingAmount)
  const returned = numberOrNull(draft.returnedAmount) ?? 0
  const remaining = numberOrNull(draft.remainingAmount)
  if (draft.fundingSourceType === 'unknown') missing.push('แหล่งเงิน')
  if (draft.fundingSourceType === 'borrowed_funds' && !draft.loanLenderName.trim()) missing.push('ผู้ให้ยืม')
  if (draft.fundingSourceType === 'borrowed_funds' && !draft.loanDueDate) missing.push('กำหนดคืนเงินยืม')
  if (moneyFundingSourceNeedsHolder(draft.fundingSourceType) && !draft.fundHolderName.trim()) missing.push('ผู้ถือเงิน')
  if (!draft.payerName.trim()) missing.push('ผู้จ่ายจริง')
  if (!draft.finalBeneficiaryName.trim()) missing.push('ผู้รับปลายทาง')
  if (paid == null || !Number.isFinite(paid) || paid <= 0) missing.push('ยอดจ่าย')
  if (!draft.hops.length) missing.push('เส้นทางเงินอย่างน้อย 1 ทอด')
  draft.hops.forEach((hop, index) => {
    const amount = numberOrNull(hop.amount)
    if (!hop.fromParty.trim() || !hop.toParty.trim() || amount == null || !Number.isFinite(amount) || amount <= 0) errors.push(`ทอดที่ ${index + 1} ข้อมูลไม่ครบ`)
  })
  if (paid != null && transferAmount != null && Math.abs(paid - transferAmount) > .01) errors.push('ยอดจ่ายไม่ตรงกับยอดในสลิป')
  if (!draft.allocations.length) missing.push('รายการจัดสรรเงินอย่างน้อย 1 รายการ')
  const allocationTotal = draft.allocations.reduce((sum, allocation, index) => {
    const amount = numberOrNull(allocation.amount)
    if (allocation.purposeType === 'unknown') missing.push(`วัตถุประสงค์รายการที่ ${index + 1}`)
    if (allocation.purposeType === 'payroll' && !allocation.payrollKind) missing.push(`ชนิดเงินเดือน/ค่าแรงรายการที่ ${index + 1}`)
    if (allocation.purposeType === 'payroll' && !allocation.employeeProfileId) missing.push(`เจ้าของเงินเดือน/ค่าแรงรายการที่ ${index + 1}`)
    if (allocation.purposeType === 'payroll' && !allocation.payPeriodId) missing.push(`งวดค่าแรงรายการที่ ${index + 1}`)
    if (moneyPurposeNeedsExpenseAccount(allocation.purposeType) && (!allocation.costCategoryId || !allocation.accountCode || !allocation.accountName)) missing.push(`บัญชีค่าใช้จ่ายรายการที่ ${index + 1}`)
    if (['materials', 'project_expense'].includes(allocation.purposeType) && !allocation.projectId) missing.push(`โครงการรายการที่ ${index + 1}`)
    if (allocation.purposeType === 'vendor_payment' && (allocation.vendorMatchStatus !== 'matched' || !allocation.vendorId)) missing.push(`ร้านค้า/ผู้ขายรายการที่ ${index + 1} ต้องจับคู่และยืนยันก่อนส่งต่อ`)
    if (amount == null || !Number.isFinite(amount) || amount <= 0) errors.push(`รายการจัดสรรที่ ${index + 1} จำนวนเงินไม่ถูกต้อง`)
    return sum + (amount != null && Number.isFinite(amount) ? amount : 0)
  }, 0)
  const advanceAllocations = draft.allocations.filter(allocation => ['advance_transfer', 'onward_transfer'].includes(allocation.purposeType))
  if (advanceAllocations.length && draft.allocations.length > 1) errors.push('การเติมเงินสำรอง/ส่งต่อผู้ถือเงินต้องเป็นสลิปเฉพาะรายการ แล้วเชื่อมสลิปการใช้เงินเป็นเส้นทางถัดไป')
  if (transferAmount != null && remaining != null && Math.abs(transferAmount - allocationTotal - returned - remaining) > .01) errors.push('ยอดสลิปไม่เท่ากับ ยอดจัดสรร + ยอดคืน + ยอดยังไม่จัดสรร')
  if (transferAmount != null && remaining == null) errors.push('ต้องระบุยอดยังไม่จัดสรร')
  if (remaining != null && remaining > .01) errors.push(`ยังมียอดไม่ได้จัดสรร ${remaining.toLocaleString('th-TH')} บาท กรุณาจัดสรรให้ครบหรือบันทึกฉบับร่าง`)
  if (starting != null && paid != null && starting < paid) errors.push('ยอดตั้งต้นของกองเงินต้องไม่น้อยกว่ายอดสลิป')
  return { missing, errors }
}

export const moneyAllocationTotal = (allocations: MoneyAllocationDraft[]) => allocations.reduce((sum, allocation) => {
  const amount = numberOrNull(allocation.amount)
  return sum + (amount != null && Number.isFinite(amount) ? amount : 0)
}, 0)

export const legacyMoneyLineageScope = (allocations: MoneyAllocationDraft[]) => {
  const scoped = allocations.find((allocation) =>
    ['materials', 'project_expense', 'subcontractor', 'travel'].includes(allocation.purposeType) && Boolean(allocation.projectId),
  )
  return { projectId: scoped?.projectId ?? '', siteId: scoped?.siteId ?? '' }
}

export const moneyAllocationDestinations = (allocations: MoneyAllocationDraft[]) => {
  const routes = [...new Set(allocations.filter(allocation => allocation.purposeType !== 'unknown').map(allocation => moneyPurposeRoute(allocation.purposeType, allocation.payrollKind).route))]
  return routes.length ? routes : ['บัญชี → รอข้อมูลเพิ่ม']
}

export const calculateUnallocatedAmount = (transferAmount: number | null, allocations: MoneyAllocationDraft[], returnedAmount: string) => {
  if (transferAmount == null || !Number.isFinite(transferAmount)) return ''
  const returned = numberOrNull(returnedAmount) ?? 0
  return String(Math.max(0, transferAmount - moneyAllocationTotal(allocations) - returned))
}
