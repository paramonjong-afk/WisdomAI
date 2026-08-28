export type PaymentMethod = 'bank_account' | 'promptpay' | 'unknown'
export type PaymentAliasType = 'mobile' | 'national_id' | 'tax_id' | 'ewallet_id' | 'unknown_masked'

export type PaymentPartyDraft = {
  paymentMethod: PaymentMethod
  aliasType: PaymentAliasType
  aliasValue: string
}

export const inferPaymentMethod = (bankName: string | null | undefined): PaymentMethod =>
  /prompt\s*pay|พร้อม\s*เพย์/i.test(bankName ?? '') ? 'promptpay' : bankName?.trim() ? 'bank_account' : 'unknown'

export const emptyPaymentPartyDraft = (bankName: string | null | undefined, accountLast4: string | null | undefined): PaymentPartyDraft => {
  const paymentMethod = inferPaymentMethod(bankName)
  return {
    paymentMethod,
    aliasType: paymentMethod === 'promptpay' ? 'unknown_masked' : 'unknown_masked',
    aliasValue: paymentMethod === 'promptpay' ? accountLast4 ?? '' : '',
  }
}

export const normalizePaymentAlias = (value: string) => value.replace(/[^0-9A-Za-z]/g, '').toUpperCase()

export const paymentAliasValidation = (draft: PaymentPartyDraft) => {
  if (draft.paymentMethod !== 'promptpay') return null
  const normalized = normalizePaymentAlias(draft.aliasValue)
  if (normalized.length < 4) return 'กรุณาระบุ PromptPay อย่างน้อยเลขท้าย 4 ตัว'
  if (draft.aliasType === 'mobile' && normalized.length !== 4 && normalized.length !== 10) return 'เบอร์ PromptPay ต้องเป็นเลขเต็ม 10 หลักหรือเลขปกปิดท้าย 4 ตัว'
  if (['national_id', 'tax_id'].includes(draft.aliasType) && normalized.length !== 4 && normalized.length !== 13) return 'เลขประจำตัว/เลขภาษีต้องเป็นเลขเต็ม 13 หลักหรือเลขปกปิดท้าย 4 ตัว'
  if (draft.aliasType !== 'ewallet_id' && !/^\d+$/.test(normalized)) return 'PromptPay ประเภทนี้ต้องเป็นตัวเลข'
  return null
}

export const paymentMethodLabel = (method: PaymentMethod) => ({
  bank_account: 'บัญชีธนาคาร',
  promptpay: 'PromptPay',
  unknown: 'ยังไม่ทราบช่องทาง',
})[method]

