export type SalesExpenseStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'accounting_draft'
  | 'paid'
  | 'rejected'
  | 'void'

export type SalesExpenseCategory =
  | 'site_survey'
  | 'travel'
  | 'design'
  | 'estimating'
  | 'sample_mockup'
  | 'tender_fee'
  | 'presentation'
  | 'commission'
  | 'legal_consulting'
  | 'advertising'
  | 'sales_promotion'
  | 'delivery_out'
  | 'customer_entertainment'
  | 'other'

export const salesExpenseCategoryLabels: Record<SalesExpenseCategory, string> = {
  site_survey: 'สำรวจไซต์ก่อนขาย',
  travel: 'เดินทางฝ่ายขาย',
  design: 'ออกแบบก่อนขาย',
  estimating: 'จัดทำ BOQ/ประมาณราคา',
  sample_mockup: 'ตัวอย่าง/Mockup',
  tender_fee: 'ค่าธรรมเนียมประมูล',
  presentation: 'นำเสนอลูกค้า',
  commission: 'นายหน้า/คอมมิชชัน',
  legal_consulting: 'ที่ปรึกษา/กฎหมาย',
  advertising: 'โฆษณาและประชาสัมพันธ์',
  sales_promotion: 'ส่งเสริมการขาย',
  delivery_out: 'ขนส่งออก/จัดจำหน่าย',
  customer_entertainment: 'รับรองลูกค้า',
  other: 'ค่าใช้จ่ายขายอื่น',
}

export const salesExpenseStatusLabels: Record<SalesExpenseStatus, string> = {
  draft: 'ร่าง',
  pending: 'รอตรวจ',
  approved: 'อนุมัติแล้ว',
  accounting_draft: 'สร้างบัญชีร่างแล้ว',
  paid: 'จ่ายแล้ว (ข้อมูลเดิม)',
  rejected: 'ส่งกลับแก้ไข',
  void: 'ยกเลิก',
}

export const salesExpenseAccountCategoryCode: Record<SalesExpenseCategory, string> = {
  advertising: '11.01',
  commission: '11.02',
  travel: '11.03',
  delivery_out: '11.04',
  presentation: '11.05',
  customer_entertainment: '11.05',
  tender_fee: '11.06',
  site_survey: '11.07',
  design: '11.07',
  estimating: '11.07',
  legal_consulting: '11.07',
  sample_mockup: '11.08',
  sales_promotion: '11.08',
  other: '11.09',
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export function calculateSalesExpenseAmounts(baseAmount: number, vatRate: number, withholdingRate: number) {
  const base = Math.max(0, Number.isFinite(baseAmount) ? baseAmount : 0)
  const vat = roundMoney(base * Math.max(0, vatRate) / 100)
  const withholding = roundMoney(base * Math.max(0, withholdingRate) / 100)
  return {
    base,
    vat,
    withholding,
    gross: roundMoney(base + vat),
    netPayable: roundMoney(base + vat - withholding),
  }
}

export function canEditSalesExpense(status: SalesExpenseStatus) {
  return status === 'draft' || status === 'rejected'
}

export function canApproveSalesExpense(status: SalesExpenseStatus, submittedBy: string | null, actorId: string | null) {
  return status === 'pending' && Boolean(actorId) && submittedBy !== actorId
}
