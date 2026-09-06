import assert from 'node:assert/strict'
import { matchVendorCandidates, normalizeVendorIdentity } from '../src/services/vendorPaymentMatching.ts'

assert.equal(normalizeVendorIdentity('บริษัท แสง-ทอง จำกัด'), 'บริษัทแสงทองจำกัด')

const vendors = [
  { id: 'vendor-a', name: 'บริษัท แสงทอง จำกัด', tax_id: '0105550000001' },
  { id: 'vendor-b', name: 'บริษัท แสงเหนือ จำกัด', tax_id: '0105550000002' },
]

const exactTax = matchVendorCandidates({ vendorName: 'แสงทอง', vendorTaxId: '0105550000001' }, vendors)
assert.equal(exactTax.status, 'matched')
assert.equal(exactTax.candidates[0]?.id, 'vendor-a')

const nameOnly = matchVendorCandidates({ vendorName: 'แสงทอง' }, vendors)
assert.equal(nameOnly.status, 'candidate')
assert.notEqual(nameOnly.status, 'matched')

const unknown = matchVendorCandidates({ vendorName: 'ร้านที่ไม่อยู่ในทะเบียน' }, vendors)
assert.equal(unknown.status, 'needs_review')

const ambiguous = matchVendorCandidates({ vendorName: 'บริษัท แสง' }, vendors)
assert.equal(ambiguous.status, 'ambiguous')

console.log('vendor payment matching contract passed')
