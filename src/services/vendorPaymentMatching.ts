export type VendorMatchStatus = 'matched' | 'candidate' | 'ambiguous' | 'needs_review' | 'not_applicable'

export type VendorMatchEvidence = {
  field: 'tax_id' | 'bank_account' | 'vendor_name' | 'project' | 'source'
  value: string
  weight: number
}

export type VendorMatchCandidate = {
  id: string
  name: string
  taxId: string | null
  score: number
  evidence: VendorMatchEvidence[]
}

export type VendorMatchInput = {
  vendorName?: string | null
  vendorTaxId?: string | null
  bankName?: string | null
  accountLast4?: string | null
  projectName?: string | null
  sourceText?: string | null
}

export type VendorMatchResult = {
  status: VendorMatchStatus
  confidence: number
  candidates: VendorMatchCandidate[]
  missing: string[]
  reason: string
}

const compact = (value: string | null | undefined) => (value ?? '').trim().toLocaleLowerCase().replace(/[\s\-_.()/]/g, '')

export const normalizeVendorIdentity = (value: string | null | undefined) => compact(value)

export const matchVendorCandidates = (
  input: VendorMatchInput,
  vendors: Array<{ id: string; name: string; tax_id?: string | null }>,
): VendorMatchResult => {
  const name = compact(input.vendorName)
  const taxId = compact(input.vendorTaxId)
  const bank = compact(input.bankName)
  const account = compact(input.accountLast4)
  const missing = [
    !name && !taxId ? 'ชื่อร้านค้าหรือเลขภาษี' : '',
    !bank || !account ? 'ธนาคารและเลขบัญชีท้าย 4 หลัก' : '',
  ].filter(Boolean)

  const candidates = vendors.map(vendor => {
    const evidence: VendorMatchEvidence[] = []
    const vendorName = compact(vendor.name)
    const vendorTaxId = compact(vendor.tax_id)
    if (taxId && vendorTaxId && taxId === vendorTaxId) evidence.push({ field: 'tax_id', value: vendor.tax_id ?? '', weight: 1 })
    if (name && vendorName && (vendorName === name || vendorName.includes(name) || name.includes(vendorName))) evidence.push({ field: 'vendor_name', value: vendor.name, weight: 0.45 })
    // Bank/account evidence is stored as an approved alias, not inferred from the
    // vendor master row. The caller can merge alias evidence into this result.
    if (input.sourceText && compact(input.sourceText).includes(vendorName) && vendorName) evidence.push({ field: 'source', value: vendor.name, weight: 0.2 })
    const score = Math.min(1, evidence.reduce((sum, item) => sum + item.weight, 0))
    return { id: vendor.id, name: vendor.name, taxId: vendor.tax_id ?? null, score, evidence }
  }).filter(candidate => candidate.evidence.length > 0).sort((a, b) => b.score - a.score)

  const top = candidates[0]
  const second = candidates[1]
  if (!top) return { status: 'needs_review', confidence: 0, candidates, missing, reason: 'ยังไม่มีหลักฐานพอจับคู่ร้านค้า; ชื่อ/เลขภาษีไม่ตรงทะเบียน' }
  if (second && Math.abs(top.score - second.score) < 0.15) return { status: 'ambiguous', confidence: top.score, candidates, missing, reason: 'พบผู้ขายหลายรายคะแนนใกล้กัน ต้องให้ Admin เลือกจากหลักฐาน' }
  if (top.evidence.some(item => item.field === 'tax_id') || top.score >= 0.9) return { status: 'matched', confidence: top.score, candidates, missing, reason: 'ตรงเลขภาษีหรือหลักฐานที่เชื่อถือได้' }
  return { status: 'candidate', confidence: top.score, candidates, missing, reason: 'พบชื่อใกล้เคียง แต่ยังต้องตรวจบัญชี/เอกสารก่อนยืนยัน' }
}
