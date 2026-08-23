export type MoneyFundingSource = 'company_account' | 'reserve_fund' | 'employee_advance' | 'personal_reimbursement' | 'unknown'
export type MoneyPurpose = 'payroll' | 'advance_transfer' | 'materials' | 'project_expense' | 'general_expense' | 'onward_transfer' | 'unknown'

export type MoneyLineageHop = {
  fromParty: string
  toParty: string
  amount: string
  transferredAt: string
  note: string
}

export type MoneyLineageDraft = {
  fundingSourceType: MoneyFundingSource
  fundingSourceReference: string
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
}

export const emptyMoneyLineage = (senderName = '', recipientName = '', amount: number | null = null, transferredAt = ''): MoneyLineageDraft => ({
  fundingSourceType: 'unknown', fundingSourceReference: '', fundHolderName: '', payerName: senderName,
  finalBeneficiaryName: recipientName, purposeType: 'unknown', projectId: '', siteId: '', responsibleName: '',
  startingAmount: '', paidAmount: amount == null ? '' : String(amount), returnedAmount: '0', remainingAmount: '', note: '',
  hops: [{ fromParty: senderName, toParty: recipientName, amount: amount == null ? '' : String(amount), transferredAt, note: '' }],
})

export const moneyPurposeRoute = (purpose: MoneyPurpose) => {
  if (purpose === 'payroll') return { label: 'ค่าแรง', route: 'บัญชี → HR/ค่าแรง', departments: ['hr'] }
  if (purpose === 'advance_transfer' || purpose === 'onward_transfer') return { label: 'เงินสำรองจ่าย', route: 'บัญชี → เงินสำรองจ่าย', departments: [] }
  if (purpose === 'materials') return { label: 'วัสดุ', route: 'บัญชี → Stock → โครงการ', departments: ['inventory', 'project'] }
  if (purpose === 'project_expense') return { label: 'ค่าใช้จ่ายโครงการ', route: 'บัญชี → โครงการ', departments: ['project'] }
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
  if (['reserve_fund', 'employee_advance'].includes(draft.fundingSourceType) && !draft.fundHolderName.trim()) missing.push('ผู้ถือเงิน')
  if (!draft.payerName.trim()) missing.push('ผู้จ่ายจริง')
  if (!draft.finalBeneficiaryName.trim()) missing.push('ผู้รับปลายทาง')
  if (draft.purposeType === 'unknown') missing.push('วัตถุประสงค์/ปลายทาง')
  if (['materials', 'project_expense'].includes(draft.purposeType) && !draft.projectId) missing.push('โครงการ')
  if (paid == null || !Number.isFinite(paid) || paid <= 0) missing.push('ยอดจ่าย')
  if (!draft.hops.length) missing.push('เส้นทางเงินอย่างน้อย 1 ทอด')
  draft.hops.forEach((hop, index) => {
    const amount = numberOrNull(hop.amount)
    if (!hop.fromParty.trim() || !hop.toParty.trim() || amount == null || !Number.isFinite(amount) || amount <= 0) errors.push(`ทอดที่ ${index + 1} ข้อมูลไม่ครบ`)
  })
  if (paid != null && transferAmount != null && Math.abs(paid - transferAmount) > .01) errors.push('ยอดจ่ายไม่ตรงกับยอดในสลิป')
  if (starting != null && remaining != null && Math.abs(starting - paid! - returned - remaining) > .01) errors.push('ยอดตั้งต้นไม่เท่ากับ ยอดจ่าย + ยอดคืน + ยอดคงเหลือ')
  return { missing, errors }
}

